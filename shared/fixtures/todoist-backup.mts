import type { BackupFile } from '../todoist.ts';

const COLUMNS = [
	'TYPE',
	'CONTENT',
	'DESCRIPTION',
	'IS_COLLAPSED',
	'PRIORITY',
	'INDENT',
	'AUTHOR',
	'RESPONSIBLE',
	'DATE',
	'DATE_LANG',
	'TIMEZONE',
	'DURATION',
	'DURATION_UNIT',
	'DEADLINE',
	'DEADLINE_LANG',
	'REMINDER_TYPE',
	'REMINDER_OFFSET',
	'REMINDER_DATE',
	'REMINDER_DATE_LANG',
] as const;

type Row = Partial<Record<(typeof COLUMNS)[number], string>>;

const quote = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

/** Written like Todoist writes a project: a byte order mark, the full header, and CRLF line endings. */
const csv = (rows: Row[]) =>
	`\uFEFF${[COLUMNS.join(','), ...rows.map(row => COLUMNS.map(c => quote(row[c] ?? '')).join(','))].join('\r\n')}\r\n`;

const task = (content: string, fields: Row = {}): Row => ({
	TYPE: 'task',
	CONTENT: content,
	PRIORITY: '4',
	INDENT: '1',
	AUTHOR: 'Sample User (1000001)',
	TIMEZONE: 'Europe/London',
	...fields,
});
const dated = (date: string): Row => ({ DATE: date, DATE_LANG: 'en' });
const blank: Row = {};

/** A synthetic backup with the shape of a real Todoist export. Every name and task in it is made up. */
export const todoistBackupFiles: BackupFile[] = [
	{
		name: 'Inbox [6Xmpl1Fq].csv',
		text: csv([
			{ TYPE: 'meta', CONTENT: 'view_style=list' },
			task('Call the dentist', { PRIORITY: '1', ...dated('Oct 22') }),
			{ TYPE: 'reminder', REMINDER_TYPE: 'relative', REMINDER_OFFSET: '30' },
			task('cancel [meetup.com](https://meetup.com)', dated('Dec 4')),
			task('Renew passport #Travel', { PRIORITY: '2', ...dated('every March 2nd 11 am') }),
			task('Water plants @home', {
				DESCRIPTION: 'Ferns first, then "the big one"\nUse the blue can',
				...dated('every May 13 11 am'),
			}),
			{ TYPE: 'note', CONTENT: 'Bought a new can, see receipt', AUTHOR: 'Sample User (1000001)' },
			task('Fix bike', dated('every! 3 days')),
			blank,
		]),
	},
	{
		name: 'Long Term [8Xmpl2Wq].csv',
		text: csv([
			{ TYPE: 'section', CONTENT: 'Someday' },
			task('Visit Japan', {
				PRIORITY: '2',
				...dated('Jun 21 2027'),
				DURATION: '90',
				DURATION_UNIT: 'minute',
				DEADLINE: '2027-06-01',
				DEADLINE_LANG: 'en',
			}),
			task('Book flights', { PRIORITY: '3', INDENT: '2', ...dated('May 23, 2027') }),
			{ TYPE: 'reminder', REMINDER_TYPE: 'absolute', REMINDER_DATE: '2027-05-20T09:00:00', REMINDER_DATE_LANG: 'en' },
			task('Pack bags', { INDENT: '3' }),
			blank,
			{ TYPE: 'section', CONTENT: 'Reading' },
			task('Read Dune'),
			task('Read Dune'),
		]),
	},
	{
		name: 'Job [9Xmpl3Zr].csv',
		text: csv([
			task('Quarterly review @work @deep-work', { PRIORITY: '1', RESPONSIBLE: 'Someone Else (1000002)' }),
			task('Email Sam', { DATE: 'jeden Montag', DATE_LANG: 'de' }),
		]),
	},
	{ name: '__MACOSX/._Job [9Xmpl3Zr].csv', text: '\u0000\u0005junk' },
];
