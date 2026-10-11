import { parseArgs } from 'node:util';
import type { DeviceCredentials } from '../../shared/auth';
import {
	RAMBLE_BYTES_PER_SECOND,
	RAMBLE_FRAME_BYTES,
	RAMBLE_SAMPLE_RATE,
	RAMBLE_SOCKET_PATH,
	RAMBLE_SOCKET_PROTOCOL,
} from '../../shared/ramble/protocol';
import { KEYTERM_TRIGGERS, upstreamUrl } from '../src/account/ramble';

/**
 * Measures Ramble's transcription latency with real speech. It streams a 16 kHz mono WAV in real time, 100 ms
 * frames each sent once its audio would have been captured, and times the session start, the first partial after
 * speech begins, the voice activity commit after the first pause, and the final commit after stop.
 *
 * Through the proxy (the default) it needs a device: `RAMBLE_TOKEN`, or `SYNC_SETUP_CODE` to pair a temporary
 * device that is removed afterwards. `--direct` skips the proxy and talks to ElevenLabs with `ELEVENLABS_API_KEY`,
 * as a baseline. Bun loads both from the root `.env.local`; nothing is printed but timings and transcripts.
 */

const USAGE = `Usage: bun server/scripts/ramble-latency.ts [--url <origin>] [--direct] [--runs <n>] [--wav <file>]
  --url     Procrastimate origin (default http://127.0.0.1:6121, the Bun dev server)
  --direct  Talk to ElevenLabs directly with ELEVENLABS_API_KEY instead of the proxy
  --runs    Sessions to run (default 3)
  --wav     16 kHz mono 16-bit WAV with two utterances split by a pause of over a second`;

const { values } = parseArgs({
	options: {
		url: { type: 'string', default: 'http://127.0.0.1:6121' },
		direct: { type: 'boolean', default: false },
		runs: { type: 'string', default: '3' },
		wav: { type: 'string', default: new URL('./ramble-latency.wav', import.meta.url).pathname },
		help: { type: 'boolean', default: false },
	},
});
if (values.help) {
	console.log(USAGE);
	process.exit(0);
}

/** The PCM in a 16 kHz mono 16-bit WAV. */
async function readWav(path: string): Promise<Uint8Array<ArrayBuffer>> {
	const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
	const view = new DataView(bytes.buffer);
	const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
	if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error(`${path} is not a WAV file`);
	let fmt: { channels: number; rate: number; bits: number } | null = null;
	for (let at = 12; at + 8 <= bytes.length;) {
		const size = view.getUint32(at + 4, true);
		if (tag(at) === 'fmt ') {
			fmt = {
				channels: view.getUint16(at + 10, true),
				rate: view.getUint32(at + 12, true),
				bits: view.getUint16(at + 22, true),
			};
		}
		if (tag(at) === 'data') {
			if (!fmt || fmt.channels !== 1 || fmt.rate !== RAMBLE_SAMPLE_RATE || fmt.bits !== 16) {
				throw new Error(`${path} must be 16 kHz mono 16-bit PCM`);
			}
			return bytes.slice(at + 8, at + 8 + size);
		}
		at += 8 + size + (size % 2);
	}
	throw new Error(`${path} has no data chunk`);
}

/** Runs of 100 ms frames louder than a whisper, joined across pauses shorter than 400 ms. */
function utterances(frames: Uint8Array[]): { first: number; last: number }[] {
	const voiced = frames.map(frame => {
		const samples = new Int16Array(frame.buffer, frame.byteOffset, frame.byteLength / 2);
		const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
		return rms > 300;
	});
	const runs: { first: number; last: number }[] = [];
	voiced.forEach((loud, index) => {
		if (!loud) return;
		const last = runs.at(-1);
		if (last && index - last.last <= 4) last.last = index;
		else runs.push({ first: index, last: index });
	});
	return runs;
}

type Heard = { kind: 'started' | 'partial' | 'committed' | 'ended' | 'error'; text?: string };

