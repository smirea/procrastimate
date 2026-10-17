import { describe, expect, test } from 'bun:test';
import * as rules from '../store.ts';
import { completeTask, descendantsOf, reopenTask } from '../subtasks.ts';
import type { Task } from '../task.ts';
import { diff } from './diff.ts';
import { fixups } from './fixups.ts';
import { moveOrders } from './order.ts';
import { KINDS, type Snapshot } from './protocol.ts';
import { entitiesOf, withEntities } from './snapshot.ts';
import { compareHlc } from './hlc.ts';
import { label, MemoryClient, MemoryServer, project, section, snapshotOf, task } from './testing.ts';

/**
 * Two or three clients edit at random, go offline, and sync in random interleavings, some of which lose
 * the server's answer. After everyone syncs, every replica must equal the server and the invariants must
 * hold. Undo comes both as a generic restore of the last command before a sync and as the app's `undelete` of the
 * last delete, which survives syncs. `SYNC_SEEDS=<n>` runs more seeds, and a failure prints the seed and the steps that led to it.
 */

const SEEDS = Number(process.env.SYNC_SEEDS ?? 40);
const STEPS = 150;
const TODAY = '2026-10-10';
const NAMES = ['Work', 'work', 'Home', 'Errands', 'errands'];

function random(seed: number) {
	let state = seed >>> 0;
	const next = () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const int = (n: number) => Math.floor(next() * n);
	const pick = <T>(items: readonly T[]): T | undefined => items[int(items.length)];
	return { next, int, pick };
}

type Random = ReturnType<typeof random>;

type Command = { name: string; run: (s: Snapshot) => Snapshot };

const replace = (tasks: readonly Task[], changed: readonly Task[]) => {
	const byId = new Map(changed.map(t => [t.id, t]));
	return tasks.map(t => byId.get(t.id) ?? t);
};

const nameTaken = (items: readonly { id: string; name: string }[], name: string, except?: string) =>
	items.some(i => i.id !== except && i.name.toLowerCase() === name.toLowerCase());

function undo(current: Snapshot, before: Snapshot, after: Snapshot): Snapshot {
	const touched = new Set(diff(before, after).map(p => `${p.kind}:${p.id}`));
	return KINDS.reduce((s, kind) => {
		const kept = entitiesOf(s, kind).filter(e => !touched.has(`${kind}:${e.id}`));
		const restored = entitiesOf(before, kind).filter(e => touched.has(`${kind}:${e.id}`));
		return withEntities(s, kind, [...kept, ...restored]);
	}, current);
}

const onData = (s: Snapshot, rule: (data: rules.StoreData) => rules.StoreData): Snapshot => ({ ...s, ...rule(s) });

