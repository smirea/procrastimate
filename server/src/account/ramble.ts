import { labelIdsOf, lastUsed, projectIdsOf, type Named } from '../../../shared/name-search';
import {
	RAMBLE_BYTES_PER_SECOND,
	RAMBLE_DAILY_SECONDS,
	RAMBLE_MAX_FRAME_BYTES,
	RAMBLE_SAMPLE_RATE,
	RAMBLE_SESSION_SECONDS,
	RAMBLE_SOCKET_PATH,
	RAMBLE_SOCKET_PROTOCOL,
	rambleClientMessageSchema,
	type RambleEndReason,
	type RambleServerMessage,
} from '../../../shared/ramble/protocol';
import type { Snapshot } from '../../../shared/sync/protocol';
import { addDays, type DateKey } from '../../../shared/task';
import { isTimeZone, zonedDateKey, zonedTime } from '../../../shared/zoned-time';
import { authenticate, type AccountRoute } from '../auth';
import type { RambleBudget } from './ramble-budget';
import { listenWorkerSocket, type Socket, type SocketHost, type StreamEvents, type WorkerSocket } from './realtime';
import type { AccountStore } from './store';
import { accountSnapshot } from './sync';

/**
 * Ramble's transcription proxy. A paired client streams PCM over `RAMBLE_SOCKET_PATH`, and the account forwards it
 * to ElevenLabs Scribe v2 Realtime with the key, keyterms, and session settings it holds, relaying the transcript
 * back. It lives in the Durable Object because the object's CPU budget resets with every incoming message, while a
 * Worker's covers a whole socket. Caps on audio seconds per session and per day bound what a leaked token costs.
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

/**
 * Trigger words, then project and label names by the recency `#` and `@` autocomplete uses, then alphabetically.
 * ElevenLabs takes at most 50 terms of at most 20 characters, so longer names are skipped.
 */