/** How one mode connects, frames audio, stops, and reads replies. */
type Link = {
	url: string;
	init: object;
	audio(frame: Uint8Array<ArrayBuffer>): string | Uint8Array<ArrayBuffer>;
	stop(): string;
	read(data: string): Heard | null;
	/** Whether the session is over once this arrives after stop. */
	done(heard: Heard): boolean;
};

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const chunk = (frame: Uint8Array, commit: boolean) =>
	JSON.stringify({
		message_type: 'input_audio_chunk',
		audio_base_64: toBase64(frame),
		commit,
		sample_rate: RAMBLE_SAMPLE_RATE,
	});

function directLink(apiKey: string): Link {
	const kinds: Record<string, Heard['kind']> = {
		session_started: 'started',
		partial_transcript: 'partial',
		committed_transcript: 'committed',
	};
	return {
		url: upstreamUrl(KEYTERM_TRIGGERS),
		init: { headers: { 'xi-api-key': apiKey } },
		audio: frame => chunk(frame, false),
		stop: () => chunk(new Uint8Array(0), true),
		read(data) {
			const message = JSON.parse(data) as { message_type: string; text?: string; error?: string };
			const kind = kinds[message.message_type];
			if (kind) return { kind, text: message.text };
			return message.error ? { kind: 'error', text: `${message.message_type}: ${message.error}` } : null;
		},
		done: heard => heard.kind === 'committed' || heard.kind === 'error',
	};
}

function proxyLink(origin: string, token: string): Link {
	const url = new URL(RAMBLE_SOCKET_PATH, origin);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	return {
		url: url.toString(),
		init: { protocols: [RAMBLE_SOCKET_PROTOCOL], headers: { Authorization: `Bearer ${token}` } },
		audio: frame => frame,
		stop: () => JSON.stringify({ type: 'stop' }),
		read(data) {
			const message = JSON.parse(data) as { type: Heard['kind']; text?: string; message?: string };
			return { kind: message.type, text: message.text ?? message.message };
		},
		done: heard => heard.kind === 'ended',
	};
}

type Result = {
	open: number;
	started: number;
	firstPartial: number | null;
	vadCommit: number | null;
	finalCommit: number | null;
	ended: number | null;
	transcript: string;
	errors: string[];
};

async function session(link: Link, frames: Uint8Array<ArrayBuffer>[]): Promise<Result> {
	const t0 = performance.now();
	const at = () => performance.now() - t0;
	const heard: (Heard & { at: number })[] = [];
	let wake = () => {};
	const socket = new WebSocket(link.url, link.init as never);
	socket.addEventListener('message', ({ data }) => {
		const message = link.read(String(data));
		if (message) heard.push({ ...message, at: at() });
		wake();
	});
	const closed = new Promise<void>(resolve => socket.addEventListener('close', () => (resolve(), wake())));
	async function until(check: () => boolean, ms: number, what: string) {
		const deadline = performance.now() + ms;
		while (!check()) {
			if (performance.now() > deadline || socket.readyState >= WebSocket.CLOSING) {
				throw new Error(`No ${what} within ${ms} ms${heard.length ? `; heard ${JSON.stringify(heard)}` : ''}`);
			}
			await Promise.race([new Promise<void>(resolve => (wake = resolve)), Bun.sleep(20)]);
		}
	}

	await new Promise<void>((resolve, reject) => {
		socket.addEventListener('open', () => resolve());
		socket.addEventListener('error', () => reject(new Error(`Could not open ${link.url.split('?')[0]}`)));
	});
	const open = at();
	await until(() => heard.some(h => h.kind === 'started'), 10_000, 'session start');
	const started = heard.find(h => h.kind === 'started')!.at;

	const sentAt: number[] = [];
	const streamStart = performance.now();
	for (const [index, frame] of frames.entries()) {
		const due = streamStart + (index + 1) * 100;
		if (due > performance.now()) await Bun.sleep(due - performance.now());
		socket.send(link.audio(frame));
		sentAt.push(at());
	}
	const stopAt = at();
	socket.send(link.stop());
	await until(() => heard.some(h => h.at > stopAt && link.done(h)), 10_000, 'final reply');
	socket.close();
	await closed;

	const [first] = utterances(frames);
	const speechAt = first ? sentAt[first.first]! : null;
	const pauseAt = first ? sentAt[first.last]! : null;
	const after = (from: number | null, kind: Heard['kind'], before = Infinity) => {
		const found = from === null ? undefined : heard.find(h => h.kind === kind && h.at > from && h.at < before);
		return found && from !== null ? Math.round(found.at - from) : null;
	};
	return {
		open: Math.round(open),
		started: Math.round(started),
		firstPartial: after(speechAt, 'partial'),
		vadCommit: after(pauseAt, 'committed', stopAt),
		finalCommit: after(stopAt, 'committed'),
		ended: after(stopAt, 'ended'),
		transcript: heard
			.filter(h => h.kind === 'committed' && h.text)
			.map(h => h.text)
			.join(' '),
		errors: heard.filter(h => h.kind === 'error').map(h => h.text ?? ''),
	};
}