function commands(rand: Random, device: string, now: number, ids: () => string): Command[] {
	const anyTask = (s: Snapshot) => rand.pick(s.tasks);
	return [
		{
			name: 'add task',
			run: s => {
				const parent = rand.next() < 0.5 ? anyTask(s) : undefined;
				const projectId = parent ? parent.projectId : (rand.pick(s.projects)?.id ?? null);
				const added = task(ids(), { parentId: parent?.id ?? null, projectId, createdAt: now, order: rand.int(4) });
				const tasks = [...s.tasks, added];
				return { ...s, tasks: replace(tasks, reopenTask(tasks, added.id)) };
			},
		},
		{
			name: 'edit',
			run: s => {
				const t = anyTask(s);
				return t
					? {
							...s,
							tasks: replace(s.tasks, [
								{ ...t, title: `${device} ${now}`, priority: (1 + rand.int(4)) as Task['priority'] },
							]),
						}
					: s;
			},
		},
		{
			name: 'make recurring',
			run: s => {
				const t = anyTask(s);
				if (!t) return s;
				return {
					...s,
					tasks: replace(s.tasks, [
						{ ...t, recurrence: { interval: 1, unit: 'day' }, due: { date: TODAY, time: null } },
					]),
				};
			},
		},
		{
			name: 'complete',
			run: s => {
				const t = rand.pick(s.tasks.filter(t => t.completedAt === null));
				const done = t && completeTask(s.tasks, t.id, TODAY, now);
				return done ? { ...s, tasks: replace(s.tasks, done.changed) } : s;
			},
		},
		{
			name: 'reopen',
			run: s => {
				const t = rand.pick(s.tasks.filter(t => t.completedAt !== null));
				return t ? { ...s, tasks: replace(s.tasks, reopenTask(s.tasks, t.id)) } : s;
			},
		},
		{
			name: 'move to project',
			run: s => {
				const root = rand.pick(s.tasks.filter(t => t.parentId === null));
				if (!root) return s;
				const projectId = rand.pick([null, ...s.projects.map(p => p.id)]) ?? null;
				const moved = [root, ...descendantsOf(s.tasks, root.id)].map(t => ({ ...t, projectId }));
				return { ...s, tasks: replace(s.tasks, moved) };
			},
		},
		{
			name: 'reorder',
			run: s => {
				const t = rand.pick(s.tasks.filter(t => t.parentId !== null));
				if (!t) return s;
				const siblings = s.tasks.filter(x => x.parentId === t.parentId);
				const orders = new Map(moveOrders(siblings, t.id, rand.int(siblings.length + 1)).map(o => [o.id, o.order]));
				return { ...s, tasks: s.tasks.map(x => (orders.has(x.id) ? { ...x, order: orders.get(x.id)! } : x)) };
			},
		},
		{
			name: 'delete task',
			run: s => {
				const t = anyTask(s);
				if (!t) return s;
				const gone = new Set([t.id, ...descendantsOf(s.tasks, t.id).map(d => d.id)]);
				return { ...s, tasks: s.tasks.filter(x => !gone.has(x.id)) };
			},
		},
		{
			name: 'add label',
			run: s => {
				const name = rand.pick(NAMES)!;
				return nameTaken(s.labels, name) ? s : { ...s, labels: [...s.labels, label(ids(), { name, createdAt: now })] };
			},
		},
		{
			name: 'rename label',
			run: s => {
				const l = rand.pick(s.labels);
				const name = rand.pick(NAMES)!;
				if (!l || nameTaken(s.labels, name, l.id)) return s;
				return { ...s, labels: s.labels.map(x => (x.id === l.id ? { ...x, name } : x)) };
			},
		},
		{
			name: 'label task',
			run: s => {
				const t = anyTask(s);
				const l = rand.pick(s.labels);
				if (!t || !l) return s;
				const labelIds = t.labelIds.includes(l.id) ? t.labelIds.filter(id => id !== l.id) : [...t.labelIds, l.id];
				return { ...s, tasks: replace(s.tasks, [{ ...t, labelIds }]) };
			},
		},
		{
			name: 'delete label',
			run: s => {
				const l = rand.pick(s.labels);
				if (!l) return s;
				const tasks = s.tasks.map(t =>
					t.labelIds.includes(l.id) ? { ...t, labelIds: t.labelIds.filter(id => id !== l.id) } : t,
				);
				return { ...s, labels: s.labels.filter(x => x.id !== l.id), tasks };
			},
		},
		{
			name: 'add project',
			run: s => {
				const name = rand.pick(NAMES)!;
				return nameTaken(s.projects, name)
					? s
					: { ...s, projects: [...s.projects, project(ids(), { name, createdAt: now })] };
			},
		},
		{
			name: 'rename project',
			run: s => {
				const p = rand.pick(s.projects);
				const name = rand.pick(NAMES)!;
				if (!p || nameTaken(s.projects, name, p.id)) return s;
				return { ...s, projects: s.projects.map(x => (x.id === p.id ? { ...x, name } : x)) };
			},
		},
		{
			name: 'move project',
			run: s => {
				const p = rand.pick(s.projects);
				return p ? onData(s, data => rules.moveProject(data, p.id, rand.int(4))) : s;
			},
		},
		{
			name: 'delete project',
			run: s => {
				const p = rand.pick(s.projects);
				if (!p) return s;
				return onData(s, data => rules.deleteProject(data, p.id));
			},
		},
		{
			name: 'add section',
			run: s => {
				const p = rand.pick(s.projects);
				return p ? onData(s, data => rules.addSection(data, p.id, rand.pick(NAMES)!, { id: ids(), now }).data) : s;
			},
		},
		{
			name: 'rename section',
			run: s => {
				const section = rand.pick(s.sections);
				return section ? onData(s, data => rules.renameSection(data, section.id, rand.pick(NAMES)!)) : s;
			},
		},
		{
			name: 'move section',
			run: s => {
				const section = rand.pick(s.sections);
				return section ? onData(s, data => rules.moveSection(data, section.id, rand.int(4))) : s;
			},
		},
		{
			name: 'move to section',
			run: s => {
				const t = anyTask(s);
				const section = rand.pick([null, ...s.sections]);
				if (!t || section === undefined) return s;
				return onData(s, data => rules.updateTask(data, t.id, { sectionId: section?.id ?? null }));
			},
		},
		{
			name: 'delete section',
			run: s => {
				const section = rand.pick(s.sections);
				return section ? onData(s, data => rules.deleteSection(data, section.id)) : s;
			},
		},
		{
			name: 'import',
			run: s => {
				const has = (key: string) => s.tasks.some(t => t.sourceKey === key);
				let imported = s.projects.find(p => p.sourceKey === 'todoist:project:1');
				const projects = imported
					? s.projects
					: [
							...s.projects,
							(imported = project(ids(), { name: 'Imported', sourceKey: 'todoist:project:1', createdAt: now })),
						];
				let sections = s.sections;
				let later = sections.find(x => x.sourceKey === 'todoist:section:1');
				if (!later && !sections.some(x => x.projectId === imported!.id && x.name.toLowerCase() === 'later')) {
					later = {
						id: ids(),
						projectId: imported.id,
						name: 'Later',
						order: 0,
						createdAt: now,
						sourceKey: 'todoist:section:1',
					};
					sections = [...sections, later];
				}
				const sectionId = later?.projectId === imported.id ? later.id : null;
				const tasks = [...s.tasks];
				if (!has('todoist:task:1'))
					tasks.push(task(ids(), { projectId: imported.id, sectionId, sourceKey: 'todoist:task:1', createdAt: now }));
				const root = tasks.find(t => t.sourceKey === 'todoist:task:1')!;
				if (!has('todoist:task:2'))
					tasks.push(
						task(ids(), { parentId: root.id, projectId: root.projectId, sourceKey: 'todoist:task:2', createdAt: now }),
					);
				return { ...s, projects, sections, tasks };
			},
		},
		{
			name: 'time zone',
			run: s => ({
				...s,
				settings: { ...s.settings, timeZone: rand.pick(['Europe/Berlin', 'America/New_York', 'Asia/Tokyo'])! },
			}),
		},
	];
}

