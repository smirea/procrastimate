import { describe, expect, test } from 'bun:test';
import { completeTask, descendantsOf, reopenTask } from '../subtasks.ts';
import type { Task } from '../task.ts';
import { diff } from './diff.ts';
import { fixups } from './fixups.ts';
import { moveOrders } from './order.ts';
import { KINDS, type Snapshot } from './protocol.ts';
import { entitiesOf, withEntities } from './snapshot.ts';
import { label, MemoryClient, MemoryServer, project, snapshotOf, task } from './testing.ts';

/**
 * Two or three clients edit at random, go offline, and sync in random interleavings, some of which lose
 * the server's answer. After everyone syncs, every replica must equal the server and the invariants must
 * hold. `SYNC_SEEDS=<n>` runs more seeds, and a failure prints the seed and the steps that led to it.
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

/** Reverts the entities one command changed, as the store's undo does. */
function undo(current: Snapshot, before: Snapshot, after: Snapshot): Snapshot {
	const touched = new Set(diff(before, after).map(p => `${p.kind}:${p.id}`));
	return KINDS.reduce((s, kind) => {
		const kept = entitiesOf(s, kind).filter(e => !touched.has(`${kind}:${e.id}`));
		const restored = entitiesOf(before, kind).filter(e => touched.has(`${kind}:${e.id}`));
		return withEntities(s, kind, [...kept, ...restored]);
	}, current);
}

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
			name: 'delete project',
			run: s => {
				const p = rand.pick(s.projects);
				if (!p) return s;
				return {
					...s,
					projects: s.projects.filter(x => x.id !== p.id),
					tasks: s.tasks.filter(t => t.projectId !== p.id),
				};
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
				const tasks = [...s.tasks];
				if (!has('todoist:task:1'))
					tasks.push(task(ids(), { projectId: imported.id, sourceKey: 'todoist:task:1', createdAt: now }));
				const root = tasks.find(t => t.sourceKey === 'todoist:task:1')!;
				if (!has('todoist:task:2'))
					tasks.push(
						task(ids(), { parentId: root.id, projectId: root.projectId, sourceKey: 'todoist:task:2', createdAt: now }),
					);
				return { ...s, projects, tasks };
			},
		},
		{
			name: 'time zone',
			run: s => ({ ...s, settings: { timeZone: rand.pick(['Europe/Berlin', 'America/New_York', 'Asia/Tokyo'])! } }),
		},
	];
}

function invariants(s: Snapshot): string[] {
	const problems: string[] = [];
	const byId = new Map(s.tasks.map(t => [t.id, t]));
	const projects = new Set(s.projects.map(p => p.id));
	const labels = new Set(s.labels.map(l => l.id));
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
	let now = 1_000_000;
	let made = 0;

	const fail = (message: string) => {
		throw new Error(`seed ${seed}: ${message}\n${steps.join('\n')}`);
	};
	const pull = (client: MemoryClient, lost = false) => {
		steps.push(`${now} ${client.name} sync${lost ? ' (answer lost)' : ''}`);
		client.pull(server, now, { lost });
		history.set(client, null);
		const problems = invariants(server.snapshot);
		if (problems.length) fail(problems.join(', '));
	};

	for (let step = 0; step < STEPS; step++) {
		now += rand.int(5000);
		const client = rand.pick(clients)!;
		const roll = rand.next();
		if (roll < 0.65) {
			const options = commands(rand, client.name, now + client.skew, () => `${client.name}-${++made}`);
			const command = rand.next() < 0.08 ? null : rand.pick(options)!;
			const last = history.get(client);
			if (!command && last) {
				steps.push(`${now} ${client.name} undo`);
				client.run(s => undo(s, last.before, last.after), now);
				history.set(client, null);
			} else if (command) {
				steps.push(`${now} ${client.name} ${command.name}`);
				const before = client.snapshot;
				client.run(command.run, now);
				history.set(client, { before, after: client.snapshot });
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
	for (const client of clients) {
		if (!Bun.deepEquals(client.snapshot, truth)) {
			expect(client.snapshot, `seed ${seed}: ${client.name} differs from the server\n${steps.join('\n')}`).toEqual(
				truth,
			);
		}
	}
	return { steps: steps.length, tasks: truth.tasks.length };
}

describe('convergence', () => {
	const seeds = Array.from({ length: SEEDS }, (_, i) => i + 1);
	test.each(seeds)('seed %i converges', seed => {
		simulate(seed);
	});

	test('the fuzz exercises real work', () => {
		const sizes = seeds.slice(0, 10).map(seed => simulate(seed).tasks);
		expect(sizes.some(n => n > 3)).toBe(true);
	});
});