export function rambleKeyterms(snapshot: Pick<Snapshot, 'tasks' | 'projects' | 'labels'>): string[] {
	const used = new Map([...lastUsed(snapshot.tasks, projectIdsOf), ...lastUsed(snapshot.tasks, labelIdsOf)]);
	const names = ([...snapshot.projects, ...snapshot.labels] as Named[])
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

export type RambleLimits = { sessionSeconds: number; dailySeconds: number; idleMs?: number };

export const DEFAULT_LIMITS: RambleLimits = {
	sessionSeconds: RAMBLE_SESSION_SECONDS,
	dailySeconds: RAMBLE_DAILY_SECONDS,
};

/** How the account reaches ElevenLabs: null without a key, which turns Ramble off. */
export type RambleConfig = { connect: ConnectUpstream | null; limits?: RambleLimits; budget?: RambleBudget | null };

type RambleGrant = { day: string; seconds: number };

export type Ramble = {
	stream: SocketHost['stream'];
	connect: ConnectUpstream | null;
	limits: RambleLimits;
	/** Open sessions, with the audio seconds each has streamed on its current day and not yet stored. */
	live: Set<{ day: string; seconds: number }>;
	/** Shared ElevenLabs budget, or null when Ramble is not calling ElevenLabs through Turso. */
	budget: RambleBudget | null;
};

export function ramble(sockets: SocketHost, config: RambleConfig): Ramble {
	return {
		stream: (request, protocol, start) => sockets.stream(request, protocol, start),
		connect: config.connect,
		limits: config.limits ?? DEFAULT_LIMITS,
		live: new Set(),
		budget: config.budget ?? null,
	};
}

const FINAL_COMMIT_MS = 3000;
/** How long ElevenLabs has to start a session. */
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

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

const audioChunk = (bytes: Uint8Array, commit: boolean) =>
	JSON.stringify({
		message_type: 'input_audio_chunk',
		audio_base_64: toBase64(bytes),
		commit,
		sample_rate: RAMBLE_SAMPLE_RATE,
	});

/** Seconds streamed so far today by sessions still open, which the store does not count until each day rolls or ends. */
const liveSeconds = (live: Ramble['live'], day: string) =>
	[...live].reduce((sum, tally) => (tally.day === day ? sum + tally.seconds : sum), 0);

type SessionOptions = {
	client: Socket;
	connect: ConnectUpstream;
	ramble: Ramble;
	store: AccountStore;
	day: DateKey;
	zone: string;
	keyterms: string[];
	cassette: string | null;
	grant: RambleGrant | null;
};

/**
 * One session. Audio that arrives before ElevenLabs starts is buffered. Every frame counts toward the session and
 * daily caps, and the frame that reaches one is cut at the cap and ends the session. A frame after midnight in the
 * account's time zone is charged to the new day, and the seconds before it are stored on the old one. Ending sends
 * a final commit when audio went out since the last committed text, waits for that text, then records the seconds,
 * returns any reserved budget it did not stream, sends `ended`, and closes both sockets. A socket that sends
 * nothing for a minute ends on its own.
 */
function session({
	client,
	connect,
	ramble,
	store,
	day,
	zone,
	keyterms,
	cassette,
	grant,
}: SessionOptions): StreamEvents {
	const { limits, live } = ramble;
	const tally = { day, seconds: 0 };
	let sessionSeconds = 0;
	let budgetLeft: number | null = grant ? grant.seconds : null;
	live.add(tally);
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
		live.delete(tally);
		if (tally.seconds > 0) store.addRambleSeconds(tally.day, tally.seconds);
		const unused = budgetLeft;
		budgetLeft = null;
		if (grant && unused !== null && unused > 0 && ramble.budget) {
			try {
				await ramble.budget.release(grant.day, unused);
			} catch {}
		}
		attempt(() => upstream?.close());
		if (!reason) return;
		send({ type: 'ended', seconds: Math.round(sessionSeconds * 10) / 10, reason });
		attempt(() => client.close(1000, 'Ramble ended'));
	}

	function end(reason: RambleEndReason) {
		void shutdown(reason);
	}

	function fail(message: string) {
		if (ended) return;
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
		const sessionLeft = limits.sessionSeconds - sessionSeconds;
		const dailyLeft = limits.dailySeconds - store.rambleSeconds(tally.day) - liveSeconds(live, tally.day);
		const budgetCap = budgetLeft ?? Number.POSITIVE_INFINITY;
		const allowed = Math.max(
			0,
			Math.floor(Math.round(Math.min(sessionLeft, dailyLeft, budgetCap) * RAMBLE_BYTES_PER_SECOND) / 2) * 2,
		);
		const chunk = bytes.byteLength > allowed ? bytes.subarray(0, allowed) : bytes;
		const streamed = chunk.byteLength / RAMBLE_BYTES_PER_SECOND;
		sessionSeconds += streamed;
		tally.seconds += streamed;
		if (budgetLeft !== null) budgetLeft = Math.max(0, budgetLeft - streamed);
		if (chunk.byteLength) {
			if (started && upstream) forward(chunk);
			else buffered.push(chunk.slice());
		}
		if (chunk.byteLength === allowed) {
			const cappedBySession = sessionLeft <= dailyLeft && sessionLeft <= budgetCap;
			finish(cappedBySession ? 'session-limit' : 'daily-limit');
		}
	}

	const idleMs = limits.idleMs ?? IDLE_MS;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	function armIdle() {
		if (idleTimer) {
			clearTimeout(idleTimer);
			timers.delete(idleTimer);
		}
		idleTimer = setTimeout(() => finish('idle'), idleMs);
		timers.add(idleTimer);
	}
	/** Stores the seconds streamed before midnight on that day, so later frames count against the new one. */
	function roll() {
		const today = zonedDateKey(Date.now(), zone);
		if (today === tally.day) return;
		if (tally.seconds > 0) store.addRambleSeconds(tally.day, tally.seconds);
		tally.day = today;
		tally.seconds = 0;
	}

	armIdle();
	later(CONNECT_MS, () => !started && fail('Transcription did not start'));
	connect({ keyterms, cassette }, { message: onUpstream, close: () => fail('Transcription closed unexpectedly') }).then(
		socket => {
			if (ended) return attempt(() => socket.close());
			upstream = socket;
			flush();
		},
		() => fail('Could not reach the transcription service'),
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

function accountZone(timeZone: string | null): string {
	return timeZone && isTimeZone(timeZone) ? timeZone : 'UTC';
}

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

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

export const rambleRoutes: Record<string, AccountRoute> = {
	[`GET ${RAMBLE_SOCKET_PATH}`]: async (request, context) => {
		if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return fail(426, 'Expected a WebSocket');
		if (!(await authenticate(request, context))) return fail(401, 'Not signed in');
		const { ramble, store, now } = context;
		const { connect } = ramble;
		if (!connect) return fail(503, 'Ramble is not configured');
		const snapshot = accountSnapshot(store);
		const zone = accountZone(snapshot.settings.timeZone);
		const day = zonedDateKey(now, zone);
		const remaining = ramble.limits.dailySeconds - store.rambleSeconds(day) - liveSeconds(ramble.live, day);
		if (remaining <= 0) return refuseDaily(ramble, request, zonedTime(addDays(day, 1), '00:00', zone));
		let grant: RambleGrant | null = null;
		if (ramble.budget) {
			const utcDay = zonedDateKey(now, 'UTC');
			const want = Math.min(ramble.limits.sessionSeconds, remaining);
			let granted = 0;
			try {
				granted = await ramble.budget.reserve(utcDay, want);
			} catch {
				return fail(503, 'Ramble is unavailable');
			}
			if (granted <= 0) return refuseDaily(ramble, request, zonedTime(addDays(utcDay, 1), '00:00', 'UTC'));
			grant = { day: utcDay, seconds: granted };
		}
		const keyterms = rambleKeyterms(snapshot);
		const cassette = new URL(request.url).searchParams.get('cassette');
		return ramble.stream(request, RAMBLE_SOCKET_PROTOCOL, client =>
			session({ client, connect, ramble, store, day, zone, keyterms, cassette, grant }),
		);
	},
};
