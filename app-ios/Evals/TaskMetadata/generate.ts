// Writes fixture.json: a seeded, Stefan-shaped task history and the cases the eval scores.
// `bun app-ios/Evals/TaskMetadata/generate.ts`
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

let seed = 42;
const rand = () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

type Meta = {
	project: string | null;
	section: string | null;
	labels: string[];
	place: string | null;
	time: string | null;
};
type Task = Meta & { title: string; day: number };

const projects: Record<string, string[]> = {
	Home: ['Kitchen', 'Garden', 'Repairs'],
	Work: ['Meetings', 'Admin', 'Hiring'],
	ProcrastiMate: ['iOS', 'Web', 'Bugs'],
	Finance: ['Taxes', 'Bills'],
	Health: ['Fitness', 'Doctors'],
	Groceries: [],
	Social: [],
	'Lisbon move': ['Paperwork', 'Packing'],
};
const labels = ['calls', 'errands', 'waiting', 'email', 'quick', 'deep work', 'computer', 'reading'];
const places = ['Home', 'Office', 'Supermarket', 'Gym', 'Pharmacy', 'Hardware store'];

type Family = {
	titles: string[];
	slots?: Record<string, string[]>;
	meta: Partial<Meta>;
	times?: string[];
	weight: number;
	from?: number;
	to?: number;
};

const people = ['mom', 'dad', 'Ana', 'Radu', 'the landlord', 'Mihai', 'Elena', 'the plumber', 'Tom'];
const colleagues = ['Sarah', 'Dev', 'Priya', 'Marco', 'the recruiter', 'Lena'];
const groceries = [
	'milk',
	'eggs',
	'bread',
	'bananas',
	'coffee beans',
	'rice',
	'chicken',
	'tomatoes',
	'yogurt',
	'cheese',
	'onions',
	'pasta',
	'olive oil',
	'spinach',
	'apples',
];
const features = [
	'quick add',
	'search',
	'sync',
	'labels',
	'reminders',
	'subtasks',
	'ramble',
	'sharing',
	'the inbox',
	'images',
];