function invariants(s: Snapshot): string[] {
	const problems: string[] = [];
	const byId = new Map(s.tasks.map(t => [t.id, t]));
	const projects = new Set(s.projects.map(p => p.id));
	const labels = new Set(s.labels.map(l => l.id));
	const sections = new Map(s.sections.map(x => [x.id, x]));
	const unique = (what: string, keys: (string | undefined)[]) => {
		const present = keys.filter(k => k !== undefined);
		if (new Set(present).size !== present.length) problems.push(`duplicate ${what}`);
	};
	for (const t of s.tasks) {
		const seen = new Set([t.id]);
		let root = t;
		for (let id = t.parentId; id !== null; id = byId.get(id)!.parentId) {
			if (!byId.has(id) || seen.has(id)) {
				problems.push(`orphan ${t.id}`);
				break;
			}
			seen.add(id);
			root = byId.get(id)!;
			if (t.completedAt === null && root.completedAt !== null) problems.push(`open ${t.id} under completed ${id}`);
		}
		if (t.projectId !== root.projectId) problems.push(`${t.id} not in its root's project`);
		if (t.projectId !== null && !projects.has(t.projectId)) problems.push(`${t.id} in missing project`);
		if (t.labelIds.some(id => !labels.has(id))) problems.push(`${t.id} has a missing label`);
		if (t.sectionId !== null && t.parentId !== null) problems.push(`subtask ${t.id} in a section`);
		if (t.sectionId !== null && sections.get(t.sectionId)?.projectId !== t.projectId)
			problems.push(`${t.id} in a section outside its project`);
		unique(`labels on ${t.id}`, t.labelIds);
	}
	unique(
		'label names',
		s.labels.map(l => l.name.toLowerCase()),
	);
	unique(
		'project names',
		s.projects.map(p => p.name.toLowerCase()),
	);
	for (const x of s.sections) if (!projects.has(x.projectId)) problems.push(`section ${x.id} in missing project`);
	unique(
		'section names',
		s.sections.map(x => `${x.projectId} ${x.name.toLowerCase()}`),
	);
	unique(
		'section source keys',
		s.sections.map(x => x.sourceKey),
	);
	unique(
		'task source keys',
		s.tasks.map(t => t.sourceKey),
	);
	unique(
		'project source keys',
		s.projects.map(p => p.sourceKey),
	);
	return problems;
}

