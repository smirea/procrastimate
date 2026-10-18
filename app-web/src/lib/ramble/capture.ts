import { DEVICE_PROTOCOL_PREFIX } from 'shared/auth.ts';
import { RAMBLE_SOCKET_PATH, RAMBLE_SOCKET_PROTOCOL, type RambleServerMessage } from 'shared/ramble/protocol.ts';
import { voiceCapture, type DictationChoice } from 'shared/dictation.ts';
import { NativeDictation, speechRecognitionConstructor, type DictationEnd } from '../dictation.ts';
import { installId } from '../device.ts';
import { joinTranscript } from './transcript.ts';

export type CaptureStop = 'stopped' | 'denied' | 'unsupported' | 'error' | 'unavailable' | 'limit';

export type RambleListen = {
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

export function listenRamble(options: {
	choice: DictationChoice;
	online: boolean;
	onText: (text: string, partialStart: number) => void;
	onStop: (reason: CaptureStop, message?: string) => void;
	onLevel?: (level: number) => void;
}): RambleListen {
	const plan = voiceCapture(options.choice, options.online, speechRecognitionConstructor() !== null);
	if (plan.capture === 'typed') return { typed: true, stop() {} };
	if (plan.capture === 'speech') return options.online ? speechThenSocket(options) : speech(options);
	return socket(options);
}

/**
 * Brave and some Chromium builds expose SpeechRecognition but fail at once with a network error, which stopped the mic
 * the moment it was tapped. A native session that fails before hearing anything moves to the ramble socket instead.
 */
function speechThenSocket(options: Parameters<typeof socket>[0]): RambleListen {
	let heard = false;
	let fallback: RambleListen | null = null;
	const native = speech({
		onLevel: options.onLevel,
		onText: (text, partialStart) => {
			heard = true;
			options.onText(text, partialStart);
		},
		onStop: (reason, message) => {
			if (!heard && !fallback && (reason === 'error' || reason === 'unsupported')) fallback = socket(options);
			else options.onStop(reason, message);
		},
	});
	return { typed: false, stop: () => (fallback ?? native).stop() };
}

function speech(options: {
	onText: (text: string, partialStart: number) => void;
	onStop: (reason: CaptureStop, message?: string) => void;
	onLevel?: (level: number) => void;
}): RambleListen {
	const level = options.onLevel ? speechLevel(options.onLevel) : null;
	const dictation = new NativeDictation(
		text => {
			level?.heard();
			options.onText(text, text.length);
		},
		(reason: DictationEnd) => {
			level?.stop();
			options.onStop(reason === 'stopped' ? 'stopped' : reason);
		},
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
	const id = installId();
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

/**
 * The browser recognizer reports no audio level. Chromium shares the mic, so the waveform reads its own stream, opened
 * only after the recognizer hears something, so a meter can never cause the fail-before-hearing fallback. WebKit
 * (only `webkitSpeechRecognition`) may stop recognition when a second capture opens, so there each recognized update
 * pulses the bars instead.
 */
function speechLevel(onLevel: (level: number) => void) {
	const webkit = !('SpeechRecognition' in window);
	let stopMeter: (() => void) | null = null;
	let pulse: ReturnType<typeof setTimeout> | undefined;
	return {
		heard() {
			if (!webkit) {
				stopMeter ??= meter(onLevel);
				return;
			}
			onLevel(0.2 + Math.random() * 0.35);
			clearTimeout(pulse);
			pulse = setTimeout(() => onLevel(0), 160);
		},
		stop() {
			clearTimeout(pulse);
			stopMeter?.();
		},
	};
}

/** A meter that cannot open leaves the waveform idle and never stops the recognizer. */
function meter(onLevel: (level: number) => void): () => void {
	let stopped = false;
	let frame = 0;
	let close = () => {};
	void navigator.mediaDevices
		?.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
		.then(stream => {
			const audio = new AudioContext();
			close = () => {
				stream.getTracks().forEach(track => track.stop());
				void audio.close();
			};
			if (stopped) return close();
			const analyser = audio.createAnalyser();
			analyser.fftSize = 1024;
			audio.createMediaStreamSource(stream).connect(analyser);
			const samples = new Float32Array(analyser.fftSize);
			const read = () => {
				analyser.getFloatTimeDomainData(samples);
				let peak = 0;
				for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
				onLevel(peak);
				frame = requestAnimationFrame(read);
			};
			read();
		})
		.catch(() => {});
	return () => {
		stopped = true;
		cancelAnimationFrame(frame);
		close();
	};
}
