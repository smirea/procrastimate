import { writeFileSync } from 'node:fs';
import type { CDPSession, Page, Request } from '@playwright/test';
import { label, project, section, task } from '../../shared/testing';
import type { Task } from '../../shared/model';
import { App, deviceContext, expect, NOW, syncWrites, test } from '../e2e/fixtures';
import { rowIdOf } from '../../shared/rows';

/**
 * Production's shape on 2026-11-05: 399 tasks of which 330 completed, 6 projects, 4 sections, 1 label, 31 tasks with
 * attachments, 73 KB of notes. PERF_SCALE multiplies the task count to expose work that grows with it.
 */
const SCALE = Number(process.env.PERF_SCALE ?? 1);
const CPU = Number(process.env.PERF_CPU ?? 4);
const OPEN = 69 * SCALE;
const DONE = 330 * SCALE;
const OUT = process.env.PERF_OUT ?? `perf-results-x${SCALE}.json`;

type Sample = {
	action: string;
	/** The longest input-to-next-paint of the action's events, as INP counts it. */
	inp: number;
	events: number;
	/** Main-thread time inside long animation frames, beyond 50 ms each. */
	blocking: number;
	frames: number;
	worst: string | null;
	rows: number;
	readMs: number;
	requests: string[];
	wall: number;
};

const samples: Sample[] = [];
const PROFILE = process.env.PERF_PROFILE ? new RegExp(process.env.PERF_PROFILE) : null;
let cdp: CDPSession | null = null;

type ProfileNode = {
	id: number;
	callFrame: { functionName: string; url: string; lineNumber: number };
	hitCount: number;
	children?: number[];
};

/** Self time per function, from a CDP CPU profile, so a slow action names what it ran. */
function hottest(profile: { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] }) {
	const self = new Map<number, number>();
	profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000));
	const parent = new Map<number, number>();
	for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
	const byId = new Map(profile.nodes.map(n => [n.id, n]));
	const name = (n: ProfileNode) =>
		`${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').at(-1)}:${n.callFrame.lineNumber}`;
	const selfBy = new Map<string, number>();
	const totalBy = new Map<string, number>();
	for (const [id, ms] of self) {
		const node = byId.get(id)!;
		selfBy.set(name(node), (selfBy.get(name(node)) ?? 0) + ms);
		const seen = new Set<string>();
		for (let at: number | undefined = id; at !== undefined; at = parent.get(at)) {
			const key = name(byId.get(at)!);
			if (seen.has(key)) continue;
			seen.add(key);
			totalBy.set(key, (totalBy.get(key) ?? 0) + ms);
		}
	}
	const top = (m: Map<string, number>) =>
		[...m]
			.filter(([k]) => !k.startsWith('('))
			.toSorted((a, b) => b[1] - a[1])
			.slice(0, 25)
			.map(([k, v]) => `${v.toFixed(1).padStart(7)}ms ${k}`);
	const stacks = new Map<string, number>();
	const wanted = process.env.PERF_STACK;
	if (wanted)
		for (const [id, ms] of self) {
			if (byId.get(id)!.callFrame.functionName !== wanted) continue;
			const chain: string[] = [];
			for (let at: number | undefined = id; at !== undefined; at = parent.get(at))
				chain.push(byId.get(at)!.callFrame.functionName || '?');
			const key = chain
				.filter(
					n =>
						!/^(\?|get|update_reaction|update_effect|execute_derived|is_dirty|run_all|flush|#process|#traverse)$/.test(
							n,
						),
				)
				.slice(0, 14)
				.join(' < ');
			stacks.set(key, (stacks.get(key) ?? 0) + ms);
		}
	return {
		self: [...top(selfBy), ...[...stacks].map(([k, v]) => `stack ${v.toFixed(1)}ms ${k}`)],
		total: top(totalBy),
	};
}

