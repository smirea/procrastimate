import type { RambleOutline, RambleOutlineInput, RambleOutlineTask } from '../../shared/ramble/outline';
import type { ConnectUpstream, UpstreamEvents } from './ramble';
import { rambleInstructions, spokenOnly } from './ramble-outline';

/**
 * Gemini Live as Ramble's upstream: the speaker's audio streams to one Live session, which transcribes it and calls
 * `add_task`, `edit_task`, and `delete_task` as each task becomes clear, the way Todoist's Ramble works. The session
 * hears the same dialect it hears from ElevenLabs: `session_started`, the transcript so far as a partial, and the
 * whole of it committed at the end, plus an `outline` with every tool call, so the caps and buffering stay in one
 * place.
 */

export const RAMBLE_LIVE_MODEL = 'gemini-3.1-flash-live-preview';
const LIVE_URL =
	'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
/**
 * After the end of the audio, how long Gemini may stay silent before the tasks are taken as they are, when every word
 * heard was already answered. Words still unanswered wait for their turn to complete, up to the session's cap.
 */
const QUIET_AFTER_END_MS = 800;

export type RawSocket = { send(text: string): void; close(): void };
/** Opens a WebSocket to `url`; resolves once it is open, and calls `close` when it closes after that. */
export type OpenSocket = (url: string, events: UpstreamEvents) => Promise<RawSocket>;

const FIELDS = {
	title: { type: 'STRING' },
	when: { type: 'STRING', description: 'Due date, time, and repeat as a short English phrase, or empty.' },
	reminder: { type: 'STRING', description: 'A reminder phrase such as "30 minutes before", or empty.' },
	priority: { type: 'INTEGER', description: '1 to 4, or 0 for none.' },
	project: { type: 'STRING', description: 'The exact name of an existing project, or empty.' },
	labels: { type: 'ARRAY', items: { type: 'STRING' } },
	notes: { type: 'STRING' },
};

const TOOLS = [
	{
		functionDeclarations: [
			{
				name: 'add_task',
				description: 'Add a task the speaker just said.',
				parameters: {
					type: 'OBJECT',
					properties: {
						id: { type: 'STRING', description: 'A short id you choose (1, 2, 3, ...), unique in this ramble.' },
						...FIELDS,
						parent_id: { type: 'STRING', description: 'The id of the task this is a subtask of, or empty.' },
					},
					required: ['id', 'title'],
				},
			},
			{
				name: 'edit_task',
				description: 'Change a task added earlier, for a correction or a back-reference. Pass only what changes.',
				parameters: { type: 'OBJECT', properties: { id: { type: 'STRING' }, ...FIELDS }, required: ['id'] },
			},
			{
				name: 'delete_task',
				description: 'Remove a task added earlier ("scratch that", "forget the apples").',
				parameters: { type: 'OBJECT', properties: { id: { type: 'STRING' } }, required: ['id'] },
			},
		],
	},
];

export function liveInstructions(context: Omit<RambleOutlineInput, 'transcript'>): string {
	return `${rambleInstructions(context)}

You are listening live. Never speak. Only call tools, as soon as each task is clear, while the speaker is still talking:
- add_task for each new task, and for each subtask with parent_id set to its parent's id.
- edit_task when the speaker corrects or refers back to a task you already added.
- delete_task when the speaker removes one.
Each call is final: never repeat a call for something you already added.`;
}

type Node = RambleOutlineTask & { id: string; parent: string };
type Args = Partial<Record<keyof typeof FIELDS | 'id' | 'parent_id', unknown>>;

const MONTHS = [
	'january',
	'february',
	'march',
	'april',
	'may',
	'june',
	'july',
	'august',
	'september',
	'october',
	'november',
	'december',
];
/** The model sometimes writes an ISO date, which quick add does not read. */
const phrase = (when: string) =>
	when.replace(/\b\d{4}-(\d{2})-(\d{2})\b/, (_, m, d) => `${MONTHS[Number(m) - 1]} ${Number(d)}`);

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** The tasks the tool calls built, kept on the server so every outline is whole. */
export class LiveTasks {
	readonly #nodes = new Map<string, Node>();
	#next = 1;

