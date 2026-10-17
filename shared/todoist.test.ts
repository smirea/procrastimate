import { expect } from 'bun:test';
import * as todoist from './todoist.ts';
import type { ImportState, TodoistBackup } from './todoist.ts';
import { todoistBackupFiles } from './fixtures/todoist-backup.mts';
import { toDateKey, toTimeOfDay } from './task.ts';
import { describe, recorded, test } from './vectors/record.ts';

const mergeBackup = recorded('todoist', todoist.mergeBackup);
const readTodoistBackup = recorded('todoist', todoist.readTodoistBackup);
const readTodoistDate = recorded('todoist', todoist.readTodoistDate);

// Wednesday, October 14 2026, 10:00 local time.
const now = new Date(2026, 9, 14, 10, 0);
const HEADER = 'TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,DATE,DATE_LANG';

/** Every merge takes ids from a fresh counter, which the Swift vector tests replay, since a vector cannot hold a function. */
const counter = () => {
	let n = 0;
	return () => `id-${++n}`;
};
const empty = (): ImportState => ({ tasks: [], projects: [], sections: [], labels: [], comments: [], reads: [] });
const read = (text: string, name = 'Errands [42].csv') => readTodoistBackup([{ name, text }], now);
/** Read inside the first test that needs it, so its vector is recorded once and named after that test. */
let fixture: TodoistBackup | undefined;
const readFixture = () => (fixture ??= readTodoistBackup(todoistBackupFiles, now));

describe('Todoist dates', () => {
	test.each([
		['every March 2nd 11 am', '2027-03-02', '11:00', { interval: 1, unit: 'year' }],
		['every May 13 11 am', '2027-05-13', '11:00', { interval: 1, unit: 'year' }],
		['Jun 21 2027', '2027-06-21', null, null],
		['Dec 4', '2026-12-04', null, null],
		['May 23, 2027', '2027-05-23', null, null],
		['Oct 22', '2026-10-22', null, null],
		['Oct 13', '2027-10-13', null, null],
		['every day', '2026-10-14', null, { interval: 1, unit: 'day' }],
		['every mon 9am', '2026-10-19', '09:00', { interval: 1, unit: 'week' }],
		['every 3rd friday', '2026-10-16', null, { interval: 1, unit: 'month', nth: { week: 3, weekday: 5 } }],
		['2027-01-05', '2027-01-05', null, null],
		['2027-05-20T09:00:00', '2027-05-20', '09:00', null],
	])('%s', (text, date, time, recurrence) => {
		expect<unknown>(readTodoistDate(text, now)).toEqual({ due: { date, time }, recurrence });
	});

	test.each([['every! 3 days'], ['every 5th friday'], ['after work'], ['p1'], ['2027-01-01T09:00:00+24:00']])(
		'%s is not read',
		text => {
			expect(readTodoistDate(text, now)).toBeNull();
		},
	);

	test('an ISO date with an offset lands on the local date and time', () => {
		const text = '2027-05-20T23:30:00+02:00';
		const at = new Date(text);
		expect(readTodoistDate(text, now)).toEqual({
			due: { date: toDateKey(at), time: toTimeOfDay(at.getHours(), at.getMinutes()) },
			recurrence: null,
		});
	});
});