function dataset(me: string) {
	const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
	const projects = Array.from({ length: 6 }, (_, i) =>
		project(crypto.randomUUID(), { name: `Project ${i + 1}`, order: i, createdAt: i + 1 }),
	);
	const sections = Array.from({ length: 4 }, (_, i) =>
		section(crypto.randomUUID(), projects[0]!.id, { name: `Section ${i + 1}`, order: i, createdAt: i + 1 }),
	);
	const labels = [label(crypto.randomUUID(), { name: 'errands', createdAt: 1 })];
	let createdAt = NOW.getTime() - (OPEN + DONE) * 60_000;
	const notes = (i: number) =>
		i % 6 === 0
			? 'Some longer notes with a [link](https://example.com) and detail. '.repeat(i % 24 === 0 ? 40 : 3)
			: '';
	const tasks: Task[] = [];
	for (let i = 0; i < OPEN + DONE; i++) {
		const done = i >= OPEN;
		const projectId = i % 3 === 0 ? null : projects[i % 6]!.id;
		tasks.push(
			task(crypto.randomUUID(), {
				title: `${done ? 'Done' : 'Open'} task ${i + 1} with a realistic length title`,
				notes: notes(i),
				projectId,
				sectionId: projectId === projects[0]!.id && i % 2 ? sections[i % 4]!.id : null,
				labelIds: i % 11 === 0 ? [labels[0]!.id] : [],
				due: i % 4 === 0 ? { date: day((i % 15) - 5), time: i % 8 === 0 ? '09:00' : null } : null,
				recurrence: i % 23 === 0 ? { interval: 1, unit: 'day' } : null,
				priority: ((i % 4) + 1) as Task['priority'],
				createdAt: createdAt++,
				order: i,
				completedAt: done ? NOW.getTime() - (i - OPEN) * 3_600_000 : null,
				createdBy: me,
			}),
		);
	}
	const place = {
		name: 'Parkweg 1',
		address: 'Berlin',
		latitude: 52.52,
		longitude: 13.405,
		radius: 500,
		trigger: 'arrive' as const,
	};
	const start = NOW.getTime() + 86_400_000;
	const event = {
		id: 'standup',
		title: 'Team standup',
		allDay: false,
		series: true,
		edge: 'during' as const,
		minutes: 0,
		occurrences: [{ start, end: start + 1_800_000, original: start }],
	};
	for (let i = 1; i < 6; i++) tasks[i * 5]!.location = place;
	for (let i = 1; i < 4; i++) tasks[i * 7]!.event = event as never;
	for (let i = 0; i < OPEN; i += 17)
		tasks.push(
			task(crypto.randomUUID(), {
				title: `Subtask of ${i + 1}`,
				parentId: tasks[i]!.id,
				projectId: tasks[i]!.projectId,
				createdAt: createdAt++,
				createdBy: me,
			}),
		);
	return { projects, sections, labels, tasks };
}

async function seed(app: App, page: Page) {
	const me = ((await (await page.request.get('/api/me')).json()) as { id: string }).id;
	const data = dataset(me);
	const { ENTITY_TABLES } = await import('../../shared/db/schema');
	const { toWire } = await import('../../shared/db/wire');
	const values = (kind: keyof typeof ENTITY_TABLES, fields: Record<string, unknown>) =>
		toWire(ENTITY_TABLES[kind], { ...fields, userId: me });
	const writes = [
		...data.projects.map(p => ({ op: 'put', table: 'projects', id: p.id, values: values('project', p) })),
		...data.sections.map(s => ({ op: 'put', table: 'sections', id: s.id, values: values('section', s) })),
		...data.labels.map(l => ({ op: 'put', table: 'labels', id: l.id, values: values('label', l) })),
		...data.tasks.map(t => ({ op: 'put', table: 'tasks', id: rowIdOf('task', t.id, me), values: values('task', t) })),
	];
	for (let i = 0; i < writes.length; i += 400)
		expect(await syncWrites(page.request, writes.slice(i, i + 400))).toEqual([]);
	const last = data.tasks.at(-1)!;
	await expect
		.poll(() => page.evaluate(id => window.procrastimate.entity('task', id), last.id), { timeout: 60_000 })
		.toMatchObject({ id: last.id });
	return { me, data };
}

const OBSERVE = () => {
	type Frame = {
		duration: number;
		blockingDuration: number;
		scripts: { sourceFunctionName: string; sourceURL: string; invoker: string; duration: number }[];
	};
	const state = { events: [] as { name: string; duration: number }[], frames: [] as Frame[] };
	new PerformanceObserver(list => {
		for (const e of list.getEntries())
			if ((e as PerformanceEventTiming).interactionId) state.events.push({ name: e.name, duration: e.duration });
	}).observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit);
	new PerformanceObserver(list => {
		for (const e of list.getEntries()) state.frames.push(e as unknown as Frame);
	}).observe({ type: 'long-animation-frame', buffered: true });
	(window as unknown as { __perf: typeof state }).__perf = state;
};

