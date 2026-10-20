import { and, eq, sql } from 'drizzle-orm';
import { base64Encode } from './jwt';
import type { Actor } from '../../shared/auth';
import { labels, projects, rambleUsage, tasks } from '../../shared/db/schema';
import { labelIdsOf, lastUsed, projectIdsOf, type Named } from '../../shared/name-search';
import {
	RAMBLE_BYTES_PER_SECOND,
	RAMBLE_DAILY_SECONDS,
	RAMBLE_MAX_FRAME_BYTES,
	RAMBLE_SAMPLE_RATE,
	RAMBLE_SESSION_SECONDS,
	RAMBLE_SOCKET_PROTOCOL,
	rambleClientMessageSchema,
	type RambleEndReason,
	type RambleServerMessage,
} from '../../shared/ramble/protocol';
import { addDays, type DateKey } from '../../shared/task';
import { zonedDateKey, zonedTime } from '../../shared/zoned-time';
import type { Db } from './db/postgres';
import { cassetteUpstream } from './ramble-cassette';
import type { Config } from './config';
import { reportError } from './sentry';
import { listenWorkerSocket, type Socket, type StreamEvents, type StreamHost, type WorkerSocket } from './sockets';
import { storedZone } from './space';

/**
 * Ramble's transcription proxy. A signed-in client streams PCM over `RAMBLE_SOCKET_PATH`, and the server forwards it
 * to ElevenLabs Scribe v2 Realtime with the key, keyterms, and session settings it holds, relaying the transcript
 * back. On Cloudflare it runs in the `Ramble` Durable Object, keyed by user, because the object's CPU budget resets
 * with every incoming message while a Worker's covers a whole socket, and because the object holds the one count of
 * the user's day that every open session charges. Caps on audio seconds per session and per day bound what a leaked
 * token costs.
 */

export const ELEVENLABS_REALTIME_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';

/** Fixed on the server, so tuning them never needs a client release. */
const SESSION_SETTINGS = {
	model_id: 'scribe_v2_realtime',
	audio_format: 'pcm_16000',
	commit_strategy: 'vad',
	vad_silence_threshold_secs: '1.0',
	language_code: 'en',
	no_verbatim: 'true',
};

export function upstreamUrl(keyterms: readonly string[]): string {
	const url = new URL(ELEVENLABS_REALTIME_URL);
	for (const [key, value] of Object.entries(SESSION_SETTINGS)) url.searchParams.set(key, value);
	for (const term of keyterms) url.searchParams.append('keyterms', term);
	return url.toString();
}

export const KEYTERM_TRIGGERS = ['subtask', 'priority', 'remind', 'project', 'label'];
export const MAX_KEYTERMS = 50;
export const MAX_KEYTERM_LENGTH = 20;

export type KeytermSource = {
	tasks: readonly { projectId: string | null; labelIds: string[]; createdAt: number }[];
	projects: readonly Named[];
	labels: readonly Named[];
};

export async function loadKeytermSource(db: Db, owner: string): Promise<KeytermSource> {
	const [taskRows, projectRows, labelRows] = await Promise.all([
		db
			.select({ projectId: tasks.projectId, labelIds: tasks.labelIds, createdAt: tasks.createdAt })
			.from(tasks)
			.where(eq(tasks.userId, owner)),
		db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.userId, owner)),
		db.select({ id: labels.id, name: labels.name }).from(labels).where(eq(labels.userId, owner)),
	]);
	return { tasks: taskRows, projects: projectRows, labels: labelRows };
}

/**
 * Trigger words, then project and label names by the recency `#` and `@` autocomplete uses, then alphabetically.
 * ElevenLabs takes at most 50 terms of at most 20 characters, so longer names are skipped.
 */
export function rambleKeyterms(snapshot: KeytermSource): string[] {
	const used = new Map([...lastUsed(snapshot.tasks, projectIdsOf), ...lastUsed(snapshot.tasks, labelIdsOf)]);
	const names = [...snapshot.projects, ...snapshot.labels]
		.toSorted(
			(a, b) =>
				(used.get(b.id) ?? 0) - (used.get(a.id) ?? 0) || a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' }),
		)
		.map(item => item.name.trim());
	const terms: string[] = [];
	const seen = new Set<string>();
	for (const term of [...KEYTERM_TRIGGERS, ...names]) {
		const key = term.toLowerCase();
		if (!term || term.length > MAX_KEYTERM_LENGTH || seen.has(key)) continue;
		seen.add(key);
		terms.push(term);
		if (terms.length === MAX_KEYTERMS) break;
	}
	return terms;
}

