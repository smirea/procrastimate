import { DEVICE_PROTOCOL_PREFIX } from 'shared/sync/protocol.ts';
import { RAMBLE_SOCKET_PATH, RAMBLE_SOCKET_PROTOCOL, type RambleServerMessage } from 'shared/ramble/protocol.ts';
import { voiceCapture, type DictationChoice } from 'shared/dictation.ts';
import { NativeDictation, speechRecognitionConstructor, type DictationEnd } from '../dictation.ts';
import { store } from '../store.svelte.ts';
import { joinTranscript } from './transcript.ts';

export type CaptureStop = 'stopped' | 'denied' | 'unsupported' | 'error' | 'unavailable' | 'limit';

export type RambleListen = {
	/** `typed` leaves the transcript editable and starts no recognizer. */
	typed: boolean;
	stop: () => void;
};

const WORKLET = `
class RamblePCM extends AudioWorkletProcessor {
	constructor() {
		super();
		this.step = sampleRate / 16000;
		this.frac = 0;
		this.fill = 0;
		this.pending = new Int16Array(1600);
	}
	process(inputs) {
		const channel = inputs[0] && inputs[0][0];
		if (!channel) return true;
		let index = this.frac;
		let peak = 0;
		while (index < channel.length) {
			const sample = Math.max(-1, Math.min(1, channel[Math.floor(index)] || 0));
			peak = Math.max(peak, Math.abs(sample));
			this.pending[this.fill++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
			if (this.fill === 1600) {
				this.port.postMessage(this.pending.buffer, [this.pending.buffer]);
				this.pending = new Int16Array(1600);
				this.fill = 0;
			}
			index += this.step;
		}
		this.frac = index - channel.length;
		this.port.postMessage({ level: peak });
		return true;
	}
}
registerProcessor('ramble-pcm', RamblePCM);
`;

/**
 * Starts the capture `voiceCapture` picked. Native speech uses the browser recognizer. ElevenLabs streams PCM to
 * the ramble socket. Offline never opens that socket. A browser with no recognizer leaves the transcript editable.
 */
export function listenRamble(options: {
	choice: DictationChoice;
	online: boolean;
	onText: (text: string, partialStart: number) => void;
	onStop: (reason: CaptureStop, message?: string) => void;
	onLevel?: (level: number) => void;
}): RambleListen {
	const plan = voiceCapture(options.choice, options.online, speechRecognitionConstructor() !== null);
	if (plan.capture === 'typed') return { typed: true, stop() {} };
	if (plan.capture === 'speech') return speech(options);
	return socket(options);
}

function speech(options: {
	onText: (text: string, partialStart: number) => void;
	onStop: (reason: CaptureStop, message?: string) => void;
}): RambleListen {
	const dictation = new NativeDictation(
		text => options.onText(text, text.length),
		(reason: DictationEnd) => options.onStop(reason === 'stopped' ? 'stopped' : reason),
	);
	dictation.start(() => {
		const Ctor = speechRecognitionConstructor();
		return Ctor ? new Ctor() : null;
	});
	return { typed: false, stop: () => dictation.stop() };
}

function socket(options: {
	onText: (text: string, partialStart: number) => void;
	onStop: (reason: CaptureStop, message?: string) => void;
	onLevel?: (level: number) => void;
}): RambleListen {
	const id = store.deviceId();
	if (!id) {
		options.onStop('unavailable', 'Ramble needs a connection');
		return { typed: true, stop() {} };
	}
	let stopped = false;
	let userStop = false;
	let heard = false;
	let committed = '';
	let partial = '';
	let audio: AudioContext | null = null;
	let stream: MediaStream | null = null;
	let socket: WebSocket | null = null;
	const publish = () => {
		heard = true;
		const joined = joinTranscript(committed, partial);
		options.onText(joined.text, joined.partialStart);
	};
	const finish = (reason: CaptureStop, message?: string) => {
		if (stopped) return;
		stopped = true;
		socket?.close();
		stream?.getTracks().forEach(track => track.stop());
		void audio?.close();
		options.onStop(reason, message);
	};
	const url = new URL(RAMBLE_SOCKET_PATH, location.href);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	socket = new WebSocket(url, [RAMBLE_SOCKET_PROTOCOL, `${DEVICE_PROTOCOL_PREFIX}${id}`]);
	socket.binaryType = 'arraybuffer';
	socket.onmessage = event => {
		if (typeof event.data !== 'string') return;
		let message: RambleServerMessage;
		try {
			message = JSON.parse(event.data) as RambleServerMessage;
		} catch {
			return;
		}
		switch (message.type) {
			case 'started':
				heard = true;
				return;
			case 'partial':
				partial = message.text;
				return publish();
			case 'committed':
				committed = joinTranscript(committed, message.text).text;
				partial = '';
				return publish();
			case 'error':
				return finish(message.code === 'daily-limit' ? 'limit' : 'unavailable', message.message);
			case 'ended':
				return finish('stopped');
			default: {
				const unreachable: never = message;
				return unreachable;
			}
		}
	};
	socket.onclose = () =>
		finish(userStop || heard ? 'stopped' : 'unavailable', userStop || heard ? undefined : 'Ramble needs a connection');
	void startMic(socket, options.onLevel).then(
		opened => {
			if (stopped) {
				opened.stream.getTracks().forEach(track => track.stop());
				void opened.audio.close();
				return;
			}
			audio = opened.audio;
			stream = opened.stream;
		},
		() => finish('denied', 'The microphone is off. You can type the ramble instead.'),
	);
	return {
		typed: false,
		stop() {
			userStop = true;
			stream?.getTracks().forEach(track => track.stop());
			if (socket && socket.readyState === WebSocket.OPEN) {
				socket.send(JSON.stringify({ type: 'stop' }));
				setTimeout(() => finish('stopped'), 3500);
			} else finish('stopped');
		},
	};
}

async function startMic(socket: WebSocket, onLevel?: (level: number) => void) {
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: { echoCancellation: true, noiseSuppression: true },
	});
	const audio = new AudioContext();
	const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
	try {
		await audio.audioWorklet.addModule(url);
	} finally {
		URL.revokeObjectURL(url);
	}
	const source = audio.createMediaStreamSource(stream);
	const node = new AudioWorkletNode(audio, 'ramble-pcm');
	node.port.onmessage = (event: MessageEvent<ArrayBuffer | { level: number }>) => {
		if (socket.readyState !== WebSocket.OPEN) return;
		if (event.data instanceof ArrayBuffer) socket.send(event.data);
		else onLevel?.(event.data.level);
	};
	source.connect(node);
	return { audio, stream };
}