async function measure(page: Page, app: App, action: string, run: () => Promise<unknown>, { settle = true } = {}) {
	const requests: string[] = [];
	const onRequest = (r: Request) => {
		const { pathname } = new URL(r.url());
		if (pathname.startsWith('/api/')) requests.push(`${r.method()} ${pathname}`);
	};
	page.on('request', onRequest);
	const before = await page.evaluate(() => {
		const p = (window as unknown as { __perf: { events: unknown[]; frames: unknown[] } }).__perf;
		p.events = [];
		p.frames = [];
		return window.procrastimate.reads();
	});
	const profiling = PROFILE?.test(action) && cdp;
	if (profiling) {
		await cdp!.send('Profiler.enable');
		await cdp!.send('Profiler.setSamplingInterval', { interval: 200 });
		await cdp!.send('Profiler.start');
	}
	const started = Date.now();
	await run();
	// Listening animates until Ramble stops, so that step cannot wait for every animation to end.
	if (settle) await app.settle();
	await page.waitForTimeout(400);
	const wall = Date.now() - started;
	if (profiling) {
		const { profile } = await cdp!.send('Profiler.stop');
		const { self, total } = hottest(profile as never);
		console.log(`profile ${action}\n  self:\n    ${self.join('\n    ')}\n  total:\n    ${total.join('\n    ')}`);
	}
	page.off('request', onRequest);
	const result = await page.evaluate(() => {
		const p = (
			window as unknown as {
				__perf: {
					events: { duration: number }[];
					frames: {
						duration: number;
						blockingDuration: number;
						scripts: { sourceFunctionName: string; sourceURL: string; invoker: string; duration: number }[];
					}[];
				};
			}
		).__perf;
		const worst = p.frames.toSorted((a, b) => b.duration - a.duration)[0];
		const script = worst?.scripts.toSorted((a, b) => b.duration - a.duration)[0];
		return {
			inp: Math.max(0, ...p.events.map(e => e.duration)),
			events: p.events.length,
			blocking: p.frames.reduce((sum, f) => sum + f.blockingDuration, 0),
			frames: p.frames.length,
			worst: worst
				? `${Math.round(worst.duration)}ms ${script ? `${script.invoker} ${script.sourceFunctionName || '?'}@${script.sourceURL.split('/').at(-1)} ${Math.round(script.duration)}ms` : ''}`
				: null,
			reads: window.procrastimate.reads(),
		};
	});
	const sample: Sample = {
		action,
		inp: Math.round(result.inp),
		events: result.events,
		blocking: Math.round(result.blocking),
		frames: result.frames,
		worst: result.worst,
		rows: result.reads.rows - before.rows,
		readMs: Math.round(result.reads.ms - before.ms),
		requests,
		wall,
	};
	samples.push(sample);
	console.log(
		`${action.padEnd(38)} inp ${String(sample.inp).padStart(4)}  block ${String(sample.blocking).padStart(5)}  frames ${String(sample.frames).padStart(2)}  rows ${String(sample.rows).padStart(5)}/${sample.readMs}ms  api ${requests.length}  wall ${wall}ms  ${sample.worst ?? ''}`,
	);
}

