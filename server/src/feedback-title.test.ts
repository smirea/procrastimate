import { afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import type { AgentTask } from '../../shared/sharing';
import { signUp, testApp, type Session, type TestApp } from './test-app';

const suggestion = {
	subject: 'Groceries Feedback',
	count: 2,
	prompt: '- On Button "Info": Make it bigger\n- On Header "My Lists": Remove the share button',
};
const placeholder = 'Groceries Feedback: 2 changes';

let app: TestApp;
let owner: Session;
beforeAll(async () => {
	app = await testApp({ env: { GEMINI_API_KEY: 'test-key' } });
	owner = await signUp(app, 'Owner');
});

let upstream: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>> | null = null;
afterEach(() => {
	upstream?.mockRestore();
	upstream = null;
});

/** Answers Gemini's URL once `reply` resolves, and lets every other request through. */
function stubGemini(reply: () => Promise<Response>) {
	const real = globalThis.fetch;
	const prompts: string[] = [];
	upstream = spyOn(globalThis, 'fetch').mockImplementation((async (request: RequestInfo | URL, init?: RequestInit) => {
		const url = String(request instanceof Request ? request.url : request);
		if (!url.startsWith('https://generativelanguage.googleapis.com/')) return real(request, init);
		prompts.push(JSON.parse(String(init?.body)).contents[0].parts[0].text);
		return reply();
	}) as typeof fetch);
	return prompts;
}

const gemini = (text: string, status = 200) =>
	Response.json(status === 200 ? { candidates: [{ content: { parts: [{ text }] } }] } : { error: { message: text } }, {
		status,
	});

async function create(body: unknown): Promise<AgentTask> {
	const response = await app.fetch('/api/tasks', {
		method: 'POST',
		headers: owner.headers,
		body: JSON.stringify(body),
	});
	expect(response.status).toBe(200);
	return response.json();
}

async function titleOf(id: string): Promise<string | undefined> {
	const view = (await (await app.fetch('/api/view', { headers: owner.headers })).json()) as { tasks: AgentTask[] };
	return view.tasks.find(task => task.id === id)?.title;
}

describe('feedback task names', () => {
	test('an untouched feedback task is renamed to the count, the subject, and the summary without its wrapping', async () => {
		const prompts = stubGemini(async () => gemini('"Bigger info button, remove the share button."\n'));
		const task = await create({ title: placeholder, titleSuggestion: suggestion });
		expect(task.title).toBe(placeholder);
		await app.settled();
		expect(prompts).toEqual([suggestion.prompt]);
		expect(await titleOf(task.id)).toBe('2 Groceries Feedback: Bigger info button, remove the share button');
	});

	test('a name changed before the summary arrives stays', async () => {
		let answer!: () => void;
		const answered = new Promise<void>(resolve => (answer = resolve));
		stubGemini(async () => {
			await answered;
			return gemini('bigger info button');
		});
		const task = await create({ title: placeholder, titleSuggestion: suggestion });
		await app.fetch(`/api/tasks?id=${task.id}`, {
			method: 'PATCH',
			headers: owner.headers,
			body: JSON.stringify({ title: 'Mine' }),
		});
		answer();
		await app.settled();
		expect(await titleOf(task.id)).toBe('Mine');
	});

	test('a failed or empty summary keeps the placeholder', async () => {
		stubGemini(async () => gemini('quota', 429));
		const refused = await create({ title: placeholder, titleSuggestion: suggestion });
		await app.settled();
		upstream?.mockRestore();
		stubGemini(async () => gemini(' "." '));
		const empty = await create({ title: placeholder, titleSuggestion: suggestion });
		await app.settled();
		expect([await titleOf(refused.id), await titleOf(empty.id)]).toEqual([placeholder, placeholder]);
	});
});
