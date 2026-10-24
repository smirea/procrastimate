import { describe, expect, test } from 'bun:test';
import { geminiUpstream, LiveTasks, type OpenSocket } from './ramble-gemini';
import type { RambleOutlineInput } from '../../shared/ramble/outline';
import type { UpstreamEvents } from './ramble';

const context: Omit<RambleOutlineInput, 'transcript'> = {
	today: '2026-10-14',
	time: '14:00',
	projects: ['Home'],
	labels: ['calls'],
};
const task = (title: string, fields: Record<string, unknown> = {}) => ({
	title,
	when: '',
	reminder: '',
	priority: 0,
	project: '',
	labels: [],
	notes: '',
	subtasks: [],
	...fields,
});

/** A fake Gemini Live: records what the upstream sends and lets the test answer as the server. */
function fakeLive() {
	const sent: Record<string, unknown>[] = [];
	const urls: string[] = [];
	let server: UpstreamEvents | null = null;
	let refusals = 0;
	const open: OpenSocket = async (url, events) => {
		urls.push(url);
		if (refusals > 0) {
			refusals--;
			throw new Error('409 ABORTED');
		}
		server = events;
		return { send: text => sent.push(JSON.parse(text)), close() {} };
	};
	return {
		open,
		sent,
		urls,
		refuse: (times: number) => (refusals = times),
		say: (message: unknown) => server!.message(JSON.stringify(message)),
	};
}

async function connect(live: ReturnType<typeof fakeLive>) {
	const heard: Record<string, unknown>[] = [];
	const upstream = await geminiUpstream('key', live.open)(
		{ engine: 'gemini', keyterms: [], cassette: null, context },
		{ message: text => heard.push(JSON.parse(text)), close() {} },
	);
	return { upstream, heard };
}

const chunk = (bytes: number, commit = false) =>
	JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: 'A'.repeat(bytes), commit, sample_rate: 16000 });

describe('geminiUpstream', () => {
	test('sets up a Live session that reads tasks with tools and transcribes the input', async () => {
		const live = fakeLive();
		await connect(live);
		const setup = live.sent[0]!.setup as {
			model: string;
			tools: Array<{ functionDeclarations: Array<{ name: string }> }>;
			inputAudioTranscription: unknown;
			systemInstruction: { parts: Array<{ text: string }> };
		};
		expect(setup.model).toBe('models/gemini-3.1-flash-live-preview');
		expect(setup.tools[0]!.functionDeclarations.map(tool => tool.name)).toEqual([
			'add_task',
			'edit_task',
			'delete_task',
		]);
		expect(setup.inputAudioTranscription).toEqual({});
		expect(setup.systemInstruction.parts[0]!.text).toContain('Existing projects: "Home".');
		expect(live.urls[0]).toEndWith('?key=key');
	});

	test('relays the transcript and the tool calls as outlines, and answers each call', async () => {
		const live = fakeLive();
		const { upstream, heard } = await connect(live);
		live.say({ setupComplete: {} });
		upstream.send(chunk(8));
		expect(live.sent[1]).toEqual({ realtimeInput: { audio: { data: 'AAAAAAAA', mimeType: 'audio/pcm;rate=16000' } } });
		live.say({ serverContent: { inputTranscription: { text: 'Call the dentist friday, ' } } });
		live.say({ serverContent: { inputTranscription: { text: 'priority one.' } } });
		live.say({ serverContent: { inputTranscription: { text: 'Oh' } } });
		live.say({
			toolCall: {
				functionCalls: [
					{
						id: 'c1',
						name: 'add_task',
						args: { id: '1', title: 'Call the dentist', when: 'friday', priority: 1, labels: ['calls'] },
					},
				],
			},
		});
		expect(heard).toEqual([
			{ message_type: 'session_started' },
			{ message_type: 'partial_transcript', text: 'Call the dentist friday, ' },
			{ message_type: 'partial_transcript', text: 'Call the dentist friday, priority one.' },
			{ message_type: 'partial_transcript', text: 'Call the dentist friday, priority one. Oh' },
			{ message_type: 'outline', outline: { tasks: [task('Call the dentist', { when: 'friday', priority: 1 })] } },
		]);
		expect(live.sent.at(-1)).toEqual({
			toolResponse: {
				functionResponses: [
					{ id: 'c1', name: 'add_task', response: { id: '1', note: 'Added. Use edit_task to change it.' } },
				],
			},
		});
	});

	test('ending the audio waits for the last turn, then commits', async () => {
		const live = fakeLive();
		const { upstream, heard } = await connect(live);
		live.say({ setupComplete: {} });
		upstream.send(chunk(0, true));
		expect(live.sent.at(-1)).toEqual({ realtimeInput: { audioStreamEnd: true } });
		live.say({ serverContent: { inputTranscription: { text: 'Buy milk.' } } });
		live.say({ serverContent: { turnComplete: true } });
		expect(heard.at(-1)).toEqual({ message_type: 'committed_transcript', text: 'Buy milk.' });
	});

	test('a refused open is tried once more', async () => {
		const live = fakeLive();
		live.refuse(1);
		await connect(live);
		expect(live.urls).toHaveLength(2);
	});
});

describe('LiveTasks', () => {
	test('nests by parent id, edits, deletes with children, and merges a repeated add', () => {
		const tasks = new LiveTasks();
		tasks.apply('add_task', { id: '1', title: 'Plan the party', when: '2026-10-16' });
		tasks.apply('add_task', { id: '2', title: 'Food', parent_id: '1' });
		tasks.apply('add_task', { id: '3', title: 'Pizza', parent_id: '2' });
		tasks.apply('add_task', { id: '4', title: 'Call mom' });
		expect(tasks.apply('add_task', { id: '9', title: 'call mom', when: 'tomorrow' })).toEqual({
			id: '4',
			note: 'Already in the list. Do not add it again.',
		});
		tasks.apply('edit_task', { id: '1', priority: 2 });
		expect(tasks.outline()).toEqual({
			tasks: [
				task('Plan the party', {
					when: 'october 16',
					priority: 2,
					subtasks: [task('Food', { subtasks: [task('Pizza')] })],
				}),
				task('Call mom', { when: 'tomorrow' }),
			],
		});
		tasks.apply('delete_task', { id: '2' });
		expect(tasks.apply('edit_task', { id: '3', title: 'Gone' })).toEqual({ error: 'No task has that id.' });
		expect(tasks.outline().tasks[0]!.subtasks).toEqual([]);
	});
});