export type UpstreamEvents = { message(text: string): void; close(): void };
export type Upstream = { send(text: string): void; close(): void };
/**
 * Opens one transcription session. `cassette` names the recording a fake upstream replays and is ignored by the
 * real one. Rejects when the connection fails.
 */
export type ConnectUpstream = (
	session: { keyterms: string[]; cassette: string | null },
	events: UpstreamEvents,
) => Promise<Upstream>;

/** A socket can already be closing, which makes `send` and `close` throw. */
function attempt(run: () => void) {
	try {
		run();
	} catch {}
}

/** ElevenLabs from the Worker, which sets the key header through a `fetch` upgrade. */
export function workerUpstream(apiKey: string): ConnectUpstream {
	return async ({ keyterms }, events) => {
		const response = await fetch(upstreamUrl(keyterms).replace(/^ws/, 'http'), {
			headers: { Upgrade: 'websocket', 'xi-api-key': apiKey },
		});
		const socket = (response as Response & { webSocket?: WorkerSocket | null }).webSocket;
		if (!socket) throw new Error(`ElevenLabs answered ${response.status}`);
		socket.accept();
		listenWorkerSocket(socket, {
			message: data => typeof data === 'string' && events.message(data),
			close: () => events.close(),
		});
		return { send: text => socket.send(text), close: () => attempt(() => socket.close(1000, 'Done')) };
	};
}

/** How the server reaches ElevenLabs: null without a key, which turns Ramble off. */
export function upstreamOf(
	settings: Config['ramble'],
	upstream: (apiKey: string) => ConnectUpstream,
): ConnectUpstream | null {
	switch (settings?.kind) {
		case 'elevenlabs':
			return upstream(settings.apiKey);
		case 'cassette':
			return cassetteUpstream();
		default:
			return null;
	}
}

type Tally = { seconds: number };

type Day = { key: DateKey; stored: number; live: Set<Tally>; loaded: Promise<void> };

type Ramble = {
	stream: StreamHost;
	/** The days with sessions, keyed `${userId}:${day}`. */
	days: Map<string, Day>;
};

function dayOf(ramble: Ramble, usage: RambleUsage, userId: string, key: DateKey): Day {
	const id = `${userId}:${key}`;
	const existing = ramble.days.get(id);
	if (existing) return existing;
	for (const [other, past] of ramble.days) {
		if (other.startsWith(`${userId}:`) && !past.live.size) ramble.days.delete(other);
	}
	const day: Day = { key, stored: 0, live: new Set(), loaded: Promise.resolve() };
	day.loaded = usage.stored(key).then(
		seconds => {
			day.stored += seconds;
		},
		(error: unknown) => {
			// Forgotten, so the next open reads the table again instead of failing on this read forever.
			if (ramble.days.get(id) === day) ramble.days.delete(id);
			throw error;
		},
	);
	ramble.days.set(id, day);
	return day;
}

const liveSeconds = (day: Day) => [...day.live].reduce((sum, tally) => sum + tally.seconds, 0);

function charge(usage: RambleUsage, day: Day, seconds: number): Promise<void> {
	if (seconds <= 0) return Promise.resolve();
	day.stored += seconds;
	return day.loaded
		.catch(() => {})
		.then(() => usage.add(day.key, seconds))
		.catch(reportError);
}

export type RambleUsage = { stored(day: string): Promise<number>; add(day: string, seconds: number): Promise<void> };

export function pgRambleUsage(db: Db, owner: string): RambleUsage {
	return {
		async stored(day) {
			const [row] = await db
				.select({ seconds: rambleUsage.seconds })
				.from(rambleUsage)
				.where(and(eq(rambleUsage.userId, owner), eq(rambleUsage.day, day)));
			return row?.seconds ?? 0;
		},
		async add(day, seconds) {
			await db
				.insert(rambleUsage)
				.values({ userId: owner, day, seconds })
				.onConflictDoUpdate({
					target: [rambleUsage.userId, rambleUsage.day],
					set: { seconds: sql`${rambleUsage.seconds} + excluded.seconds` },
				});
		},
	};
}

const FINAL_COMMIT_MS = 3000;
const CONNECT_MS = 10_000;
/** A socket that stops sending anything ends after this, so a dropped client does not hold the object open. */
const IDLE_MS = 60_000;