function simulate(seed: number) {
	const rand = random(seed);
	const steps: string[] = [];
	const server = new MemoryServer();
	const count = 2 + rand.int(2);
	const skews = [0, -3000, 10 * 60_000];
	const seededData = snapshotOf({
		projects: [project('home', { name: 'Home' })],
		tasks: [task('seed', { projectId: 'home' })],
	});
	const clients = Array.from(
		{ length: count },
		(_, i) => new MemoryClient(`c${i}`, i === 0 ? seededData : undefined, skews[i]),
	);
	const offline = new Set<MemoryClient>();
	const history = new Map<MemoryClient, { before: Snapshot; after: Snapshot } | null>();
	// The app's undo toast after a delete still works after a sync, unlike `undo`, so each client keeps its last delete.
	const deletions = new Map<MemoryClient, rules.Deleted>();
	let now = 1_000_000;
	let made = 0;

	const fail = (message: string) => {
		throw new Error(`seed ${seed}: ${message}\n${steps.join('\n')}`);
	};
	const expectConverged = (client: MemoryClient) => {
		const truth = server.snapshot;
		if (!Bun.deepEquals(client.snapshot, truth)) {
			expect(client.snapshot, `seed ${seed}: ${client.name} differs from the server\n${steps.join('\n')}`).toEqual(
				truth,
			);
		}
	};
	const pull = (client: MemoryClient, lost = false) => {
		steps.push(`${now} ${client.name} sync${lost ? ' (answer lost)' : ''}`);
		client.pull(server, now, { lost });
		history.set(client, null);
		const problems = invariants(server.snapshot);
		if (problems.length) fail(problems.join(', '));
		if (!lost) expectConverged(client);
	};

	for (let step = 0; step < STEPS; step++) {
		now += rand.int(5000);
		const client = rand.pick(clients)!;
		const roll = rand.next();
		if (roll < 0.65) {
			const options = commands(rand, client.name, now + client.skew, () => `${client.name}-${++made}`);
			const undoing = rand.next();
			const command = undoing < 0.12 ? null : rand.pick(options)!;
			const last = history.get(client);
			const deleted = deletions.get(client);
			if (!command && undoing < 0.08 && last) {
				steps.push(`${now} ${client.name} undo`);
				client.run(s => undo(s, last.before, last.after), now);
				history.set(client, null);
			} else if (!command && undoing >= 0.08 && deleted) {
				steps.push(`${now} ${client.name} undo delete`);
				client.run(s => onData(s, data => rules.undelete(data, deleted)), now);
				deletions.delete(client);
				history.set(client, null);
			} else if (command) {
				steps.push(`${now} ${client.name} ${command.name}`);
				const before = client.snapshot;
				client.run(command.run, now);
				history.set(client, { before, after: client.snapshot });
				const gone = rules.deletedBetween(before, client.snapshot);
				if (gone.projects.length || gone.sections.length || gone.labels.length || gone.tasks.length)
					deletions.set(client, gone);
			}
		} else if (roll < 0.92) {
			if (!offline.has(client)) pull(client, rand.next() < 0.1);
		} else if (offline.has(client)) {
			offline.delete(client);
		} else {
			offline.add(client);
		}
	}

	for (let round = 0; clients.some(c => c.sync.outbox.length) || round < 2; round++) {
		if (round > 5) fail('outboxes never drained');
		for (const client of clients) pull(client);
	}
	const truth = server.snapshot;
	if (!Bun.deepEquals(fixups(truth), truth)) fail('fixups changed a fixed state');
	for (const client of clients) expectConverged(client);
	return {
		steps: steps.length,
		tasks: truth.tasks.length,
		sectioned: truth.tasks.filter(t => t.sectionId !== null).length,
	};
}