describe('reading a backup', () => {
	test('one project per CSV, named from the file, with Inbox marked', () => {
		const backup = readFixture();
		expect(backup.projects).toEqual([
			{ sourceKey: 'todoist:project:6Xmpl1Fq', name: 'Inbox', inbox: true },
			{ sourceKey: 'todoist:project:8Xmpl2Wq', name: 'Long Term', inbox: false },
			{ sourceKey: 'todoist:project:9Xmpl3Zr', name: 'Job', inbox: false },
		]);
	});

	test('tasks keep their order, content, priority, dates, and reminders', () => {
		const backup = readFixture();
		expect(backup.tasks.slice(0, 3)).toEqual([
			{
				sourceKey: 'todoist:task:6Xmpl1Fq:Call the dentist',
				parentKey: null,
				projectKey: 'todoist:project:6Xmpl1Fq',
				sectionKey: null,
				title: 'Call the dentist',
				notes: '',
				labels: [],
				due: { date: '2026-10-22', time: null },
				recurrence: null,
				priority: 1,
				reminders: [{ kind: 'before', minutes: 30 }],
			},
			{
				sourceKey: 'todoist:task:6Xmpl1Fq:cancel [meetup.com](https://meetup.com)',
				parentKey: null,
				projectKey: 'todoist:project:6Xmpl1Fq',
				sectionKey: null,
				title: 'cancel [meetup.com](https://meetup.com)',
				notes: '',
				labels: [],
				due: { date: '2026-12-04', time: null },
				recurrence: null,
				priority: 4,
				reminders: [],
			},
			{
				sourceKey: 'todoist:task:6Xmpl1Fq:Renew passport #Travel',
				parentKey: null,
				projectKey: 'todoist:project:6Xmpl1Fq',
				sectionKey: null,
				title: 'Renew passport #Travel',
				notes: '',
				labels: [],
				due: { date: '2027-03-02', time: '11:00' },
				recurrence: { interval: 1, unit: 'year' },
				priority: 2,
				reminders: [],
			},
		]);
	});

	test('labels leave the title, and comments join the description in notes', () => {
		const backup = readFixture();
		const water = backup.tasks[3]!;
		expect(water.title).toBe('Water plants');
		expect(water.labels).toEqual(['home']);
		expect(water.notes).toBe('Ferns first, then "the big one"\nUse the blue can\n\nBought a new can, see receipt');
		expect(backup.tasks.find(t => t.projectKey === 'todoist:project:9Xmpl3Zr')!.labels).toEqual(['work', 'deep-work']);
	});

	test('an unreadable date keeps the task, moves the text to notes, and warns', () => {
		const backup = readFixture();
		const bike = backup.tasks.find(t => t.title === 'Fix bike')!;
		expect(bike.due).toBeNull();
		expect(bike.notes).toBe('Todoist date: every! 3 days');
		const sam = backup.tasks.find(t => t.title === 'Email Sam')!;
		expect(sam.notes).toBe('Todoist date: jeden Montag');
	});

	test('duration, deadline, and absolute reminders', () => {
		const backup = readFixture();
		const japan = backup.tasks.find(t => t.title === 'Visit Japan')!;
		expect(japan.notes).toBe('Duration: 90 minutes\n\nDeadline: 2027-06-01');
		const flights = backup.tasks.find(t => t.title === 'Book flights')!;
		expect(flights.reminders).toEqual([{ kind: 'at', date: '2027-05-20', time: '09:00' }]);
		expect(flights.priority).toBe(3);
	});

	test('nested tasks key by their parents, and repeated content keys by occurrence', () => {
		const backup = readFixture();
		expect(backup.tasks.filter(t => t.projectKey === 'todoist:project:8Xmpl2Wq').map(t => t.sourceKey)).toEqual([
			'todoist:task:8Xmpl2Wq:Visit Japan',
			'todoist:task:8Xmpl2Wq:Visit Japan › Book flights',
			'todoist:task:8Xmpl2Wq:Visit Japan › Book flights › Pack bags',
			'todoist:task:8Xmpl2Wq:Read Dune',
			'todoist:task:8Xmpl2Wq:Read Dune#2',
		]);
	});

	test('a nested task points at the task one indent up', () => {
		const backup = readFixture();
		const parents = backup.tasks.filter(t => t.projectKey === 'todoist:project:8Xmpl2Wq').map(t => t.parentKey);
		expect(parents).toEqual([
			null,
			'todoist:task:8Xmpl2Wq:Visit Japan',
			'todoist:task:8Xmpl2Wq:Visit Japan › Book flights',
			null,
			null,
		]);
	});

	test('a section row puts the top-level tasks under it in that section, and their subtasks in none', () => {
		const backup = readFixture();
		expect(backup.sections).toEqual([
			{ sourceKey: 'todoist:section:8Xmpl2Wq:Someday', projectKey: 'todoist:project:8Xmpl2Wq', name: 'Someday' },
			{ sourceKey: 'todoist:section:8Xmpl2Wq:Reading', projectKey: 'todoist:project:8Xmpl2Wq', name: 'Reading' },
		]);
		const longTerm = backup.tasks.filter(t => t.projectKey === 'todoist:project:8Xmpl2Wq');
		expect(longTerm.map(t => [t.title, t.sectionKey])).toEqual([
			['Visit Japan', 'todoist:section:8Xmpl2Wq:Someday'],
			['Book flights', null],
			['Pack bags', null],
			['Read Dune', 'todoist:section:8Xmpl2Wq:Reading'],
			['Read Dune', 'todoist:section:8Xmpl2Wq:Reading'],
		]);
	});

	test('warns about what it could not carry over, and ignores macOS metadata', () => {
		const backup = readFixture();
		expect(backup.warnings).toEqual([
			'Inbox: could not read the date "every! 3 days" on "Fix bike", kept it in notes',
			'Job: could not read the date "jeden Montag" on "Email Sam", kept it in notes',
		]);
	});
});