const UPSTREAM_ERRORS = new Set([
	'error',
	'auth_error',
	'quota_exceeded',
	'commit_throttled',
	'unaccepted_terms',
	'rate_limited',
	'queue_overflow',
	'resource_exhausted',
	'session_time_limit_exceeded',
	'input_error',
	'invalid_request',
	'chunk_size_exceeded',
	'insufficient_audio_activity',
	'transcriber_error',
]);

type UpstreamMessage = { message_type?: string; text?: string; error?: string };

const audioChunk = (bytes: Uint8Array, commit: boolean) =>
	JSON.stringify({
		message_type: 'input_audio_chunk',
		audio_base_64: base64Encode(bytes),
		commit,
		sample_rate: RAMBLE_SAMPLE_RATE,
	});

type SessionOptions = {
	client: Socket;
	connect: ConnectUpstream;
	ramble: Ramble;
	usage: RambleUsage;
	userId: string;
	day: Day;
	zone: string;
	keyterms: string[];
	cassette: string | null;
};

/**
 * One session. Audio that arrives before ElevenLabs starts is buffered. Every frame counts toward the session and
 * daily caps, and the frame that reaches one is cut at the cap and ends the session. A frame after midnight in the
 * account's time zone is charged to the new day, and the seconds before it are stored on the old one. Ending sends
 * a final commit when audio went out since the last committed text, waits for that text, then records the seconds,
 * sends `ended`, and closes both sockets. A socket that sends
 * nothing for a minute ends on its own.
 */
function session({
	client,
	connect,
	ramble,
	usage,
	userId,
	day: first,
	zone,
	keyterms,
	cassette,
}: SessionOptions): StreamEvents {
	let day = first;
	const tally: Tally = { seconds: 0 };
	let sessionSeconds = 0;
	day.live.add(tally);
	const buffered: Uint8Array[] = [];
	let upstream: Upstream | null = null;
	let started = false;
	let uncommitted = false;
	let ending: RambleEndReason | null = null;
	let ended = false;
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const later = (ms: number, run: () => void) => timers.add(setTimeout(run, ms));
	const send = (message: RambleServerMessage) => attempt(() => client.send(JSON.stringify(message)));

	async function shutdown(reason: RambleEndReason | null) {
		if (ended) return;
		ended = true;
		for (const timer of timers) clearTimeout(timer);
		day.live.delete(tally);
		const recorded = charge(usage, day, tally.seconds);
		attempt(() => upstream?.close());
		if (!reason) return;
		await recorded;
		send({ type: 'ended', seconds: Math.round(sessionSeconds * 10) / 10, reason });
		attempt(() => client.close(1000, 'Ramble ended'));
	}

	function end(reason: RambleEndReason) {
		void shutdown(reason);
	}

	function fail(message: string, cause?: unknown) {
		if (ended) return;
		reportError(cause ?? new Error(`ramble: ${message}`));
		send({ type: 'error', code: 'upstream', message });
		end('error');
	}

	function forward(bytes: Uint8Array) {
		upstream!.send(audioChunk(bytes, false));
		uncommitted = true;
	}

	function commit() {
		if (!uncommitted) return end(ending!);
		upstream!.send(audioChunk(new Uint8Array(0), true));
	}

	function flush() {
		if (!started || !upstream) return;
		for (const bytes of buffered.splice(0)) forward(bytes);
		if (ending) commit();
	}

	function finish(reason: RambleEndReason) {
		if (ending || ended) return;
		ending = reason;
		later(FINAL_COMMIT_MS + (started ? 0 : CONNECT_MS), () => end(reason));
		flush();
	}

	function onUpstream(text: string) {
		if (ended) return;
		let message: UpstreamMessage;
		try {
			message = JSON.parse(text);
		} catch {
			return;
		}
		switch (message.message_type) {
			case 'session_started':
				started = true;
				send({ type: 'started' });
				return flush();
			case 'partial_transcript':
				if (message.text) send({ type: 'partial', text: message.text });
				return;
			case 'committed_transcript':
				uncommitted = false;
				if (message.text) send({ type: 'committed', text: message.text });
				if (ending) end(ending);
				return;
			default:
				if (UPSTREAM_ERRORS.has(message.message_type ?? '')) {
					fail(`${message.message_type}: ${message.error ?? 'Transcription failed'}`);
				}
		}
	}

	function audio(bytes: Uint8Array) {
		if (ending || ended) return;
		if (bytes.byteLength > RAMBLE_MAX_FRAME_BYTES) {
			send({ type: 'error', code: 'invalid-audio', message: 'Audio frames must be at most one second long' });
			return end('error');
		}
		roll();
		const sessionLeft = RAMBLE_SESSION_SECONDS - sessionSeconds;
		const dailyLeft = RAMBLE_DAILY_SECONDS - day.stored - liveSeconds(day);
		const allowed = Math.max(
			0,
			Math.floor(Math.round(Math.min(sessionLeft, dailyLeft) * RAMBLE_BYTES_PER_SECOND) / 2) * 2,
		);
		const chunk = bytes.byteLength > allowed ? bytes.subarray(0, allowed) : bytes;
		const streamed = chunk.byteLength / RAMBLE_BYTES_PER_SECOND;
		sessionSeconds += streamed;
		tally.seconds += streamed;
		if (chunk.byteLength) {
			if (started && upstream) forward(chunk);
			else buffered.push(chunk.slice());
		}
		if (chunk.byteLength === allowed) {
			finish(sessionLeft <= dailyLeft ? 'session-limit' : 'daily-limit');
		}
	}

	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	function armIdle() {
		if (idleTimer) {
			clearTimeout(idleTimer);
			timers.delete(idleTimer);
		}
		idleTimer = setTimeout(() => finish('idle'), IDLE_MS);
		timers.add(idleTimer);
	}
	/** Stores the seconds streamed before midnight on that day, so later frames count against the new one. */
	function roll() {
		const today = zonedDateKey(Date.now(), zone);
		if (today === day.key) return;
		day.live.delete(tally);
		void charge(usage, day, tally.seconds);
		tally.seconds = 0;
		day = dayOf(ramble, usage, userId, today);
		day.live.add(tally);
	}

	armIdle();
	later(CONNECT_MS, () => !started && fail('Transcription did not start'));
	connect({ keyterms, cassette }, { message: onUpstream, close: () => fail('Transcription closed unexpectedly') }).then(
		socket => {
			if (ended) return attempt(() => socket.close());
			upstream = socket;
			flush();
		},
		error => fail('Could not reach the transcription service', error),
	);

	return {
		message(data) {
			if (!ended && !ending) armIdle();
			if (typeof data !== 'string') return audio(data);
			let parsed: unknown;
			try {
				parsed = JSON.parse(data);
			} catch {
				return;
			}
			if (rambleClientMessageSchema.safeParse(parsed).success) finish('stopped');
		},
		close() {
			void shutdown(null);
		},
	};
}

