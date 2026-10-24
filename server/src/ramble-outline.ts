import { fromDateKey } from '../../shared/task';
import { escapeRegExp } from '../../shared/quick-add';
import {
	rambleOutlineSchema,
	type RambleOutline,
	type RambleOutlineInput,
	type RambleOutlineTask,
} from '../../shared/ramble/outline';

/**
 * Ramble's smart parse: Gemini reads the whole transcript, applies the speaker's corrections, and returns an outline
 * of tasks. It runs on the server so the key stays there. Clients resolve the outline's phrases and names locally.
 */

export type GeminiThinking = 'minimal' | 'low' | 'medium' | 'high';
export type GeminiModel = { model: string; thinking: GeminiThinking | null };

export const RAMBLE_GEMINI: GeminiModel = { model: 'gemini-3.5-flash', thinking: 'minimal' };

/** Past this the client has already fallen back to the grammar. */
export const OUTLINE_TIMEOUT_MS = 10_000;

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const SUBTASK_DEPTH = 3;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function rambleInstructions(input: Omit<RambleOutlineInput, 'transcript'>): string {
	const weekday = WEEKDAYS[fromDateKey(input.today).getDay()];
	const list = (names: readonly string[]) =>
		names.length ? names.map(name => JSON.stringify(name)).join(', ') : 'none';
	return `You turn a spoken ramble into to-do tasks for a task manager, the way Todoist Ramble does.
Today is ${weekday} ${input.today}, and the time is ${input.time}.
Existing projects: ${list(input.projects)}.
Existing labels: ${list(input.labels)}.

The transcript is live speech-to-text: it has filler, false starts, missing punctuation, and misheard words.

Corrections come first. When the speaker changes their mind, keep only the final version:
- "Thursday, actually Friday", "at 3, no wait, 4pm", "I mean", "make that", "change that to", "not X, Y", "sorry".
- They may point back at an earlier task ("the first one", "the dentist task", "that last one") to change its date, priority, title, or project, or to remove it.
- "Scratch that", "never mind", "forget that", "delete that", or "remove that" removes the task just said, or the task they name.
- Saying a task again with new details updates it. Never output the same task twice.

Structure:
- One task per separate action. Actions joined by "and", "also", "then", or "oh and" are separate tasks unless one is a step of the other.
- Items or steps the speaker lists for one task become its subtasks: things to buy at a store, parts of a project, "the steps are", "with subtasks", "which means", or a colon. The task's title then leaves the items out ("Go to the store", not "Go to the store and get milk").
- A subtask is the item as said, without the verb the list shares: "Milk", not "Get milk".
- When the speaker groups items under a heading ("for food get pizza and soda", "in the kitchen wipe the counters"), the heading is a subtask ("Food", "Kitchen") and its items are its subtasks.
- Spoken commands: "new task" or "next task" starts a task, "subtask" adds a subtask to the current task, "note" or "description" adds notes to the current task.
- Ignore chatter that is not a task, and "that's all" or "that's it" at the end.

Fields:
- title: a short imperative in the speaker's words. Drop filler and intent words such as "I need to", "remind me to", "don't forget to", "I should". Keep names, places, and details that tell tasks apart. Leave out the date, time, reminder, priority, project, and labels.
- when: the due date, time, and repeat as a short English phrase, after corrections: "tomorrow", "tomorrow at 4pm", "friday", "next friday", "october 30", "in 3 days", "today at noon", "tonight", "every monday at 9am", "every other week", "every month on the 1st", "every weekday". Count spans in days ("in 75 days", not "in 2.5 months"). Leave out morning, afternoon, and evening when no clock time was said. Use "saturday" for "this weekend". Empty when the speaker gave none. A date belongs only to the task it was said for, unless the speaker says it applies to several.
- reminder: only when the speaker asks to be reminded at a time other than the due time: "30 minutes before", "1 hour before", "1 day before", "at 9am", "tomorrow at 8am". "Remind me to call mom tomorrow" is a task due tomorrow with no reminder.
- priority: 1 for priority one, p1, urgent, high priority, top priority, or "my number one priority"; 2 for priority two or p2; 3 for priority three, p3, or medium priority; 4 for priority four, p4, or low priority. 0 when the speaker set none; calling something important is not a priority.
- project: the exact name of an existing project the speaker put the task in, or empty. "For the Work project, ..." applies to the tasks that follow it. Never invent one.
- labels: exact names of existing labels the speaker said for the task ("label it errands", "tag it calls"). Never infer a label from the task's meaning.
- notes: details the speaker gave as a note or description of the task, or empty.
- Write every time with am or pm, picking the one the task implies: dinner "at 6" is 6pm, a run "at 6" is 6am.
- Leave out every field the speaker did not set. Subtasks take no project. Keep the tasks in the order they were said.`;
}