test.use({
	permissions: ['microphone', 'clipboard-read', 'clipboard-write'],
	launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

/** Ramble's socket answers from a recorded session instead of ElevenLabs. */
const CASSETTE = () => {
	const Native = window.WebSocket;
	window.WebSocket = class extends Native {
		constructor(url: string | URL, protocols?: string | string[]) {
			const next = new URL(url, location.href);
			if (next.pathname === '/api/ramble/socket') next.searchParams.set('cassette', 'party');
			super(next, protocols);
		}
	};
};

async function throttle(page: Page) {
	cdp = await page.context().newCDPSession(page);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
}

test('every screen, input, and action', async ({ app, page }) => {
	test.setTimeout(900_000);
	page.setDefaultTimeout(15_000);
	await page.addInitScript(OBSERVE);
	await page.addInitScript(CASSETTE);
	await page.evaluate(OBSERVE);
	const { data } = await seed(app, page);
	await app.reload();
	await throttle(page);

	const bootRequests: string[] = [];
	page.on('request', r => {
		const { pathname } = new URL(r.url());
		bootRequests.push(pathname);
	});
	const boot = Date.now();
	await page.reload();
	await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible({ timeout: 60_000 });
	const firstHeading = Date.now() - boot;
	await expect(app.row(data.tasks[0]!.title).or(page.locator('[data-task]').first())).toBeVisible();
	const firstRow = Date.now() - boot;
	const nav = await page.evaluate(() => {
		const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
		const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
		return {
			domContentLoaded: Math.round(n?.domContentLoadedEventEnd ?? -1),
			transfer: resources.reduce((s, r) => s + r.transferSize, 0),
			decoded: resources.reduce((s, r) => s + r.decodedBodySize, 0),
			scripts: resources.filter(r => r.initiatorType === 'script' || r.name.endsWith('.js')).length,
			slowest: resources
				.toSorted((a, b) => b.duration - a.duration)
				.slice(0, 5)
				.map(r => `${r.name.split('/').at(-1)} ${Math.round(r.duration)}ms`),
			heap: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0,
		};
	});
	console.log('boot', { firstHeading, firstRow, ...nav, api: bootRequests.filter(p => p.startsWith('/api/')) });
	await page.waitForTimeout(1500);

	if (process.env.PERF_FIRST_QUICK_ADD) {
		await measure(page, app, 'open quick add first (q)', () => app.openQuickAdd());
		await measure(page, app, 'type first quick add title', () =>
			app.taskInput().pressSequentially('Call mom tomorrow 5pm', { delay: 30 }),
		);
		await app.closeQuickAdd();
	}
	const views = [
		'Inbox',
		'No date',
		'Tomorrow',
		'This week',
		'Completed',
		...data.projects.map(p => p.name),
		'errands',
	];
	for (const view of views) await measure(page, app, `open ${view}`, () => app.go(view));
	await measure(page, app, 'open Inbox again', () => app.go('Inbox'));

	const inboxTask = data.tasks.find(t => !t.projectId && !t.completedAt && !t.parentId)!;
	await measure(page, app, 'open task details', async () => {
		await app.row(inboxTask.title).getByRole('button', { name: inboxTask.title, exact: true }).click();
		await expect(app.details()).toBeVisible();
	});
	const title = app.details().getByRole('textbox', { name: 'Title' });
	await measure(page, app, 'type 10 chars in details title', () => title.pressSequentially(' and more', { delay: 30 }));
	await measure(page, app, 'commit title (Enter)', () => title.press('Enter'));
	const notes = app.details().getByRole('textbox', { name: 'Notes' });
	await measure(page, app, 'type 20 chars in notes', async () => {
		await notes.click();
		await notes.pressSequentially('notes typed by hand.', { delay: 30 });
	});
	await measure(page, app, 'set priority 1', async () => {
		await app
			.details()
			.getByRole('button', { name: /^Priority \d$/ })
			.click();
		await page
			.getByRole('menuitemradio', { name: /Priority 1/ })
			.or(page.getByRole('option', { name: /Priority 1/ }))
			.or(page.getByRole('button', { name: /^Priority 1/ }))
			.first()
			.click();
	});
	await measure(page, app, 'close details', () => app.closeDetails());
	const other = (await page.locator('[data-task]').nth(3).getAttribute('data-task'))!;
	await measure(page, app, 'open another task details', async () => {
		await app.row(other).getByRole('button', { name: other, exact: true }).click();
		await expect(app.details()).toBeVisible();
	});
	await app.closeDetails();

	await measure(page, app, 'open quick add (q)', () => app.openQuickAdd());
	await measure(page, app, 'type plain title', () =>
		app.taskInput().pressSequentially('Buy groceries for the week', { delay: 30 }),
	);
	await measure(page, app, 'type date phrase', () => app.taskInput().pressSequentially(' tomorrow 5pm', { delay: 30 }));
	await measure(page, app, 'type #project autocomplete', () =>
		app.taskInput().pressSequentially(' #Proj', { delay: 30 }),
	);
	await measure(page, app, 'type @label autocomplete', async () => {
		await app
			.taskInput()
			.press('Escape')
			.catch(() => {});
		await app.taskInput().pressSequentially(' @err', { delay: 30 });
	});
	await app.taskInput().press('Enter');
	await measure(page, app, 'save quick add (Enter)', () => app.save());
	await measure(page, app, 'close quick add', () => app.closeQuickAdd().catch(() => page.keyboard.press('Escape')));

	await app.go('Inbox');
	const toComplete = (await page.locator('[data-task]').nth(2).getAttribute('data-task'))!;
	await measure(page, app, 'complete a task', () =>
		app
			.row(toComplete)
			.getByRole('checkbox', { name: `Complete ${toComplete}` })
			.click(),
	);
	await measure(page, app, 'undo complete', async () => {
		const undo = page.getByRole('button', { name: 'Undo' });
		if (await undo.isVisible()) await undo.click();
	});

	await measure(page, app, 'open search (/)', () => app.openSearch());
	await measure(page, app, 'type search query', () =>
		page.getByRole('combobox', { name: 'Search' }).pressSequentially('task 12', { delay: 40 }),
	);
	await measure(page, app, 'close search', () => page.keyboard.press('Escape'));

	await measure(page, app, 'open settings', () => app.openSettings());
	await measure(page, app, 'switch theme dark', () => app.themeOption('Dark').click());
	await measure(page, app, 'switch theme light', () => app.themeOption('Light').click());
	await measure(page, app, 'close settings', () => page.keyboard.press('Escape'));

	const remote = data.tasks.find(t => !t.projectId && !t.completedAt && !t.parentId)!;
	const me = ((await (await page.request.get('/api/me')).json()) as { id: string }).id;
	await expect.poll(() => app.pending(), { timeout: 15_000 }).toBe(0);
	await measure(page, app, 'edit from another device -> row', async () => {
		const renamed = `${remote.title} remote`;
		const seen = page.evaluate(
			name =>
				new Promise<number>(resolve => {
					const t0 = performance.now();
					const check = () =>
						document.querySelector(`[data-task="${CSS.escape(name)}"]`)
							? resolve(performance.now() - t0)
							: requestAnimationFrame(check);
					check();
				}),
			renamed,
		);
		await syncWrites(page.request, [
			{ op: 'patch', table: 'tasks', id: rowIdOf('task', remote.id, me), values: { title: renamed } },
		]);
		console.log('remote edit visible after', Math.round(await seen), 'ms');
	});

	await measure(page, app, 'open place view', () => app.go('Parkweg 1'));
	await measure(page, app, 'open event view', async () => {
		await page
			.getByRole('navigation', { name: 'Main' })
			.getByRole('link', { name: /Team standup/ })
			.click();
		await expect(page.getByRole('heading', { level: 1, name: /Team standup/ })).toBeVisible();
	});
	await app.go('Inbox');

	await app.openSettings();
	await app.dictationOption('ElevenLabs').click();
	await page.keyboard.press('Escape');
	await app.openQuickAdd();
	const drawer = page.getByRole('dialog', { name: 'Ramble' });
	await measure(
		page,
		app,
		'ramble: open and stream tasks',
		async () => {
			await app.quickAdd().getByRole('button', { name: 'Ramble' }).click();
			await expect(drawer.getByRole('list', { name: 'Spoken tasks' }).getByText('Bread')).toBeVisible({
				timeout: 30_000,
			});
		},
		{ settle: false },
	);
	await measure(page, app, 'ramble: stop listening', async () => {
		const stop = drawer.getByRole('button', { name: 'Stop listening' });
		if (await stop.isVisible()) await stop.click();
		await expect(drawer.getByRole('button', { name: /^Add \d+ tasks?$/ })).toBeVisible();
	});
	await measure(page, app, 'ramble: save all', async () => {
		await drawer.getByRole('button', { name: /^Add \d+ tasks?$/ }).click();
		await expect(drawer).toBeHidden();
	});
	if (await app.quickAdd().isVisible()) await app.closeQuickAdd();

	await app.openSettings();
	await measure(page, app, 'import a Todoist backup', async () => {
		await app.importBackup();
		await expect(app.importSummary()).toBeVisible({ timeout: 30_000 });
	});
	await page.keyboard.press('Escape');

	await app.go(data.projects[1]!.name);
	const sheet = page.getByRole('dialog', { name: 'Share' });
	await measure(page, app, 'open share sheet', async () => {
		await (await app.listMenu()).getByRole('button', { name: 'Share' }).click();
		await expect(sheet).toBeVisible();
	});
	await measure(page, app, 'type a person to share with', () =>
		sheet.getByRole('textbox', { name: 'Email or name' }).pressSequentially('someone', { delay: 40 }),
	);
	await measure(page, app, 'create a public link', async () => {
		await sheet.getByRole('button', { name: 'Copy link' }).click();
		await expect(sheet.getByLabel('Link')).toHaveText(/\/s\/.+/);
	});
	const link = new URL((await sheet.getByLabel('Link').textContent())!);
	const visitor = await deviceContext(page.context().browser()!);
	const guest = await visitor.newPage();
	const visitorCdp = await visitor.newCDPSession(guest);
	await visitorCdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
	const opened = Date.now();
	await guest.goto(link.pathname);
	await expect(guest.getByRole('heading', { level: 1, name: data.projects[1]!.name })).toBeVisible({ timeout: 30_000 });
	await expect(guest.locator('[data-task]').first()).toBeVisible();
	console.log('public link first row after', Date.now() - opened, 'ms');
	await visitor.close();

	const heap = await page.evaluate(
		() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0,
	);
	writeFileSync(
		OUT,
		JSON.stringify(
			{ scale: SCALE, cpu: CPU, boot: { firstHeading, firstRow, ...nav }, heapAfter: heap, samples },
			null,
			2,
		),
	);
});