const refuse = (status: number, error: string) => Response.json({ ok: false, error }, { status });

/** A browser cannot read a refused upgrade, so a used-up day still opens and then closes with this error. */
function refuseDaily(ramble: Ramble, request: Request, resetsAt: number) {
	return ramble.stream(request, RAMBLE_SOCKET_PROTOCOL, client => {
		const refusal: RambleServerMessage = {
			type: 'error',
			code: 'daily-limit',
			message: "Ramble's daily limit is used up",
			resetsAt,
		};
		attempt(() => client.send(JSON.stringify(refusal)));
		attempt(() => client.close(1000, 'Daily limit'));
		return { message() {}, close() {} };
	});
}

export type RambleRoute = (request: Request, actor: Actor) => Promise<Response>;

/**
 * The upgrade for one signed-in human's session, after the caller authenticated the request, over one database. The
 * route holds the users' days, so one route serves every session of a host.
 */
export function rambleRoute(db: Db, stream: StreamHost, connect: ConnectUpstream | null): RambleRoute {
	const ramble: Ramble = { stream, days: new Map() };
	return async (request, actor) => {
		if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return refuse(426, 'Expected a WebSocket');
		if (!connect) return refuse(503, 'Ramble is not configured');
		const now = Date.now();
		const usage = pgRambleUsage(db, actor.id);
		const zone = await storedZone(db, actor.id);
		const day = dayOf(ramble, usage, actor.id, zonedDateKey(now, zone));
		await day.loaded;
		const remaining = RAMBLE_DAILY_SECONDS - day.stored - liveSeconds(day);
		if (remaining <= 0) return refuseDaily(ramble, request, zonedTime(addDays(day.key, 1), '00:00', zone));
		const keyterms = rambleKeyterms(await loadKeytermSource(db, actor.id));
		const cassette = new URL(request.url).searchParams.get('cassette');
		return ramble.stream(request, RAMBLE_SOCKET_PROTOCOL, client =>
			session({ client, connect, ramble, usage, userId: actor.id, day, zone, keyterms, cassette }),
		);
	};
}