type JsonSchema = Record<string, unknown>;

function taskSchema(depth: number, projects: readonly string[], labels: readonly string[]): JsonSchema {
	const properties: Record<string, JsonSchema> = {
		title: { type: 'string' },
		when: { type: 'string' },
		reminder: { type: 'string' },
		priority: { type: 'integer', enum: [0, 1, 2, 3, 4] },
		project: projects.length ? { type: 'string', enum: ['', ...new Set(projects)] } : { type: 'string', enum: [''] },
		labels: {
			type: 'array',
			items: labels.length ? { type: 'string', enum: [...new Set(labels)] } : { type: 'string' },
			maxItems: labels.length ? 10 : 0,
		},
		notes: { type: 'string' },
	};
	if (depth > 1) properties.subtasks = { type: 'array', items: taskSchema(depth - 1, projects, labels) };
	return {
		type: 'object',
		properties,
		required: ['title'],
		propertyOrdering: Object.keys(properties),
	};
}

export function outlineJsonSchema(projects: readonly string[], labels: readonly string[]): JsonSchema {
	return {
		type: 'object',
		properties: { tasks: { type: 'array', items: taskSchema(SUBTASK_DEPTH, projects, labels) } },
		required: ['tasks'],
	};
}

export class RambleOutlineError extends Error {}

export async function outlineRamble(
	input: RambleOutlineInput,
	apiKey: string,
	model: GeminiModel = RAMBLE_GEMINI,
	signal?: AbortSignal,
): Promise<RambleOutline> {
	const response = await fetch(`${GEMINI_URL}/${model.model}:generateContent`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
		signal,
		body: JSON.stringify({
			systemInstruction: { parts: [{ text: rambleInstructions(input) }] },
			contents: [{ role: 'user', parts: [{ text: `Ramble: ${input.transcript}` }] }],
			generationConfig: {
				temperature: 0,
				responseMimeType: 'application/json',
				responseJsonSchema: outlineJsonSchema(input.projects, input.labels),
				...(model.thinking ? { thinkingConfig: { thinkingLevel: model.thinking } } : {}),
			},
		}),
	});
	const body = (await response.json().catch(() => null)) as {
		candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
		error?: { message?: string };
	} | null;
	if (!response.ok) throw new RambleOutlineError(`Gemini ${response.status}: ${body?.error?.message ?? 'no body'}`);
	const text = body?.candidates?.[0]?.content?.parts
		?.filter(part => !part.thought)
		.map(part => part.text ?? '')
		.join('');
	if (!text) throw new RambleOutlineError('Gemini returned no text');
	const parsed = rambleOutlineSchema.safeParse(withDefaults(JSON.parse(text)));
	if (!parsed.success) throw new RambleOutlineError(`Gemini returned an invalid outline: ${parsed.error.message}`);
	return spokenOnly(parsed.data, input.transcript);
}

const EMPTY_TASK = { when: '', reminder: '', priority: 0, project: '', labels: [], notes: '', subtasks: [] };

/** Gemini leaves out the fields the speaker did not set, and the deepest tasks have no `subtasks` key. */
function withDefaults(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(withDefaults);
	if (!value || typeof value !== 'object') return value;
	const entries = Object.entries(value).map(([key, inner]) => [key, withDefaults(inner)] as const);
	const object = Object.fromEntries(entries) as Record<string, unknown>;
	return 'title' in object ? { ...EMPTY_TASK, ...object } : object;
}

const PRIORITY_WORD = /\b(?:priority|p\s?(?:[1-4]|one|two|three|four)|urgent|asap)\b/i;

function said(name: string, transcript: string): boolean {
	const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
	if (!words.length) return false;
	return new RegExp(
		String.raw`(?<![\p{L}\p{N}])${words.map(escapeRegExp).join(String.raw`[^\p{L}\p{N}]+`)}(?:'?s)?(?![\p{L}\p{N}])`,
		'iu',
	).test(transcript);
}

/**
 * Drops what the model inferred rather than heard: a project or label whose name the speaker never said (`call the
 * bank` is not the `calls` label), and a priority without a priority word (`this is important`).
 */
export function spokenOnly(outline: RambleOutline, transcript: string): RambleOutline {
	const prioritized = PRIORITY_WORD.test(transcript);
	const clean = (task: RambleOutlineTask): RambleOutlineTask => ({
		...task,
		priority: prioritized ? task.priority : 0,
		project: task.project && said(task.project, transcript) ? task.project : '',
		labels: task.labels.filter(label => said(label, transcript)),
		subtasks: task.subtasks.map(clean),
	});
	return { tasks: outline.tasks.map(clean) };
}