describe('convergence', () => {
	test('a delete that loses to an undo of delete on another device comes back', () => {
		const server = new MemoryServer();
		const work = snapshotOf({ projects: [project('p')], tasks: [task('t', { projectId: 'p' })] });
		const a = new MemoryClient('a', work);
		const b = new MemoryClient('b');
		const c = new MemoryClient('c');
		a.pull(server, 10);
		b.pull(server, 20);
		c.pull(server, 20);
		b.run(s => onData(s, data => rules.deleteProject(data, 'p')), 30);
		a.run(s => onData(s, data => rules.deleteProject(data, 'p')), 40);
		a.run(() => work, 50);
		c.run(s => onData(s, data => rules.renameProject(data, 'p', 'Renamed')), 60);
		c.pull(server, 70);
		a.pull(server, 80);
		b.pull(server, 90);
		expect(server.snapshot.projects.map(p => p.name)).toEqual(['Renamed']);
		expect(b.snapshot).toEqual(server.snapshot);
	});

	const seeds = Array.from({ length: SEEDS }, (_, i) => i + 1);
	test.each(seeds)('seed %i converges', seed => {
		simulate(seed);
	});

	test('the fuzz exercises real work', () => {
		const runs = seeds.slice(0, 10).map(seed => simulate(seed));
		expect(runs.some(run => run.tasks > 3)).toBe(true);
		expect(runs.some(run => run.sectioned > 0)).toBe(true);
	});
});

/**
 * Seeds reach a race only by luck: a delete losing to another device's undo of delete, with a third device's newer edit
 * in between, showed up in 1 of 1,000 seeds. So three devices also run every interleaving of short scripts, each
 * device's steps in its own order, on a project with a section, a saved place, and a labeled task.
 */