describe('CSV edge cases', () => {
	test('priority follows the app scale, and a blank or unknown priority is p4', () => {
		const backup = read(
			`${HEADER}\ntask,Urgent,,1,1,,\ntask,High,,2,1,,\ntask,Normal,,4,1,,\ntask,Blank,,,1,,\ntask,Odd,,7,1,,\n`,
		);
		expect(backup.tasks.map(t => [t.title, t.priority])).toEqual([
			['Urgent', 1],
			['High', 2],
			['Normal', 4],
			['Blank', 4],
			['Odd', 4],
		]);
	});

	test('a quoted title keeps its commas and line breaks', () => {
		const backup = read(`\uFEFF${HEADER}\r\ntask,"Buy eggs, milk\r\nand bread","Say ""hi""",4,1,,\r\n`);
		expect(backup.tasks.map(t => [t.title, t.notes])).toEqual([['Buy eggs, milk\nand bread', 'Say "hi"']]);
	});

	test('an indent back to 1 ends the nesting', () => {
		const backup = read(`${HEADER}\ntask,A,,4,1,,\ntask,B,,4,2,,\ntask,C,,4,1,,\ntask,D,,4,2,,\n`);
		expect(backup.tasks.map(t => t.sourceKey)).toEqual([
			'todoist:task:42:A',
			'todoist:task:42:A › B',
			'todoist:task:42:C',
			'todoist:task:42:C › D',
		]);
	});

	test('a reminder Todoist wrote that we cannot read is kept in notes with a warning', () => {
		const text = `TYPE,CONTENT,REMINDER_TYPE,REMINDER_OFFSET,REMINDER_DATE\ntask,Gym,,,\nreminder,,location,,\n`;
		const backup = read(text);
		expect(backup.tasks[0]!.notes).toBe('Todoist reminder: location');
		expect(backup.warnings).toEqual(['Errands: could not read a reminder on "Gym", kept it in notes']);
	});

	test('an email address is not a label', () => {
		expect(read(`${HEADER}\ntask,Write to bob@site.com,,4,1,,\n`).tasks[0]).toMatchObject({
			title: 'Write to bob@site.com',
			labels: [],
		});
	});

	test('Inbox has no sections, so its section rows are left out with a warning and its tasks stay in Inbox', () => {
		const backup = read(`${HEADER}\ntask,A,,4,1,,\nsection,Later,,,,,\ntask,B,,4,1,,\n`, 'Inbox [1].csv');
		expect([backup.sections, backup.tasks.map(t => t.sectionKey)]).toEqual([[], [null, null]]);
		expect(backup.warnings).toEqual(['Inbox: Inbox has no sections, so these were left out: Later']);
	});

	test('a section name that repeats in one project lands in one section, also on a second import', () => {
		const backup = read(`${HEADER}\nsection,Later,,,,,\ntask,A,,4,1,,\nsection,later,,,,,\ntask,B,,4,1,,\n`);
		expect(backup.tasks.map(t => t.sectionKey)).toEqual(['todoist:section:42:Later', 'todoist:section:42:later']);
		const first = mergeBackup(empty(), backup, { newId: counter(), now: 1000 });
		const second = mergeBackup(first.state, backup, { newId: counter(), now: 2000 });
		expect(second.state.sections.map(s => [s.name, s.sourceKey])).toEqual([['Later', 'todoist:section:42:Later']]);
		expect(new Set(second.state.tasks.map(t => t.sectionId)).size).toBe(1);
	});

	test('a section row ends the nesting above it, in Inbox too', () => {
		const backup = read(`${HEADER}\ntask,A,,4,1,,\nsection,Later,,,,,\ntask,B,,4,2,,\n`, 'Inbox [1].csv');
		expect(backup.tasks.map(t => t.parentKey)).toEqual([null, null]);
	});

	test('a file without a Todoist header is skipped with a warning', () => {
		const backup = read('name,amount\nrent,100\n', 'budget.csv');
		expect(backup.projects).toEqual([]);
		expect(backup.warnings).toEqual(['budget.csv is not a Todoist project file, skipped']);
	});
});

