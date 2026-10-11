import type { ExpectedTask, RambleCase } from './ramble-corpus.ts';

/**
 * Composes known titles, attribute phrases, and separators into transcripts whose expected output is
 * known by construction. Seeded, so the cases never change unless this file does.
 */

type Phrase = { text: string; fields: Omit<ExpectedTask, 'title'>; timed?: boolean };

const TITLES = [
	'Buy paint',
	'Call the plumber',
	'Email the accountant',
	'Renew the passport',
	'Book a table',
	'Pay the electric bill',
	'Pick up the dry cleaning',
	'Water the garden',
	'Fix the bike',
	'Send the invoice',
	'Clean the gutters',
	'Order new filters',
	'Schedule a checkup',
	'Return the shoes',
	'Review the contract',
	'Wash the car',
	'Update the website',
	'Plan the menu',
	'Print the tickets',
	'Write the speech',
	'Call grandma',
	'Buy a birthday card',
	'Book the hotel',
	'Clean the oven',
];

const DATES: Phrase[] = [
	{ text: 'tomorrow', fields: { due: '2026-10-15' } },
	{ text: 'on Friday', fields: { due: '2026-10-16' } },
	{ text: 'tomorrow at 5pm', fields: { due: '2026-10-15 17:00' }, timed: true },
	{ text: 'next Monday', fields: { due: '2026-10-19' } },
	{ text: 'in two weeks', fields: { due: '2026-10-28' } },
	{ text: 'at 3pm', fields: { due: '2026-10-14 15:00' }, timed: true },
	{ text: 'on October 20th', fields: { due: '2026-10-20' } },
	{ text: 'tonight', fields: { due: '2026-10-14 20:00' }, timed: true },
	{ text: 'every Monday', fields: { due: '2026-10-19', recurrence: { interval: 1, unit: 'week' } } },
	{ text: 'every day', fields: { due: '2026-10-14', recurrence: { interval: 1, unit: 'day' } } },
	{ text: 'on Saturday at 10am', fields: { due: '2026-10-17 10:00' }, timed: true },
];

const PRIORITIES: Phrase[] = [
	{ text: 'priority one', fields: { priority: 1 } },
	{ text: 'priority 2', fields: { priority: 2 } },
	{ text: 'p3', fields: { priority: 3 } },
	{ text: 'priority four', fields: { priority: 4 } },
];

const PROJECTS: Phrase[] = [
	{ text: 'in project Home', fields: { project: 'Home' } },
	{ text: 'add it to the Work project', fields: { project: 'Work' } },
	{ text: 'for the Finance project', fields: { project: 'Finance' } },
	{ text: 'in project Side Project', fields: { project: 'Side Project' } },
	{ text: 'in the Indonesia project', fields: { project: 'Indonesia' } },
];

const LABELS: Phrase[] = [
	{ text: 'label errands', fields: { labels: ['errands'] } },
	{ text: 'with the calls label', fields: { labels: ['calls'] } },
	{ text: 'labels waiting and deep work', fields: { labels: ['waiting', 'deep work'] } },
];

const REMINDERS: Phrase[] = [
	{ text: 'remind me 30 minutes before', fields: { reminders: [{ kind: 'before', minutes: 30 }] } },
	{ text: 'remind me an hour before', fields: { reminders: [{ kind: 'before', minutes: 60 }] } },
	{ text: 'remind me fifteen minutes before', fields: { reminders: [{ kind: 'before', minutes: 15 }] } },
];

const SEPARATORS = [
	' next task ',
	', next task, ',
	' new task ',
	'. Another task, ',
	', and another thing, ',
	'. Next one, ',
];

/** Fisher–Yates. A sort comparator is not a shuffle: its call order depends on the runtime. */
function shuffle<T>(items: readonly T[], random: () => number): T[] {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		const swap = copy[i]!;
		copy[i] = copy[j]!;
		copy[j] = swap;
	}
	return copy;
}

function mulberry32(seed: number) {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function generateTask(
	random: () => number,
	title: string,
	minAttributes: number,
): { text: string; task: ExpectedTask } {
	const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
	const groups = [DATES, PRIORITIES, PROJECTS, LABELS].filter(() => random() < 0.5);
	while (groups.length < minAttributes) {
		const extra = pick([DATES, PRIORITIES, PROJECTS, LABELS]);
		if (!groups.includes(extra)) groups.push(extra);
	}
	const phrases: Phrase[][] = [];
	for (const group of shuffle(groups, random)) {
		const phrase = pick(group);
		// A relative reminder only means something next to a due time, so it follows one.
		phrases.push(phrase.timed && random() < 0.5 ? [phrase, pick(REMINDERS)] : [phrase]);
	}
	const flat = phrases.flat();
	const task: ExpectedTask = { title };
	for (const phrase of flat) Object.assign(task, phrase.fields);
	return { text: [title, ...flat.map(p => p.text)].join(' '), task };
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export function generateCases(): RambleCase[] {
	const random = mulberry32(20261014);
	const titles = () => shuffle(TITLES, random);
	const cases: RambleCase[] = [];

	for (let i = 1; i <= 40; i++) {
		const { text, task } = generateTask(random, titles()[0]!, 2);
		cases.push({ id: `generated-single-${i}`, category: 'single', transcript: text, expected: [task] });
	}

	for (let i = 1; i <= 40; i++) {
		const count = 2 + Math.floor(random() * 2);
		const chosen = titles().slice(0, count);
		const parts = chosen.map((title, index) => generateTask(random, title, index === 0 ? 1 : 0));
		let transcript = parts[0]!.text;
		for (const part of parts.slice(1)) {
			const separator = SEPARATORS[Math.floor(random() * SEPARATORS.length)]!;
			transcript += separator + lowerFirst(part.text);
		}
		cases.push({
			id: `generated-separators-${i}`,
			category: 'separators',
			transcript,
			expected: parts.map(p => p.task),
		});
	}
	return cases;
}