describe('every interleaving', () => {
	type Device = { client: MemoryClient; deleted: rules.Deleted | null };
	type World = { server: MemoryServer; devices: Device[] };
	type Step = { name: string; run: (device: Device, server: MemoryServer, now: number) => void };

	const place = { address: null, latitude: 52.52, longitude: 13.405, radius: 100 };
	const work = snapshotOf({
		projects: [project('p', { name: 'Work' })],
		sections: [section('s', 'p', { name: 'Later' })],
		labels: [label('home', { name: 'Home', place }), label('l', { name: 'Urgent' })],
		tasks: [
			task('t', {
				projectId: 'p',
				sectionId: 's',
				labelIds: ['home'],
				location: { name: 'Home', ...place, trigger: 'arrive' },
			}),
		],
	});

	const command = (name: string, edit: (data: rules.StoreData, device: string) => rules.StoreData): Step => ({
		name,
		run: (device, _, now) => device.client.run(s => onData(s, data => edit(data, device.client.name)), now),
	});
	// Like the toast, the undo puts back what the delete removed from the device as it was then.
	const remove = (name: string, edit: (data: rules.StoreData) => rules.StoreData): Step => ({
		name,
		run: (device, _, now) => {
			const before = device.client.snapshot;
			device.client.run(s => onData(s, edit), now);
			device.deleted = rules.deletedBetween(before, device.client.snapshot);
		},
	});
	const restore: Step = {
		name: 'undo delete',
		run: (device, _, now) => device.client.run(s => onData(s, data => rules.undelete(data, device.deleted!)), now),
	};
	const sync: Step = { name: 'sync', run: (device, server, now) => device.client.pull(server, now) };

	const deletes = [
		remove('delete project', data => rules.deleteProject(data, 'p')),
		remove('delete section', data => rules.deleteSection(data, 's')),
		remove('delete place', data => rules.deleteLabel(data, 'home')),
	];
	const edits = [
		command('rename project', (data, name) => rules.renameProject(data, 'p', name)),
		command('rename section', (data, name) => rules.renameSection(data, 's', name)),
		command('rename place', (data, name) => rules.renameLabel(data, 'home', name)),
		command('edit task', (data, name) => rules.updateTask(data, 't', { title: name })),
		command('label task', data => {
			const labelIds = data.tasks.find(t => t.id === 't')?.labelIds ?? [];
			return rules.updateTask(data, 't', { labelIds: [...labelIds, 'l'] });
		}),
		command('unlabel task', data => rules.updateTask(data, 't', { labelIds: [] })),
		command('move out of section', data => rules.updateTask(data, 't', { sectionId: null })),
	];
	const scripts: Record<string, Step[]> = Object.fromEntries([
		...deletes.flatMap(step => [
			[step.name, [step, sync]],
			[`${step.name}, undo`, [step, restore, sync]],
			[`${step.name}, sync, undo`, [step, sync, restore, sync]],
		]),
		...edits.map(step => [step.name, [step, sync]]),
	]);

	/**
	 * Every step runs at a later time than all before it, so each new clock is newer than every stored one, and what a
	 * world does next depends only on the order of its stored clocks. Two interleavings that reach the same world up to
	 * that order, such as one device's edit before or after another's sync, share every continuation, so only the
	 * first is explored. Device and server clocks and op counters are left out, since every tick jumps past them, and so
	 * are the log rows every device has read, since nothing reads them again.
	 */
	function key({ server, devices }: World, done: readonly number[]) {
		const entities = [...server.state.entities.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
		const clocks = [
			...new Set([
				...entities.flatMap(([, e]) => Object.values(e.clocks)),
				...devices.flatMap(d => d.client.sync.outbox.map(op => op.hlc)),
			]),
		].sort(compareHlc);
		const rank = new Map(clocks.map((hlc, i) => [hlc, i]));
		const read = Math.min(...devices.map(d => d.client.sync.cursor));
		return JSON.stringify([
			done,
			server.log.slice(read).map(c => [c.opId, c.kind, c.id, c.fields]),
			entities.map(([id, e]) => [id, e.data, Object.entries(e.clocks).map(([field, hlc]) => [field, rank.get(hlc)])]),
			devices.map(({ client: { snapshot, sync }, deleted }) => [
				snapshot,
				deleted,
				sync.cursor - read,
				sync.seed,
				sync.outbox.map(op => ({ ...op, hlc: rank.get(op.hlc) })),
			]),
		]);
	}

	/** Runs every interleaving of the cast's scripts and returns the server snapshots they end in. */
	function explore(cast: readonly string[], { prune = true } = {}) {
		const plans = cast.map(name => scripts[name]!);
		const server = new MemoryServer();
		const devices = cast.map((_, i) => ({
			client: new MemoryClient(`d${i}`, i === 0 ? work : undefined),
			deleted: null,
		}));
		for (const [i, { client }] of devices.entries()) client.pull(server, i + 1);
		const seen = new Set<string>();
		const ends = new Set<string>();
		const visit = (world: World, done: readonly number[], steps: readonly string[]) => {
			if (prune) {
				const at = key(world, done);
				if (seen.has(at)) return;
				seen.add(at);
			}
			if (done.every((n, i) => n === plans[i]!.length)) {
				const { server, devices } = clone(world);
				for (const { client } of [...devices, ...devices]) client.pull(server, 1000);
				for (const { client } of devices) converged(client, server, steps);
				expect(invariants(server.snapshot), steps.join('\n')).toEqual([]);
				ends.add(JSON.stringify(server.snapshot));
				return;
			}
			for (const [i, plan] of plans.entries()) {
				const step = plan[done[i]!];
				if (!step) continue;
				const next = clone(world);
				const device = next.devices[i]!;
				step.run(device, next.server, 10 * (steps.length + 1));
				const trace = [...steps, `${device.client.name} ${step.name}`];
				if (step === sync) converged(device.client, next.server, trace);
				visit(next, done.with(i, done[i]! + 1), trace);
			}
		};
		visit(
			{ server, devices },
			plans.map(() => 0),
			[],
		);
		return [...ends].sort();
	}

	const clone = ({ server, devices }: World): World => ({
		server: server.clone(),
		devices: devices.map(d => ({ ...d, client: d.client.clone() })),
	});
	const converged = (client: MemoryClient, server: MemoryServer, steps: readonly string[]) => {
		if (!Bun.deepEquals(client.snapshot, server.snapshot))
			expect(client.snapshot, `${client.name} differs after\n${steps.join('\n')}`).toEqual(server.snapshot);
	};

	const names = Object.keys(scripts);
	const casts = names.flatMap((a, i) => names.slice(i).flatMap((b, j) => names.slice(i + j).map(c => [a, b, c])));
	// One device deletes and undoes, another deletes the same entity, and the third does anything else.
	const raced = (cast: readonly string[]) => {
		const undone = cast.filter(name => scripts[name]!.includes(restore));
		return undone.length === 1 && cast.some(name => undone[0]!.startsWith(`${name},`));
	};
	test.each(process.env.SYNC_INTERLEAVINGS === 'all' ? casts : casts.filter(raced))('%s / %s / %s', (...cast) => {
		explore(cast);
	});

	test('skipping a world already explored reaches the same ends', () => {
		const cast = ['delete project, sync, undo', 'delete section', 'rename place'];
		const ends = explore(cast);
		expect(ends.length).toBeGreaterThan(1);
		expect(explore(cast, { prune: false })).toEqual(ends);
	});
});
