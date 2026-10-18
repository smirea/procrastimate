import { CASSETTES, DEFAULT_CASSETTE, type Cassette } from '../../shared/fixtures/ramble-audio/cassettes';
import type { ConnectUpstream } from './ramble';

/**
 * A fake ElevenLabs that replays a cassette, so tests and development never need the key. The session starts at
 * once, the recorded messages play in real time from the first audio frame, and a commit answers at once with the
 * committed text still to come, joined into one transcript as a real commit would, which may be empty.
 */
export function cassetteUpstream(cassettes: Record<string, Cassette> = CASSETTES): ConnectUpstream {
	return async ({ cassette: id }, events) => {
		const cassette = cassettes[id ?? DEFAULT_CASSETTE];
		if (!cassette) throw new Error(`No cassette named ${id}`);
		let pending = [...cassette.events];
		const timers = new Set<ReturnType<typeof setTimeout>>();
		let playing = false;
		let closed = false;
		const later = (ms: number, run: () => void) => timers.add(setTimeout(run, ms));
		const emit = (message: unknown) => !closed && events.message(JSON.stringify(message));
		const play = (event: Cassette['events'][number]) => {
			if (!pending.includes(event)) return;
			pending = pending.filter(other => other !== event);
			emit(event.message);
		};

		later(0, () => emit({ message_type: 'session_started', session_id: `cassette-${cassette.id}`, config: {} }));
		return {
			send(text) {
				const chunk = JSON.parse(text) as { audio_base_64: string; commit: boolean };
				if (!playing && chunk.audio_base_64) {
					playing = true;
					for (const event of pending) later(event.afterAudioMs, () => play(event));
				}
				if (!chunk.commit) return;
				const rest = pending
					.filter(event => event.message.message_type === 'committed_transcript')
					.map(event => String(event.message.text));
				pending = [];
				later(0, () => emit({ message_type: 'committed_transcript', text: rest.join(' ') }));
			},
			close() {
				closed = true;
				for (const timer of timers) clearTimeout(timer);
			},
		};
	};
}
