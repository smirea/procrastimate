import party from './party.cassette.json';
import threeTasks from './three-tasks.cassette.json';

/**
 * A recorded ElevenLabs realtime session: each upstream message with when it arrived, in milliseconds after the
 * first audio frame. `transcript` is the joined committed text.
 */
export type Cassette = {
	id: string;
	transcript: string;
	events: { afterAudioMs: number; message: Record<string, unknown> }[];
};

/** Every cassette by id, replayed by the fake upstream on the dev server and under `wrangler dev`. */
export const CASSETTES: Record<string, Cassette> = Object.fromEntries(
	([threeTasks, party] satisfies Cassette[]).map(cassette => [cassette.id, cassette]),
);

export const DEFAULT_CASSETTE = 'three-tasks';