async function pair(origin: string, code: string): Promise<DeviceCredentials> {
	const response = await fetch(new URL('/api/auth/setup', origin), {
		method: 'POST',
		body: JSON.stringify({ code, name: 'Ramble latency script' }),
	});
	if (!response.ok) throw new Error(`Pairing failed with ${response.status}`);
	return (await response.json()) as DeviceCredentials;
}

async function unpair(origin: string, device: DeviceCredentials) {
	await fetch(new URL('/api/auth/devices', origin), {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${device.token}` },
		body: JSON.stringify({ id: device.deviceId }),
	});
}

const median = (numbers: (number | null)[]) => {
	const sorted = numbers.filter((n): n is number => n !== null).toSorted((a, b) => a - b);
	return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null;
};

const pcm = await readWav(values.wav);
const frames = Array.from({ length: Math.ceil(pcm.length / RAMBLE_FRAME_BYTES) }, (_, i) =>
	pcm.slice(i * RAMBLE_FRAME_BYTES, (i + 1) * RAMBLE_FRAME_BYTES),
);
const spoken = utterances(frames);
if (spoken.length < 2)
	console.warn('The clip should hold two utterances split by a pause, or no voice commit is timed.');

let device: DeviceCredentials | null = null;
let link: Link;
if (values.direct) {
	const key = process.env.ELEVENLABS_API_KEY;
	if (!key) throw new Error('--direct needs ELEVENLABS_API_KEY');
	link = directLink(key);
} else {
	const token = process.env.RAMBLE_TOKEN;
	const code = process.env.SYNC_SETUP_CODE;
	if (!token && !code) throw new Error('The proxy needs RAMBLE_TOKEN or SYNC_SETUP_CODE for the target server');
	if (!token) device = await pair(values.url, code!);
	link = proxyLink(values.url, token ?? device!.token);
}

const target = values.direct ? 'ElevenLabs directly' : `${values.url}${RAMBLE_SOCKET_PATH}`;
console.log(
	`Ramble latency via ${target}: ${(pcm.length / RAMBLE_BYTES_PER_SECOND).toFixed(1)} s clip, ${spoken.length} utterances`,
);
const results: Result[] = [];
try {
	for (let run = 1; run <= Number(values.runs); run++) {
		const result = await session(link, frames);
		results.push(result);
		console.log(`run ${run}:`, JSON.stringify(result));
	}
} finally {
	if (device) await unpair(values.url, device);
}

const metrics: [string, keyof Result][] = [
	['socket open', 'open'],
	['session started', 'started'],
	['speech to first partial', 'firstPartial'],
	['end of speech to voice commit', 'vadCommit'],
	['stop to final commit', 'finalCommit'],
	['stop to ended', 'ended'],
];
console.log(`\nMedian of ${results.length} runs, in ms:`);
for (const [name, key] of metrics) {
	if (values.direct && key === 'ended') continue;
	console.log(`  ${name.padEnd(30)} ${median(results.map(result => result[key] as number | null)) ?? 'none'}`);
}