describe('merging into the store', () => {
	test('adds projects, labels, and tasks, with Inbox tasks in our Inbox', () => {
		const backup = readFixture();
		const { state, summary } = mergeBackup(empty(), backup, { newId: counter(), now: 1000 });
		expect(summary).toEqual({
			projects: 2,
			sections: 2,
			labels: 3,
			tasks: 12,
			skipped: 0,
			warnings: backup.warnings,
		});
		expect(state.projects.map(p => p.name)).toEqual(['Long Term', 'Job']);
		expect(state.labels.map(l => l.name)).toEqual(['home', 'work', 'deep-work']);
		const dentist = state.tasks.find(t => t.title === 'Call the dentist')!;
		expect(dentist.projectId).toBeNull();
		const review = state.tasks.find(t => t.title === 'Quarterly review')!;
		expect(review.projectId).toBe(state.projects[1]!.id);
		expect(review.labelIds).toEqual([state.labels[1]!.id, state.labels[2]!.id]);
		expect(review.completedAt).toBeNull();
	});

	test('importing the same backup again adds nothing', () => {
		const backup = readFixture();
		const first = mergeBackup(empty(), backup, { newId: counter(), now: 1000 });
		const second = mergeBackup(first.state, backup, { newId: counter(), now: 2000 });
		expect(second.summary).toEqual({
			projects: 0,
			sections: 0,
			labels: 0,
			tasks: 0,
			skipped: 12,
			warnings: backup.warnings,
		});
		expect(second.state.tasks).toEqual(first.state.tasks);
		expect(second.state.projects).toHaveLength(2);
		expect(second.state.sections).toEqual(first.state.sections);
		expect(second.state.labels).toHaveLength(3);
	});

	test("sections land in their project in Todoist's order, holding their top-level tasks", () => {
		const { state } = mergeBackup(empty(), readFixture(), { newId: counter(), now: 1000 });
		const longTerm = state.projects.find(p => p.name === 'Long Term')!;
		expect(state.sections.map(s => [s.name, s.projectId, s.order])).toEqual([
			['Someday', longTerm.id, 0],
			['Reading', longTerm.id, 1],
		]);
		const sectionName = (id: string | null) => state.sections.find(s => s.id === id)?.name ?? null;
		expect(state.tasks.filter(t => t.projectId === longTerm.id).map(t => [t.title, sectionName(t.sectionId)])).toEqual([
			['Visit Japan', 'Someday'],
			['Book flights', null],
			['Pack bags', null],
			['Read Dune', 'Reading'],
			['Read Dune', 'Reading'],
		]);
	});

	test('importing again puts tasks imported before sections existed into their sections', () => {
		const backup = readFixture();
		const first = mergeBackup(empty(), { ...backup, sections: [] }, { newId: counter(), now: 1000 });
		expect(first.state.tasks.every(t => t.sectionId === null)).toBe(true);
		const second = mergeBackup(first.state, backup, { newId: counter(), now: 2000 });
		expect(second.summary).toMatchObject({ sections: 2, tasks: 0, skipped: 12 });
		const sectioned = second.state.tasks.filter(t => t.sectionId !== null).map(t => t.title);
		expect(sectioned).toEqual(['Visit Japan', 'Read Dune', 'Read Dune']);
	});

	test('an existing section with the same name in the project is reused', () => {
		const state: ImportState = {
			tasks: [],
			projects: [{ id: 'p-long', name: 'Long Term', order: 0, createdAt: 0 }],
			sections: [{ id: 's-mine', projectId: 'p-long', name: 'someday', order: 0, createdAt: 0 }],
			labels: [],
			comments: [],
			reads: [],
		};
		const merged = mergeBackup(state, readFixture(), { newId: counter(), now: 1000 });
		expect(merged.summary.sections).toBe(1);
		expect(merged.state.sections.map(s => [s.name, s.order, s.sourceKey])).toEqual([
			['someday', 0, 'todoist:section:8Xmpl2Wq:Someday'],
			['Reading', 1, 'todoist:section:8Xmpl2Wq:Reading'],
		]);
		expect(merged.state.tasks.find(t => t.title === 'Visit Japan')!.sectionId).toBe('s-mine');
	});

	test("indents become subtasks in Todoist order, in their parent's project", () => {
		const nested = read(`${HEADER}\ntask,A,,4,1,,\ntask,B,,4,2,,\ntask,C,,4,3,,\ntask,D,,4,2,,\ntask,E,,4,1,,\n`);
		const { state } = mergeBackup(empty(), nested, { newId: counter(), now: 1000 });
		const byTitle = (title: string) => state.tasks.find(t => t.title === title)!;
		const project = state.projects[0]!.id;
		expect(state.tasks.map(t => [t.title, t.parentId, t.order, t.projectId])).toEqual([
			['A', null, 0, project],
			['B', byTitle('A').id, 0, project],
			['C', byTitle('B').id, 0, project],
			['D', byTitle('A').id, 1, project],
			['E', null, 0, project],
		]);
	});

	test('a new subtask under a task imported earlier joins it as the last subtask', () => {
		const first = mergeBackup(empty(), read(`${HEADER}\ntask,A,,4,1,,\ntask,B,,4,2,,\n`), {
			newId: counter(),
			now: 1000,
		});
		const second = mergeBackup(first.state, read(`${HEADER}\ntask,A,,4,1,,\ntask,B,,4,2,,\ntask,C,,4,2,,\n`), {
			newId: counter(),
			now: 2000,
		});
		expect(second.summary).toMatchObject({ tasks: 1, skipped: 2 });
		const a = second.state.tasks.find(t => t.title === 'A')!;
		expect(second.state.tasks.find(t => t.title === 'C')).toMatchObject({ parentId: a.id, order: 1 });
	});

	test('an existing project and label with the same name are reused', () => {
		const backup = readFixture();
		const state: ImportState = {
			tasks: [],
			projects: [{ id: 'mine', name: 'job', order: 0, createdAt: 0 }],
			sections: [],
			labels: [{ id: 'l-home', name: 'Home', color: 'gray', createdAt: 0 }],
			comments: [],
			reads: [],
		};
		const merged = mergeBackup(state, backup, { newId: counter(), now: 1000 });
		expect(merged.summary.projects).toBe(1);
		expect(merged.summary.labels).toBe(2);
		expect(merged.state.projects[0]).toEqual({
			id: 'mine',
			name: 'job',
			order: 0,
			createdAt: 0,
			sourceKey: 'todoist:project:9Xmpl3Zr',
		});
		expect(merged.state.tasks.find(t => t.title === 'Email Sam')!.projectId).toBe('mine');
		expect(merged.state.tasks.find(t => t.title === 'Water plants')!.labelIds).toEqual(['l-home']);
		// Backups carry no label colors, so a new label takes its name's default and an existing one keeps its own.
		expect(merged.state.labels.map(l => [l.name, l.color])).toEqual([
			['Home', 'gray'],
			['work', 'blue'],
			['deep-work', 'indigo'],
		]);
	});
});
