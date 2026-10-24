import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { spokenOnly } from './ramble-outline';
import { aiAccount, signUp, testApp, type Session, type TestApp } from './test-app';

const input = {
	transcript: 'call the dentist thursday, actually friday at 4pm',
	today: '2026-10-14',
	time: '14:00',
	projects: ['Home'],
	labels: ['calls'],
};

const gemini = (text: string, status = 200) =>
	new Response(
		JSON.stringify(
			status === 200 ? { candidates: [{ content: { parts: [{ text }] } }] } : { error: { message: text } },
		),
		{
			status,
			headers: { 'content-type': 'application/json' },
		},
	);

let withKey: TestApp;
let withoutKey: TestApp;
let owner: Session;
let other: Session;
beforeAll(async () => {
	withKey = await testApp({ env: { GEMINI_API_KEY: 'test-key' } });
	withoutKey = await testApp();
	owner = await signUp(withKey, 'Owner');
	other = await signUp(withoutKey, 'Other');
});
afterAll(async () => {
	await withKey.close();
	await withoutKey.close();
});

let upstream: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>> | null = null;
afterEach(() => {
	upstream?.mockRestore();
	upstream = null;
});

/** Answers Gemini's URL with `reply` and lets every other request through. */
function stubGemini(reply: () => Response) {
	const real = globalThis.fetch;
	const seen: Array<{
		url: string;
		body: { systemInstruction: { parts: Array<{ text: string }> }; contents: unknown };
	}> = [];
	upstream = spyOn(globalThis, 'fetch').mockImplementation((async (request: RequestInfo | URL, init?: RequestInit) => {
		const url = String(request instanceof Request ? request.url : request);
		if (!url.startsWith('https://generativelanguage.googleapis.com/')) return real(request, init);
		seen.push({ url, body: JSON.parse(String(init?.body)) });
		return reply();
	}) as typeof fetch);
	return seen;
}

const post = (app: TestApp, session: Session, body: unknown) =>
	app.fetch('/api/ramble/outline', { method: 'POST', headers: session.headers, body: JSON.stringify(body) });

describe('ramble outline', () => {
	test('returns the outline with every unsaid field filled empty, and tells Gemini the day and names', async () => {
		const seen = stubGemini(() =>
			gemini(
				JSON.stringify({
					tasks: [{ title: 'Call the dentist', when: 'friday at 4pm', subtasks: [{ title: 'Find the card' }] }],
				}),
			),
		);
		const response = await post(withKey, owner, input);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			tasks: [
				{
					title: 'Call the dentist',
					when: 'friday at 4pm',
					reminder: '',
					priority: 0,
					project: '',
					labels: [],
					notes: '',
					subtasks: [
						{
							title: 'Find the card',
							when: '',
							reminder: '',
							priority: 0,
							project: '',
							labels: [],
							notes: '',
							subtasks: [],
						},
					],
				},
			],
		});
		const instructions = seen[0]!.body.systemInstruction.parts[0]!.text;
		expect(instructions).toContain('Today is Wednesday 2026-10-14, and the time is 14:00.');
		expect(instructions).toContain('Existing projects: "Home".');
		expect(seen[0]!.body.contents).toEqual([{ role: 'user', parts: [{ text: `Ramble: ${input.transcript}` }] }]);
	});

	test('a Gemini failure is a bad gateway, so the client keeps the grammar', async () => {
		stubGemini(() => gemini('quota', 429));
		expect((await post(withKey, owner, input)).status).toBe(502);
		stubGemini(() => gemini('{"tasks": [{"when": "friday"}]}'));
		expect((await post(withKey, owner, input)).status).toBe(502);
	});

	test('without a key the route is unavailable', async () => {
		expect((await post(withoutKey, other, input)).status).toBe(503);
	});

	test('an AI account may not call it', async () => {
		const bot = await aiAccount(withKey, owner);
		expect((await post(withKey, bot, input)).status).toBe(403);
	});
});

describe('spokenOnly', () => {
	const task = (fields: Record<string, unknown>) => ({
		title: 'Task',
		when: '',
		reminder: '',
		priority: 0,
		project: '',
		labels: [],
		notes: '',
		subtasks: [],
		...fields,
	});

	test('drops projects, labels, and priorities the speaker never said', () => {
		const outline = {
			tasks: [task({ project: 'Finance', labels: ['calls'], priority: 1, subtasks: [task({ labels: ['errands'] })] })],
		};
		expect(spokenOnly(outline, 'call the bank, this is important')).toEqual({
			tasks: [task({ subtasks: [task({})] })],
		});
	});

	test('keeps the ones spoken, across punctuation and case', () => {
		const outline = { tasks: [task({ project: 'Side Project', labels: ['deep work'], priority: 2 })] };
		expect(spokenOnly(outline, 'for the side-project, Deep Work label, priority two')).toEqual(outline);
	});

	test('a name inside a longer word is not said', () => {
		const outline = { tasks: [task({ project: 'Work', labels: ['calls'] })] };
		expect(spokenOnly(outline, 'do my workout and recall the plan')).toEqual({ tasks: [task({})] });
	});
});