	/** Applies one call and returns what the model is told. A repeated `add_task` updates the task it repeats. */
	apply(name: string, args: Args): Record<string, unknown> {
		if (name === 'add_task') {
			const parent = text(args.parent_id);
			const title = text(args.title).trim();
			const same = [...this.#nodes.values()].find(
				node => node.parent === parent && node.title.trim().toLowerCase() === title.toLowerCase(),
			);
			if (same) {
				this.#update(same, { ...args, title: undefined });
				return { id: same.id, note: 'Already in the list. Do not add it again.' };
			}
			const id = text(args.id) || `auto${this.#next++}`;
			this.#nodes.set(id, {
				id,
				parent,
				title,
				when: '',
				reminder: '',
				priority: 0,
				project: '',
				labels: [],
				notes: '',
				subtasks: [],
			});
			this.#update(this.#nodes.get(id)!, args);
			return { id, note: 'Added. Use edit_task to change it.' };
		}
		const node = this.#nodes.get(text(args.id));
		if (!node) return { error: 'No task has that id.' };
		if (name === 'edit_task') this.#update(node, args);
		if (name === 'delete_task') this.#delete(node.id);
		return { ok: true };
	}

	outline(): RambleOutline {
		const build = (parent: string): RambleOutlineTask[] =>
			[...this.#nodes.values()]
				.filter(node => node.parent === parent)
				.map(({ id, parent: _, ...task }) => ({ ...task, when: phrase(task.when), subtasks: build(id) }));
		return { tasks: build('') };
	}

	#update(node: Node, args: Args) {
		if (typeof args.title === 'string' && args.title.trim()) node.title = args.title.trim();
		if (typeof args.when === 'string') node.when = args.when;
		if (typeof args.reminder === 'string') node.reminder = args.reminder;
		if (typeof args.priority === 'number') node.priority = Math.max(0, Math.min(4, Math.round(args.priority)));
		if (typeof args.project === 'string') node.project = args.project;
		if (Array.isArray(args.labels)) node.labels = args.labels.filter(label => typeof label === 'string');
		if (typeof args.notes === 'string') node.notes = args.notes;
	}

	#delete(id: string) {
		this.#nodes.delete(id);
		for (const node of [...this.#nodes.values()]) if (node.parent === id) this.#delete(node.id);
	}
}

type LiveMessage = {
	setupComplete?: unknown;
	serverContent?: { inputTranscription?: { text?: string }; turnComplete?: boolean };
	toolCall?: { functionCalls?: Array<{ id: string; name: string; args?: Args }> };
};

type AudioChunk = { audio_base_64?: string; commit?: boolean; sample_rate?: number };

export function geminiUpstream(apiKey: string, open: OpenSocket): ConnectUpstream {
	return async ({ context }, events) => {
		const tasks = new LiveTasks();
		let transcript = '';
		let ending = false;
		/**
		 * Speech the model has not finished a turn on. True from the start: Gemini transcribes a turn only once it hears
		 * a pause, so a ramble with none arrives whole after the end of the audio.
		 */
		let unanswered = true;
		let quiet: ReturnType<typeof setTimeout> | undefined;
		const emit = (message: Record<string, unknown>) => events.message(JSON.stringify(message));
		let finished = false;
		const finish = () => {
			if (finished) return;
			finished = true;
			clearTimeout(quiet);
			emit({ message_type: 'committed_transcript', text: transcript });
		};
		/** Each message after the end of the audio restarts the wait, so the last tool calls are never cut off. */
		const settle = () => {
			clearTimeout(quiet);
			if (!unanswered) quiet = setTimeout(finish, QUIET_AFTER_END_MS);
		};

		let socket: RawSocket | null = null;
		const onMessage = (raw: string) => {
			let message: LiveMessage;
			try {
				message = JSON.parse(raw);
			} catch {
				return;
			}
			if (message.setupComplete) return emit({ message_type: 'session_started' });
			const heard = message.serverContent?.inputTranscription?.text;
			if (heard) {
				// Each turn's transcription starts bare, so a sentence after a pause would run into the one before it.
				const gap = /[.!?,]$/.test(transcript) && !/^\s/.test(heard) ? ' ' : '';
				transcript += gap + heard;
				unanswered = true;
				emit({ message_type: 'partial_transcript', text: transcript });
			}
			if (message.serverContent?.turnComplete) unanswered = false;
			if (ending) settle();
			const calls = message.toolCall?.functionCalls ?? [];
			if (calls.length) {
				const functionResponses = calls.map(call => ({
					id: call.id,
					name: call.name,
					response: tasks.apply(call.name, call.args ?? {}),
				}));
				socket?.send(JSON.stringify({ toolResponse: { functionResponses } }));
				emit({ message_type: 'outline', outline: spokenOnly(tasks.outline(), transcript) });
			}
			if (ending && message.serverContent?.turnComplete) finish();
		};

		// The preview model sometimes refuses a new session with 409 ABORTED, so one failed open is retried.
		for (let attempt = 0; !socket; attempt++) {
			try {
				socket = await open(`${LIVE_URL}?key=${encodeURIComponent(apiKey)}`, {
					message: onMessage,
					close: events.close,
				});
			} catch (error) {
				if (attempt >= 1) throw error;
			}
		}
		socket.send(
			JSON.stringify({
				setup: {
					model: `models/${RAMBLE_LIVE_MODEL}`,
					// Live models answer only in audio. The instructions forbid speaking, and none comes back.
					generationConfig: { responseModalities: ['AUDIO'], temperature: 0.2 },
					systemInstruction: { parts: [{ text: liveInstructions(context) }] },
					tools: TOOLS,
					inputAudioTranscription: {},
				},
			}),
		);
		const live = socket;
		return {
			send(raw) {
				const chunk = JSON.parse(raw) as AudioChunk;
				if (chunk.audio_base_64) {
					live.send(
						JSON.stringify({
							realtimeInput: { audio: { data: chunk.audio_base_64, mimeType: `audio/pcm;rate=${chunk.sample_rate}` } },
						}),
					);
				}
				if (!chunk.commit || ending) return;
				ending = true;
				live.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
				settle();
			},
			close() {
				clearTimeout(quiet);
				live.close();
			},
		};
	};
}