const families: Family[] = [
	{
		titles: ['buy {g}', 'get {g}', '{g}', 'pick up {g}', 'out of {g}'],
		slots: { g: groceries },
		meta: { project: 'Groceries', labels: ['errands'], place: 'Supermarket' },
		weight: 14,
	},
	{
		titles: ['buy {g} and {h}'],
		slots: { g: groceries, h: groceries },
		meta: { project: 'Groceries', labels: ['errands'], place: 'Supermarket' },
		weight: 3,
	},
	{
		titles: ['call {p}', 'ring {p}', 'phone {p} back'],
		slots: { p: people },
		meta: { project: 'Social', labels: ['calls'] },
		times: ['18:00', '19:00', '18:30'],
		weight: 7,
	},
	{ titles: ['call mom'], meta: { project: 'Social', labels: ['calls'] }, times: ['18:00'], weight: 4 },
	{
		titles: ['birthday present for {p}', 'dinner with {p}', 'reply to {p} about the weekend'],
		slots: { p: people },
		meta: { project: 'Social' },
		weight: 5,
	},
	{
		titles: ['1:1 with {c}', 'sync with {c}', 'prep 1:1 {c}'],
		slots: { c: colleagues },
		meta: { project: 'Work', section: 'Meetings' },
		times: ['10:00', '11:00', '14:00', '15:30'],
		weight: 8,
	},
	{
		titles: ['standup notes', 'prepare standup', 'weekly planning'],
		meta: { project: 'Work', section: 'Meetings' },
		times: ['09:30'],
		weight: 5,
	},
	{
		titles: ['email {c} about {t}', 'reply to {c}', 'follow up with {c} on {t}'],
		slots: { c: colleagues, t: ['the roadmap', 'Q4 goals', 'the offsite', 'budget', 'the contract', 'the launch'] },
		meta: { project: 'Work', section: 'Admin', labels: ['email'] },
		weight: 8,
	},
	{
		titles: ['submit expenses', 'book travel for the offsite', 'fill in timesheet', 'renew laptop insurance'],
		meta: { project: 'Work', section: 'Admin', labels: ['quick'] },
		weight: 5,
	},
	{
		titles: ['review {r} candidate CV', 'interview {r} candidate', 'write feedback for {r} candidate'],
		slots: { r: ['backend', 'iOS', 'design', 'data'] },
		meta: { project: 'Work', section: 'Hiring' },
		times: ['13:00', '16:00'],
		weight: 5,
	},
	{
		titles: ['write design doc for {t}', 'think through {t} architecture', 'draft {t} proposal'],
		slots: { t: ['billing', 'the API', 'search', 'onboarding', 'permissions'] },
		meta: { project: 'Work', labels: ['deep work', 'computer'] },
		weight: 5,
		from: 150,
	},
	{
		titles: ['write design doc for {t}', 'think through {t} architecture'],
		slots: { t: ['billing', 'the API', 'search'] },
		meta: { project: 'Work', labels: ['computer'] },
		weight: 4,
		to: 150,
	},
	{
		titles: ['fix {f} bug', '{f} crashes on launch', '{f} is slow', 'bug: {f} loses edits'],
		slots: { f: features },
		meta: { project: 'ProcrastiMate', section: 'Bugs', labels: ['computer'] },
		weight: 9,
	},
	{
		titles: ['ios: {f} polish', 'swiftui {f} animation', 'iOS {f} haptics'],
		slots: { f: features },
		meta: { project: 'ProcrastiMate', section: 'iOS', labels: ['computer'] },
		weight: 6,
	},
	{
		titles: ['web: {f} keyboard shortcuts', 'svelte {f} transition', 'web {f} empty state'],
		slots: { f: features },
		meta: { project: 'ProcrastiMate', section: 'Web', labels: ['computer'] },
		weight: 6,
	},
	{
		titles: ['pay {b}', '{b} bill', 'check {b} statement'],
		slots: { b: ['electricity', 'internet', 'water', 'council tax', 'phone', 'credit card'] },
		meta: { project: 'Finance', section: 'Bills', labels: ['quick'] },
		times: ['09:00'],
		weight: 7,
	},
	{
		titles: ['send {d} to accountant', 'find {d}', 'file {d}'],
		slots: { d: ['P60', 'receipts', 'the tax return', 'invoices', 'bank statements'] },
		meta: { project: 'Finance', section: 'Taxes', labels: ['computer'] },
		weight: 5,
	},
	{
		titles: ['gym', 'leg day', 'run 5k', 'swim', 'yoga class', 'push day', 'pull day'],
		meta: { project: 'Health', section: 'Fitness', place: 'Gym' },
		times: ['07:00', '07:30', '18:30'],
		weight: 10,
	},
	{
		titles: ['book {d} appointment', 'dentist checkup', 'get {m} prescription', 'GP appointment'],
		slots: { d: ['dentist', 'GP', 'physio', 'optician'], m: ['allergy', 'asthma'] },
		meta: { project: 'Health', section: 'Doctors', labels: ['calls'] },
		weight: 5,
	},
	{
		titles: ['pick up {m} from pharmacy', 'buy {m}', 'refill {m}'],
		slots: { m: ['ibuprofen', 'vitamin D', 'antihistamines', 'plasters', 'eye drops'] },
		meta: { project: 'Health', labels: ['errands'], place: 'Pharmacy' },
		weight: 4,
	},
	{
		titles: ['clean the {r}', 'deep clean {r}', 'tidy {r}'],
		slots: { r: ['kitchen', 'fridge', 'oven', 'bathroom', 'living room'] },
		meta: { project: 'Home', section: 'Kitchen', place: 'Home' },
		weight: 5,
	},
	{
		titles: ['water the {p}', 'repot {p}', 'mow the lawn', 'trim the hedge'],
		slots: { p: ['plants', 'tomatoes', 'basil', 'monstera'] },
		meta: { project: 'Home', section: 'Garden', place: 'Home' },
		weight: 5,
	},
	{
		titles: ['fix {x}', 'replace {x}', 'get {y} for {x}'],
		slots: {
			x: ['the leaky tap', 'the bathroom light', 'the door hinge', 'the shower head', 'the fence'],
			y: ['screws', 'a bulb', 'sealant', 'a washer'],
		},
		meta: { project: 'Home', section: 'Repairs', labels: ['errands'], place: 'Hardware store' },
		weight: 5,
	},
	{
		titles: ['take out the bins', 'laundry', 'change the bed sheets', 'run the dishwasher'],
		meta: { project: 'Home', place: 'Home', labels: ['quick'] },
		times: ['20:00', '21:00'],
		weight: 6,
	},
	{
		titles: ['read {b}', 'finish {b}', 'notes on {b}'],
		slots: {
			b: [
				'Designing Data-Intensive Applications',
				'the Rust book',
				'Atomic Habits',
				'the SwiftUI article',
				'that HN post',
			],
		},
		meta: { labels: ['reading'] },
		weight: 5,
	},
	{
		titles: ['waiting on {c} for {t}', 'chase {c} about {t}'],
		slots: {
			c: [...colleagues, 'the landlord', 'the bank'],
			t: ['the contract', 'the deposit', 'approval', 'the invoice'],
		},
		meta: { labels: ['waiting'] },
		weight: 4,
	},
	{
		titles: ['apply for {d}', 'translate {d}', 'get {d} certified'],
		slots: { d: ['NIF', 'residency permit', 'birth certificate', 'the lease'] },
		meta: { project: 'Lisbon move', section: 'Paperwork' },
		weight: 6,
		from: 230,
	},
	{
		titles: ['pack the {r}', 'boxes for {r}', 'sell {x}'],
		slots: { r: ['books', 'kitchen', 'winter clothes', 'desk'], x: ['the sofa', 'the bike', 'the bookshelf'] },
		meta: { project: 'Lisbon move', section: 'Packing', place: 'Home' },
		weight: 5,
		from: 250,
	},
	{
		titles: ['idea: {i}', 'look into {i}', 'research {i}'],
		slots: { i: ['a standing desk', 'solar panels', 'a new camera', 'learning Portuguese', 'home NAS', 'an e-bike'] },
		meta: {},
		weight: 6,
	},
];

const DAYS = 300;
const history: Task[] = [];
for (let day = 0; day < DAYS; day++) {
	const count = 1 + Math.floor(rand() * 3);
	for (let n = 0; n < count; n++) {
		const live = families.filter(f => (f.from ?? 0) <= day && day < (f.to ?? Infinity));
		const total = live.reduce((s, f) => s + f.weight, 0);
		let r = rand() * total;
		const f = live.find(f => (r -= f.weight) < 0)!;
		const title = pick(f.titles).replace(/\{(\w)\}/g, (_, k: string) => pick(f.slots![k]!));
		const m = f.meta;
		// People are inconsistent: a tenth of tasks skip their labels, a twentieth stay in the inbox, times vary.
		const dropLabels = rand() < 0.1;
		const inbox = rand() < 0.05;
		history.push({
			title,
			day,
			project: inbox ? null : (m.project ?? null),
			section: inbox ? null : (m.section ?? null),
			labels: dropLabels ? [] : (m.labels ?? []),
			place: m.place ?? null,
			time: f.times && rand() < 0.8 ? pick(f.times) : null,
		});
	}
}

const split = Math.floor(history.length * 0.85);
const novel: Task[] = (
	[
		['grab oat milk', 'Groceries', null, ['errands'], 'Supermarket', null],
		['avocados', 'Groceries', null, ['errands'], 'Supermarket', null],
		['restock dishwasher tablets', 'Groceries', null, ['errands'], 'Supermarket', null],
		['FaceTime grandma', 'Social', null, ['calls'], null, '18:00'],
		['call Ana about the trip', 'Social', null, ['calls'], null, '18:00'],
		['housewarming gift for Elena', 'Social', null, [], null, null],
		['retro with Priya', 'Work', 'Meetings', [], null, '14:00'],
		['quarterly review with Marco', 'Work', 'Meetings', [], null, '11:00'],
		['email legal about the NDA', 'Work', 'Admin', ['email'], null, null],
		['answer Lena re: hiring plan', 'Work', 'Admin', ['email'], null, null],
		['phone screen for the backend role', 'Work', 'Hiring', [], null, '16:00'],
		['scorecard for Tuesday interview', 'Work', 'Hiring', [], null, null],
		['spec out the notifications rewrite', 'Work', null, ['deep work', 'computer'], null, null],
		['dark mode flickers on iPad', 'ProcrastiMate', 'Bugs', ['computer'], null, null],
		['drag and drop reorder broken in safari', 'ProcrastiMate', 'Bugs', ['computer'], null, null],
		['widget for the lock screen', 'ProcrastiMate', 'iOS', ['computer'], null, null],
		['keyboard nav in the sidebar', 'ProcrastiMate', 'Web', ['computer'], null, null],
		['pay the gas bill', 'Finance', 'Bills', ['quick'], null, '09:00'],
		['cancel netflix', 'Finance', 'Bills', ['quick'], null, null],
		['self assessment deadline', 'Finance', 'Taxes', ['computer'], null, null],
		['upload payslips for the accountant', 'Finance', 'Taxes', ['computer'], null, null],
		['morning run', 'Health', 'Fitness', [], 'Gym', '07:00'],
		['spin class', 'Health', 'Fitness', [], 'Gym', '18:30'],
		['blood test results', 'Health', 'Doctors', ['calls'], null, null],
		['sunscreen', 'Health', null, ['errands'], 'Pharmacy', null],
		['descale the kettle', 'Home', 'Kitchen', [], 'Home', null],
		['defrost the freezer', 'Home', 'Kitchen', [], 'Home', null],
		['plant the tulip bulbs', 'Home', 'Garden', [], 'Home', null],
		['patch the hole in the wall', 'Home', 'Repairs', ['errands'], 'Hardware store', null],
		['vacuum', 'Home', null, ['quick'], 'Home', '20:00'],
		['ironing', 'Home', null, ['quick'], 'Home', '20:00'],
		['read the Postgres internals chapter', null, null, ['reading'], null, null],
		['finish Project Hail Mary', null, null, ['reading'], null, null],
		['waiting for the bank to confirm the transfer', null, null, ['waiting'], null, null],
		['chase the movers for a quote', 'Lisbon move', null, ['waiting'], null, null],
		['open a Portuguese bank account', 'Lisbon move', 'Paperwork', [], null, null],
		['register at the junta de freguesia', 'Lisbon move', 'Paperwork', [], null, null],
		['wrap the plates', 'Lisbon move', 'Packing', [], 'Home', null],
		['give away the plants', 'Lisbon move', 'Packing', [], 'Home', null],
		['look into a 3d printer', null, null, [], null, null],
	] as const
).map(([title, project, section, labels, place, time]) => ({
	title,
	project,
	section,
	labels: [...labels],
	place,
	time,
	day: DAYS,
}));

const fixture = {
	projects: Object.entries(projects).map(([name, sections]) => ({ name, sections })),
	labels,
	places,
	history: history.slice(0, split),
	sets: { recent: history.slice(split), novel },
};
writeFileSync(join(import.meta.dir, 'fixture.json'), JSON.stringify(fixture, null, '\t') + '\n');
console.log(`history ${split}, recent ${history.length - split}, novel ${novel.length}`);
