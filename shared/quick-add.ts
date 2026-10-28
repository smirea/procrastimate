import { z } from 'zod';
import { labelSchema, projectSchema, sectionSchema, taskSchema } from './model.ts';
import { linkify } from './links.ts';
import { isSavedPlace, placeLocation } from './triggers.ts';
import { DATE_KEY_PATTERN, MAX_RECURRENCE_INTERVAL } from './values.ts';
import {
	addDays,
	addInterval,
	dueAtTime,
	alignToRecurrence,
	isWeekday,
	fromDateKey,
	sortWeekdays,
	stepRecurrence,
	weeklyOn,
	toDateKey,
	toTimeOfDay,
	type DateKey,
	type Due,
	type Priority,
	type Recurrence,
	type RecurrenceUnit,
	type Reminder,
	type TimeOfDay,
	type Weekday,
} from './task.ts';

export const tokenKindSchema = z
	.enum(['due', 'recurrence', 'priority', 'reminder', 'project', 'section', 'label', 'place'])
	.meta({ id: 'TokenKind' });
export type TokenKind = z.infer<typeof tokenKindSchema>;

export const quickAddTokenSchema = z
	.object({ kind: tokenKindSchema, start: z.number().int(), end: z.number().int(), text: z.string() })
	.meta({
		id: 'QuickAddToken',
		description:
			"A recognized phrase, highlighted in the input. `start` and `end` are UTF-16 offsets, like JavaScript's.",
	});
export type QuickAddToken = z.infer<typeof quickAddTokenSchema>;

const taskShape = taskSchema.shape;

export const parsedQuickAddSchema = z
	.object({
		title: taskShape.title,
		due: taskShape.due,
		recurrence: taskShape.recurrence,
		priority: taskShape.priority.nullable(),
		reminders: taskShape.reminders,
		projectId: taskShape.projectId,
		sectionId: taskShape.sectionId,
		labelIds: taskShape.labelIds,
		location: taskShape.location.meta({ description: 'A saved place typed as `@name`, arriving there.' }),
		tokens: z.array(quickAddTokenSchema),
	})
	.meta({ id: 'ParsedQuickAdd' });
export type ParsedQuickAdd = z.infer<typeof parsedQuickAddSchema>;

export const parseOptionsSchema = z
	.object({
		now: z.date().meta({ 'x-swift-type': 'Date' }),
		projects: z.array(projectSchema).readonly().default([]),
		sections: z.array(sectionSchema).readonly().default([]),
		labels: z.array(labelSchema).readonly().default([]),
		projectId: taskShape.projectId.default(null).meta({
			description: 'The project set outside the text, such as the open project, whose sections `/name` reads.',
		}),
		due: taskShape.due
			.default(null)
			.meta({ description: 'The due date set outside the text, such as by a picker or on an existing task.' }),
		spoken: z.boolean().default(false).meta({
			description: 'Transcribed speech rather than typing, so typing shorthands that speech never means do not apply.',
		}),
		literal: z.boolean().default(false).meta({
			description: "Quick add's plain text toggle: no phrase is read, so the whole text is the title.",
		}),
	})
	.meta({ id: 'ParseOptions' });
export type ParseOptions = z.input<typeof parseOptionsSchema>;

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

const WEEKDAY = String.raw`(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)`;
/** Two or more weekdays joined by spaces, commas, slashes, `and`, or `&`, as in `mon, wed and fri`. */
const WEEKDAY_SEPARATOR = String.raw`(?:\s*[,/&]\s*(?:and\s+)?|\s+(?:and\s+)?)`;
const WEEKDAY_LIST = String.raw`${WEEKDAY}\b(?:${WEEKDAY_SEPARATOR}${WEEKDAY}\b)+`;
const SLASHED_WEEKDAYS = new RegExp(String.raw`^${WEEKDAY}(?:\s*/\s*${WEEKDAY})+$`, 'i');
const WEEKDAY_WORD = new RegExp(WEEKDAY, 'gi');
const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const ORDINAL = String.raw`\d{1,2}(?:st|nd|rd|th)?`;
export const ORDINAL_WORDS = [
	'first',
	'second',
	'third',
	'fourth',
	'fifth',
	'sixth',
	'seventh',
	'eighth',
	'ninth',
	'tenth',
	'eleventh',
	'twelfth',
	'thirteenth',
	'fourteenth',
	'fifteenth',
	'sixteenth',
	'seventeenth',
	'eighteenth',
	'nineteenth',
	'twentieth',
];
/** A day number as dictation sometimes writes it, from `first` to `thirty-first`. */
const SPELLED_ORDINAL = String.raw`(?:(?:twenty|thirty)(?:-|\s*)(?:${ORDINAL_WORDS.slice(0, 9).join('|')})|${ORDINAL_WORDS.join('|')}|thirtieth)`;
const SPELLED_ORDINAL_WORD = new RegExp(
	String.raw`(?:(twenty|thirty)[-\s]*)?\b(${ORDINAL_WORDS.join('|')}|thirtieth)\b`,
	'g',
);
/** Which weekday of the month, as in `every 3rd Monday` or `every last Friday`. */
const NTH_WORDS = ['first', 'second', 'third', 'fourth'];
const NTH = String.raw`(?:[1-4](?:st|nd|rd|th)|${NTH_WORDS.join('|')}|last)`;
/** Any day ordinal, so `5th Monday`, which most months lack, can be claimed as text rather than half read. */
const ANY_ORDINAL = String.raw`(?:\d{1,2}(?:st|nd|rd|th)|${SPELLED_ORDINAL})`;
/** `mo` is listed before `m` everywhere, so months never read as minutes. */
const DAY_UNIT = String.raw`(?:d(?:ays?)?|w(?:ks?|eeks?)?|mo(?:s|nths?)?|y(?:rs?|ears?)?)`;
const CLOCK_UNIT = String.raw`(?:m(?:ins?|inutes?)?|h(?:rs?|ours?)?)`;
const BEFORE_UNIT = String.raw`(?:m(?:ins?|inutes?)?|h(?:rs?|ours?)?|d(?:ays?)?|w(?:ks?|eeks?)?)`;

/**
 * A month and day in either order, as in `Dec. 25`, `October the 20th`, `the 1st of December`, or `the third of May`,
 * optionally after the weekday it falls on, which the date overrides. These come before a bare weekday, since the
 * first alternative that matches wins. A spelled-out day before the month needs `of`, so `the first May draft` stays
 * text.
 */
const MONTH_DAY = String.raw`(?:${MONTH}(?:\.\s*|\s+)(?:the\s+)?(?:${SPELLED_ORDINAL}|${ORDINAL})|(?:the\s+)?(?:(?:\d{1,2}(?:st|nd|rd|th)|${SPELLED_ORDINAL})\s+of|${ORDINAL})\s+${MONTH})`;
const MONTH_DATE = String.raw`(?:${WEEKDAY},?\s+)?${MONTH_DAY}(?:,?\s+(?:19|20)\d\d)?`;

const DATE = [
	'today|tonight|tomorrow|tmrw?|tom|eod|eow',
	String.raw`(?:next|nxt)\s+(?:week|${WEEKDAY})`,
	MONTH_DATE,
	WEEKDAY,
	String.raw`in\s+\d+\s*${DAY_UNIT}`,
	String.raw`\d+(?:d|wks?|w|mos?)`,
	String.raw`the\s+(?:${ANY_ORDINAL}|last)\s+${WEEKDAY}\b(?:\s+of\s+(?:the\s+month|${MONTH}\b))?`,
	String.raw`the\s+(?:\d{1,2}(?:st|nd|rd|th)|${SPELLED_ORDINAL}(?!\s+${MONTH}\b))(?!\s+${WEEKDAY}\b)(?:\s+of\s+the\s+month)?`,
	String.raw`\d{1,2}/\d{1,2}(?:/(?:\d{4}|\d{2}))?`,
].join('|');
/** `@` followed by a space means `at`, as in `Oct 2 @ 3pm`, while `@name` is a label. */
const AT = String.raw`(?:at|@)\s+`;
/**
 * A phrase that may follow a bare hour, so `at 10 tomorrow` is a time while `at 3 options` and `at 3 on the list` stay
 * text.
 */
const AFTER_BARE_HOUR = String.raw`(?:on\s+)?(?:${DATE})(?![\w!]|[/:]\d)|in\s+\d|(?:every|each)\s+(?:other|\d|day|week|month|year|weekday|workday|${WEEKDAY}|${MONTH})\b|(?:daily|weekdays|weekly|monthly|yearly|remind|urgent|important|p[1-4]|r\d+[mhdw])\b`;
/**
 * A bare four-digit 19xx or 20xx reads as a year unless `at` comes first. A bare hour, as in `at 10`, needs `at` and
 * no ordinary word after it.
 */
const TIME = String.raw`noon|midnight|\d{1,2}(?::\d{2})?(?:\s*[ap]m|[ap])|\d{1,2}:\d{2}|(?<=(?:\bat|@)\s+)\d{4}|(?!(?:19|20)\d\d)\d{4}|(?<=(?:\bat|@)\s+)(?:1\d|2[0-3]|[1-9])(?![\d:%]|[.,]\d|\s+(?!${AFTER_BARE_HOUR})[a-z])`;
/** Minutes and hours from now. A spelled-out unit needs `in`, since `study 2 hours` is a length, not a time. */
const MOMENT = String.raw`in\s+\d+(?:\s*${CLOCK_UNIT})?|\d+${CLOCK_UNIT}|\d+\s+(?:mins?|hrs?)`;
/** A comma may sit between a day and its time, as in `Oct 19, 10am`, which is how dictation writes them. */
const DATE_TIME = String.raw`(?:(?:on\s+)?(?<date1>${DATE})(?:,?\s+(?:${AT})?(?<time1>${TIME}))?|(?:${AT})?(?<time2>${TIME})(?:,?\s+(?:on\s+)?(?<date2>${DATE}))?|(?<moment>${MOMENT}))`;

/** `#` and `@` start a name or a handle, so `@5pm` and `@tom` stay text. */
const BEFORE = String.raw`(?<![\w#@!$€£]|\d[/:.])`;
const AFTER = String.raw`(?![\w!]|[/:]\d)`;

const NAME_CONTEXT = 'call|text|email|ping|ask|tell|meet|see|visit|thank|invite|message|dm|cc|with|and|to|for|from';
const PHRASE_WORDS = `at|noon|midnight|tonight|remind|every|urgent|important|${WEEKDAY}|${MONTH}`;
const ADDRESS = 'apt|apartment|unit|suite|ste|flat|room|rm|floor|fl|bldg|building|box';
const STREET =
	'st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|drive|ct|court|pl|place|sq|square|hwy|pkwy|terrace|way';

/**
 * Context guards for words that are also ordinary title text. Each match is masked out before the
 * date, recurrence, and reminder rules run, so those rules never see it.
 */
const GUARDS: RegExp[] = [
	/\b(?!tom\b)[Tt][Oo][Mm]\b/g,
	new RegExp(String.raw`(?<=\b(?:${NAME_CONTEXT})\s+)tom\b`, 'gi'),
	new RegExp(
		String.raw`(?<!${WEEKDAY}\b${WEEKDAY_SEPARATOR})\b(?:tom|sun|sat|wed|daily|weekdays|weekly|monthly|yearly)\b(?=\s+(?!(?:${PHRASE_WORDS}|and\s+${WEEKDAY})\b|(?:on\s+)?the\s+(?:\d|last\b|${SPELLED_ORDINAL}))[a-z]+(?![\w'’]))`,
		'gi',
	),
	new RegExp(String.raw`(?<=\b(?:${ADDRESS})\.?\s+)\d[\w:/]*`, 'gi'),
	new RegExp(String.raw`(?<!\w)\d[\w:/]*(?=\s+(?:[\w.]+\s+)?(?:${STREET})\b)`, 'gi'),
	new RegExp(
		String.raw`(?<!\b(?:[Ee]very|[Ee]ach|EVERY|EACH)\s+)\b(?:may|march)(?=\s+(?:the\s+)?${SPELLED_ORDINAL}\b)`,
		'g',
	),
	new RegExp(
		String.raw`(?<=\bthe\s+)${SPELLED_ORDINAL}(?=\s+(?!(?:at|(?:of\s+)?${MONTH}|of\s+the\s+month|${WEEKDAY}|p[1-4]|remind)\b)[a-z])`,
		'gi',
	),
	new RegExp(
		String.raw`(?<=\bthe\s+)(?<!\b(?:months?|monthly)\s+(?:on\s+)?the\s+)(?:${ANY_ORDINAL}|last)\s+${WEEKDAY}\b(?=\s+(?!(?:${PHRASE_WORDS}|of)\b)[a-z]+(?![\w'’]))`,
		'gi',
	),
];

/**
 * A weekday list repeats after `every`, next to a time, or when slashed, as in `tue/thu`. Anywhere
 * else, as in `discuss mon wed plan`, the whole list stays text, since no single day is meant.
 */
const WEEKDAY_LIST_CONTEXT = new RegExp(
	String.raw`(?<lead>\b(?:every|each)\s+|\bevery\s+other\s+|(?<![\w:/.$€£])(?:${AT})?(?:${TIME})\s+(?:on\s+)?)?(?<![\w#!$€£]|\d[/:.])(?<list>${WEEKDAY_LIST})(?<trail>\s+(?:${AT})?(?:${TIME})(?![\w!]|[/:]\d))?`,
	'gi',
);

function maskProseWeekdayLists(text: string): string {
	return text.replace(WEEKDAY_LIST_CONTEXT, (match, ...args) => {
		const { lead, list, trail } = args.at(-1) as Record<string, string | undefined>;
		return lead || trail || SLASHED_WEEKDAYS.test(list!) ? match : '_'.repeat(match.length);
	});
}

/**
 * Extra guards for speech. A bare four-digit number is not a time without `at`, compact units such as
 * `5m` or `2d` are typing shorthands (Scribe writes `5M` for millions), `Tuesday's` and `today's` name
 * something rather than set a date, `the 5th chapter` is an ordinal, not a date, and a weekday inside
 * a name or before an event, as in `Monday Night Football`, `Black Friday`, or `Sunday lunch`, stays
 * text. A 12-hour clock time without am or pm, such as `3:30`, is ambiguous in speech and stays text.
 */
const SPOKEN_GUARDS: RegExp[] = [
	new RegExp(
		String.raw`(?<![\w#@!$€£:/.])(?<!\bat\s+)(?<!(?:${MONTH}\.?\s+(?:${SPELLED_ORDINAL}|${ORDINAL})|\s${MONTH}),?\s)\d{4}(?![\w:/])`,
		'gi',
	),
	/(?<![\w#@!$€£.])r?\d+(?:mos?|m(?:ins?)?|h(?:rs?)?|d|w(?:ks?)?|y(?:rs?)?)(?![\w!])/gi,
	/(?<!\bin\s+)(?<![\w.])\d+\s+(?:mins?|hrs?)\b(?!\s+before)/gi,
	new RegExp(String.raw`\b(?:${WEEKDAY}|today|tonight|tomorrow|tom)(?=['’]s\b)`, 'gi'),
	new RegExp(String.raw`(?<=\bthe\s+)\d{1,2}(?:st|nd|rd|th)(?=\s+(?!(?:at|of|${MONTH}|${WEEKDAY})\b)[a-z]+)`, 'gi'),
	new RegExp(String.raw`\b(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day(?=\s+(?!${MONTH}\b)[A-Z][a-z])`, 'g'),
	new RegExp(
		String.raw`\b${WEEKDAY}(?=\s+(?:lunch|dinner|breakfast|brunch|drinks|meeting|meetings|standup|stand-up|service|game|match|party|class|shift|market|plans|practice|session|show)\b)`,
		'gi',
	),
	/(?<![\w:/.$€£])(?:0?\d|1[0-2]):\d{2}(?![\w:]|\s*[ap]m?\b)/gi,
	/(?<=\b(?:black|good|cyber|ash|easter|holy|casual|fat|super)\s+)(?:mon|tues|wednes|thurs|fri|satur|sun)day\b/gi,
];

function maskGuarded(input: string, spoken: boolean): string {
	const guards = spoken ? [...GUARDS, ...SPOKEN_GUARDS] : GUARDS;
	return guards.reduce((text, guard) => text.replace(guard, m => '_'.repeat(m.length)), maskProseWeekdayLists(input));
}

type Context = { now: Date; today: DateKey; time: TimeOfDay; spoken: boolean };

/** A null date means only a time was typed. */
type DuePhrase = { date: DateKey | null; time: TimeOfDay | null };

/** A weekday repeat such as `every mon` anchors the first occurrence to that weekday. */
type RecurrencePhrase = { recurrence: Recurrence; anchor: DateKey | null };

/** An absolute reminder may omit its date or time until the task's due date is known. */
type ReminderDraft = { kind: 'before'; minutes: number } | { kind: 'at'; date: DateKey | null; time: TimeOfDay | null };

type Match =
	| { kind: 'due'; due: DuePhrase }
	| { kind: 'recurrence'; recurrence: RecurrencePhrase }
	| { kind: 'priority'; priority: Priority }
	| { kind: 'project'; projectId: string }
	| { kind: 'section'; sectionId: string }
	| { kind: 'label'; labelId: string }
	| { kind: 'place'; labelId: string }
	| { kind: 'reminder'; reminder: ReminderDraft };

type Rule = {
	kind: TokenKind;
	pattern: RegExp;
	repeatable: boolean;
	guarded: boolean;
	/** `text` keeps the phrase in the title but claims it, so no later rule reads part of it. */
	read: (m: RegExpExecArray, ctx: Context) => Match | 'text' | null;
};

type DurationUnit = 'minute' | 'hour' | RecurrenceUnit;

const UNIT_LETTERS: Record<string, DurationUnit> = { m: 'minute', h: 'hour', d: 'day', w: 'week', y: 'year' };
const UNIT_MINUTES: Partial<Record<DurationUnit, number>> = { minute: 1, hour: 60, day: 1440, week: 10_080 };

function unitOf(text: string): DurationUnit | null {
	const t = text.toLowerCase();
	return t.startsWith('mo') ? 'month' : (UNIT_LETTERS[t[0] ?? ''] ?? null);
}

/** A clock time as typed, such as `5pm`, `5:30p`, `17:30`, `1730`, or `noon`. */
export function resolveTime(text: string): TimeOfDay | null {
	const t = text.toLowerCase().replaceAll(/\s+/g, '');
	if (t === 'noon') return toTimeOfDay(12, 0);
	if (t === 'midnight') return toTimeOfDay(0, 0);
	const m = /^(\d{1,2}):?(\d{2})?(?:([ap])m?)?$/.exec(t);
	if (!m) return null;
	let hours = Number(m[1]);
	const minutes = Number(m[2] ?? 0);
	const meridiem = m[3];
	if (minutes > 59) return null;
	if (meridiem) {
		if (hours < 1 || hours > 12) return null;
		hours = (hours % 12) + (meridiem === 'p' ? 12 : 0);
	} else if (hours > 23) {
		return null;
	} else if (/^\d{1,2}$/.test(t) && hours >= 1 && hours <= 6) {
		// A bare hour such as `at 3` means the afternoon up to 6, so 7 to 11 are the morning and 12 is noon.
		hours += 12;
	}
	return toTimeOfDay(hours, minutes);
}

const weekdayIndex = (text: string) => WEEKDAYS.indexOf(text.slice(0, 3) as (typeof WEEKDAYS)[number]);
const monthIndex = (text: string) => MONTHS.indexOf(text.slice(0, 3) as (typeof MONTHS)[number]);

/** The next date on that weekday, counting today. */
function nextWeekday(today: DateKey, weekday: number): DateKey {
	return addDays(today, (weekday - fromDateKey(today).getDay() + 7) % 7);
}

function daysToNextMonday(today: DateKey): number {
	return (8 - fromDateKey(today).getDay()) % 7 || 7;
}

function calendarDate(year: number, month: number, day: number): DateKey | null {
	if (year < 1000) return null;
	const candidate = new Date(year, month, day);
	return month >= 0 && candidate.getDate() === day ? toDateKey(candidate) : null;
}

function monthDay(today: DateKey, month: number, day: number, yearText?: string): DateKey | null {
	if (yearText) return calendarDate(yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText), month, day);
	const year = Number(today.slice(0, 4));
	for (let candidate = year; candidate <= year + 4; candidate++) {
		const key = calendarDate(candidate, month, day);
		if (key && key >= today) return key;
	}
	return null;
}

type Day = { date: DateKey; time: TimeOfDay | null };

const DAY_WORDS: Record<string, (today: DateKey) => Day> = {
	today: today => ({ date: today, time: null }),
	tonight: today => ({ date: today, time: toTimeOfDay(20, 0) }),
	tomorrow: today => ({ date: addDays(today, 1), time: null }),
	tmr: today => ({ date: addDays(today, 1), time: null }),
	tmrw: today => ({ date: addDays(today, 1), time: null }),
	tom: today => ({ date: addDays(today, 1), time: null }),
	eod: today => ({ date: today, time: toTimeOfDay(17, 0) }),
	eow: today => ({ date: nextWeekday(today, 5), time: toTimeOfDay(17, 0) }),
};

/** The next nth weekday of a month, counting today, or of the named month. Most months lack a 5th weekday. */
function nthWeekdayDate(today: DateKey, nthText: string, weekdayText: string, monthText?: string): DateKey | null {
	const weekday = weekdayIndex(weekdayText);
	const week = nthText === 'last' ? -1 : Number(nthText);
	if (weekday === -1 || !(week === -1 || (week >= 1 && week <= 4))) return null;
	const recurrence: Recurrence = {
		interval: 1,
		unit: 'month',
		nth: { week: week as 1 | 2 | 3 | 4 | -1, weekday: weekday as Weekday },
	};
	if (!monthText) return alignToRecurrence(today, recurrence);
	const month = monthIndex(monthText);
	if (month === -1) return null;
	const inYear = (year: number) => alignToRecurrence(calendarDate(year, month, 1)!, recurrence);
	const date = inYear(Number(today.slice(0, 4)));
	return date && date < today ? inYear(Number(today.slice(0, 4)) + 1) : date;
}

const DATE_READERS: Array<[RegExp, (m: RegExpExecArray, today: DateKey) => DateKey | null]> = [
	[
		/^the (\d{1,2}|last)(?:st|nd|rd|th)? ([a-z]+)(?: of (?:the month|([a-z]+)))?$/,
		(m, today) => nthWeekdayDate(today, m[1]!, m[2]!, m[3]),
	],
	[/^(?:next|nxt) week$/, (_, today) => addDays(today, daysToNextMonday(today))],
	[/^(?:next|nxt) ([a-z]+)$/, (m, today) => addDays(today, daysToNextMonday(today) + ((weekdayIndex(m[1]!) + 6) % 7))],
	[/^([a-z]+)$/, (m, today) => (weekdayIndex(m[1]!) === -1 ? null : nextWeekday(today, weekdayIndex(m[1]!)))],
	[
		/^(?:in )?(\d+) ?([a-z]+)$/,
		(m, today) => {
			const unit = unitOf(m[2]!);
			return unit === 'minute' || unit === 'hour' || !unit ? null : addInterval(today, Number(m[1]), unit);
		},
	],
	[
		/^the (\d{1,2})(?:st|nd|rd|th)?(?: of the month)?$/,
		(m, today) => {
			const day = Number(m[1]);
			const start = fromDateKey(today);
			for (let months = 0; months <= 12; months++) {
				const key = calendarDate(start.getFullYear(), start.getMonth() + months, day);
				if (key && key >= today) return key;
			}
			return null;
		},
	],
	[
		/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/,
		(m, today) => {
			const first = Number(m[1]);
			const second = Number(m[2]);
			const dayFirst = first > 12 && second <= 12;
			const month = dayFirst ? second : first;
			if (month < 1 || month > 12) return null;
			return monthDay(today, month - 1, dayFirst ? first : second, m[3]);
		},
	],
	[
		new RegExp(String.raw`^(?:${WEEKDAY},? )?([a-z]+)(?:\. ?| )(?:the )?(\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?$`),
		(m, today) => monthDay(today, monthIndex(m[1]!), Number(m[2]), m[3]),
	],
	[
		new RegExp(String.raw`^(?:${WEEKDAY},? )?(?:the )?(\d{1,2})(?:st|nd|rd|th)?(?: of)? ([a-z]+)(?:,? (\d{4}))?$`),
		(m, today) => monthDay(today, monthIndex(m[2]!), Number(m[1]), m[3]),
	],
];

/** Lowercases and writes each spelled-out day number in digits, so `the twenty-first` reads `the 21`. */
function digitOrdinals(text: string): string {
	return text
		.toLowerCase()
		.replaceAll(/\s+/g, ' ')
		.trim()
		.replaceAll(SPELLED_ORDINAL_WORD, (_, tens: string | undefined, word: string) =>
			String(
				(tens === 'twenty' ? 20 : tens === 'thirty' ? 30 : 0) +
					(word === 'thirtieth' ? 30 : ORDINAL_WORDS.indexOf(word) + 1),
			),
		);
}

function resolveDate(text: string, today: DateKey): Day | null {
	const t = digitOrdinals(text);
	const word = DAY_WORDS[t];
	if (word) return word(today);
	for (const [pattern, read] of DATE_READERS) {
		const m = pattern.exec(t);
		const date = m && read(m, today);
		if (date) return { date, time: null };
	}
	return null;
}

function resolveMoment(text: string, ctx: Context): DuePhrase | null {
	const m = /^(?:in\s+)?(\d+)\s*([a-z]*)$/i.exec(text);
	if (!m) return null;
	// A bare `in 2` is a typing shorthand; spoken, it is usually prose such as `split in 2 groups`.
	if (ctx.spoken && !m[2]) return null;
	const now = ctx.now;
	const unit = m[2] ? unitOf(m[2]) : 'minute';
	if (unit !== 'minute' && unit !== 'hour') return null;
	const at = new Date(now.getTime() + Number(m[1]) * UNIT_MINUTES[unit]! * 60_000);
	return { date: toDateKey(at), time: toTimeOfDay(at.getHours(), at.getMinutes()) };
}

/**
 * A date past 9999-12-31 is not a `DateKey`, and the server rejects the write that carries it, so such a phrase, as in
 * `3929284d`, stays text.
 */
function readDateTime(groups: Record<string, string | undefined>, ctx: Context): DuePhrase | null {
	const phrase = readPhrase(groups, ctx);
	return phrase?.date && !DATE_KEY_PATTERN.test(phrase.date) ? null : phrase;
}

function readPhrase(groups: Record<string, string | undefined>, ctx: Context): DuePhrase | null {
	if (groups.moment) return resolveMoment(groups.moment, ctx);
	const dateText = groups.date1 ?? groups.date2;
	const timeText = groups.time1 ?? groups.time2;
	const day = dateText ? resolveDate(dateText, ctx.today) : null;
	const time = timeText ? resolveTime(timeText) : null;
	if ((dateText && !day) || (timeText && !time)) return null;
	return { date: day?.date ?? null, time: time ?? day?.time ?? null };
}

const PRIORITY_WORDS: Record<string, Priority> = { '!!!': 1, urgent: 1, '!!': 2, important: 2 };
const RECURRENCE_ADVERBS: Record<string, RecurrenceUnit> = {
	daily: 'day',
	weekdays: 'weekday',
	weekly: 'week',
	monthly: 'month',
	yearly: 'year',
	annually: 'year',
};

function readRecurrence(groups: Record<string, string | undefined>, ctx: Context): RecurrencePhrase | null {
	const {
		months,
		monthNth,
		monthNthDay,
		nth,
		nthDay,
		monthDay,
		dayOfMonth,
		yearDay,
		other,
		otherUnit,
		otherDays,
		interval,
		intervalUnit,
		unit,
		workday,
		weekdays,
		listed,
		adverb,
	} = groups;
	const everyMonths = months?.toLowerCase() === 'other' ? 2 : Number(months ?? 1);
	const nthText = (monthNth ?? nth)?.toLowerCase();
	const dayText = monthDay ?? dayOfMonth;
	if (nthText || dayText) {
		const day = dayText ? Number(/\d+/.exec(digitOrdinals(dayText))![0]) : null;
		if (day !== null && (day < 1 || day > 31)) return null;
		const recurrence: Recurrence = nthText
			? {
					interval: everyMonths,
					unit: 'month',
					nth: {
						week: nthText === 'last' ? -1 : ((NTH_WORDS.indexOf(nthText) + 1 || Number(nthText[0])) as 1 | 2 | 3 | 4),
						weekday: weekdayIndex((monthNthDay ?? nthDay)!.toLowerCase()) as Weekday,
					},
				}
			: { interval: everyMonths, unit: 'month', day: day! };
		return { recurrence, anchor: alignToRecurrence(ctx.today, recurrence) };
	}
	if (yearDay) {
		const day = resolveDate(yearDay, ctx.today);
		return day && { recurrence: { interval: 1, unit: 'year' }, anchor: day.date };
	}
	const unitText = otherUnit ?? intervalUnit ?? unit;
	const days = sortWeekdays(
		[...(weekdays ?? listed ?? otherDays ?? '').matchAll(WEEKDAY_WORD)].map(
			w => weekdayIndex(w[0].toLowerCase()) as Weekday,
		),
	);
	const recurrence: Recurrence | null = workday
		? { interval: 1, unit: 'weekday' }
		: days.length
			? weeklyOn(other ? 2 : 1, days)
			: adverb
				? { interval: 1, unit: RECURRENCE_ADVERBS[adverb.toLowerCase()]! }
				: unitText
					? { interval: other ? 2 : Number(interval ?? 1), unit: unitOf(unitText) as RecurrenceUnit }
					: null;
	if (!recurrence) return null;
	const anchor = days.length
		? alignToRecurrence(ctx.today, { interval: 1, unit: 'week', days })
		: recurrence.unit === 'weekday' && !isWeekday(ctx.today)
			? nextWeekday(ctx.today, 1)
			: null;
	return { recurrence, anchor };
}

/** Ordered by precedence: an earlier rule claims its text before later rules can. */
const RULES: Rule[] = [
	{
		kind: 'reminder',
		repeatable: true,
		guarded: true,
		pattern: new RegExp(
			String.raw`${BEFORE}(?:remind(?:\s+me)?\s+(?:(?<amount>\d+)\s*(?<unit>${BEFORE_UNIT})\s+before|${DATE_TIME})|r(?<short>\d+)(?<shortUnit>[mhdw]))${AFTER}`,
			'gi',
		),
		read: (m, ctx) => {
			const groups = m.groups ?? {};
			const amount = groups.amount ?? groups.short;
			const unitText = groups.unit ?? groups.shortUnit;
			if (amount && unitText) {
				const minutes = Number(amount) * UNIT_MINUTES[unitOf(unitText)!]!;
				return { kind: 'reminder', reminder: { kind: 'before', minutes } };
			}
			const phrase = readDateTime(groups, ctx);
			return phrase ? { kind: 'reminder', reminder: { kind: 'at', ...phrase } } : null;
		},
	},
	{
		kind: 'recurrence',
		repeatable: false,
		guarded: true,
		pattern: new RegExp(
			String.raw`${BEFORE}(?:(?:(?:every|each)\s+(?:(?<months>\d+|other)\s+)?months?|monthly)\s+(?:on\s+)?the\s+(?:(?<monthNth>${NTH})\s+(?<monthNthDay>${WEEKDAY})\b|(?<monthNoNth>${ANY_ORDINAL}\s+${WEEKDAY})\b|(?<monthDay>${ORDINAL}|${SPELLED_ORDINAL}))|(?:every|each)\s+(?:(?<yearDay>${MONTH_DAY})|(?<nth>${NTH})\s+(?<nthDay>${WEEKDAY})\b(?:\s+of\s+(?:the|each|every)\s+month)?|(?<noNth>${ANY_ORDINAL}\s+${WEEKDAY})\b(?:\s+of\s+(?:the|each|every)\s+month)?|(?<dayOfMonth>(?:\d{1,2}(?:st|nd|rd|th)|${SPELLED_ORDINAL})\s+of\s+(?:the|each|every)\s+month|\d{1,2}(?:st|nd|rd|th)(?!\s+(?!(?:at|p[1-4]|remind)\b)[a-z]))|(?<other>other)\s+(?:(?<otherUnit>day|week|month|year)|(?<=\bevery\s+other\s+)(?<otherDays>${WEEKDAY_LIST}|${WEEKDAY}))|(?<interval>\d+)\s*(?<intervalUnit>${DAY_UNIT})|(?<unit>day|week|month|year)|(?<workday>weekday|workday)|(?<weekdays>${WEEKDAY_LIST}|${WEEKDAY}))|(?<listed>${WEEKDAY_LIST})|(?<adverb>daily|weekdays|weekly|monthly|yearly|annually))${AFTER}`,
			'gi',
		),
		read: (m, ctx) => {
			// Most months have no 5th Monday, so `every 5th Monday` stays text whole rather than leave `every 5th` behind.
			if (m.groups?.noNth || m.groups?.monthNoNth) return 'text';
			const phrase = readRecurrence(m.groups ?? {}, ctx);
			if (!phrase) return null;
			const { interval } = phrase.recurrence;
			// Too long a repeat stays text, and `1000` in `every 1000 days` must not then read as a time.
			if (!(interval >= 1 && interval <= MAX_RECURRENCE_INTERVAL)) return 'text';
			return { kind: 'recurrence', recurrence: phrase };
		},
	},
	{
		kind: 'priority',
		repeatable: false,
		guarded: true,
		pattern: new RegExp(
			String.raw`(?<![\w#@])p([1-4])(?!\w)|(?<!\S)(!!!?)(?!\S)|(?<![\w#@])(urgent|important)\b`,
			'gi',
		),
		read: (m, ctx) => {
			const [, level, bangs, word] = m;
			// People say `important` in passing, so speech sets priority only by its level.
			if (ctx.spoken && !level) return null;
			const priority = level ? (Number(level) as Priority) : PRIORITY_WORDS[(bangs ?? word)!.toLowerCase()];
			return priority ? { kind: 'priority', priority } : null;
		},
	},
	{
		kind: 'due',
		repeatable: false,
		guarded: true,
		pattern: new RegExp(`${BEFORE}${DATE_TIME}${AFTER}`, 'gi'),
		read: (m, ctx) => {
			const due = readDateTime(m.groups ?? {}, ctx);
			return due ? { kind: 'due', due } : null;
		},
	},
];

export const escapeRegExp = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/**
 * `#Name`, `/Name`, or `@Name` for a name that exists, at the start of the text or after whitespace, so `a@b.com` and
 * `and/or` never match. The name must end the word, so `@home.com` and `@homework` do not read as `@home`.
 */
function namedRule(
	kind: 'project' | 'section' | 'label' | 'place',
	sigil: '#' | '/' | '@',
	items: readonly { id: string; name: string }[],
	read: (id: string) => Match,
): Rule | null {
	if (items.length === 0) return null;
	const byName = new Map(items.map(item => [item.name.toLowerCase(), item.id]));
	const names = [...byName.keys()].toSorted((a, b) => b.length - a.length).map(escapeRegExp);
	return {
		kind,
		repeatable: kind === 'label',
		guarded: false,
		pattern: new RegExp(String.raw`(?<!\S)${sigil}(${names.join('|')})(?![\w#@]|[./:]\w)`, 'gi'),
		read: m => read(byName.get(m[1]!.toLowerCase())!),
	};
}

/**
 * A typed date wins, moved to the first listed weekday on or after it, even when that leaves it in the past.
 * Otherwise a time never lands in the past. A time alone lands on the date set outside the text, or on the
 * first future occurrence: today, or tomorrow once that time has passed. A repeat without a typed date starts
 * on its first weekday, the date set outside the text, or today, and moves to the next occurrence when its
 * time has passed.
 */
function resolveDue(
	phrase: DuePhrase | null,
	repeat: RecurrencePhrase | null,
	outside: Due | null,
	ctx: Context,
): Due | null {
	if (phrase?.date) {
		return { date: (repeat && alignToRecurrence(phrase.date, repeat.recurrence)) ?? phrase.date, time: phrase.time };
	}
	const time = phrase?.time ?? (repeat && !repeat.anchor ? outside?.time : null) ?? null;
	const passed = (date: DateKey) => time !== null && (date < ctx.today || (date === ctx.today && time < ctx.time));
	if (repeat) {
		const start = repeat.anchor ?? outside?.date ?? ctx.today;
		const next = passed(ctx.today) ? stepRecurrence(ctx.today, repeat.recurrence) : null;
		const date = passed(start) ? (next ?? ctx.today) : start;
		return { date, time };
	}
	return time ? dueAtTime(outside, time, ctx.today, ctx.time) : null;
}

function resolveReminder(draft: ReminderDraft, due: Due | null, ctx: Context): Reminder {
	if (draft.kind === 'before') return draft;
	const time = draft.time ?? toTimeOfDay(9, 0);
	const fallback = draft.time && draft.time < ctx.time ? addDays(ctx.today, 1) : ctx.today;
	return { kind: 'at', date: draft.date ?? due?.date ?? fallback, time };
}

export function parseQuickAdd(input: string, options: ParseOptions): ParsedQuickAdd {
	const now = options.now;
	const spoken = options.spoken ?? false;
	const ctx: Context = { now, today: toDateKey(now), time: toTimeOfDay(now.getHours(), now.getMinutes()), spoken };
	const labels = options.labels ?? [];
	// A saved place is a label, so names never collide, and like a project its last `@name` wins, as a task has one place.
	const named = [
		namedRule('project', '#', options.projects ?? [], projectId => ({ kind: 'project', projectId })),
		namedRule(
			'label',
			'@',
			labels.filter(l => !isSavedPlace(l)),
			labelId => ({ kind: 'label', labelId }),
		),
		namedRule('place', '@', labels.filter(isSavedPlace), labelId => ({ kind: 'place', labelId })),
	].filter(rule => rule !== null);
	const rules = options.literal ? [] : [...RULES.slice(0, 2), ...named, ...RULES.slice(2)];
	// Every phrase a rule recognizes is masked out of both views, including kept-as-text and
	// superseded ones, so a later rule never reads part of it as something else.
	const claim = (text: string, start: number, end: number) =>
		text.slice(0, start) + '_'.repeat(end - start) + text.slice(end);
	// A link is never a phrase, so `5m`, `#top`, or `@user` inside a URL stays part of it.
	let raw = linkify(input).reduce((text, s) => (s.href ? claim(text, s.start, s.end) : text), input);
	let guarded = maskGuarded(raw, spoken);

	const tokens: QuickAddToken[] = [];
	const matches: Match[] = [];
	const apply = (rule: Rule) => {
		const found: Array<{ token: QuickAddToken; match: Match }> = [];
		const spans: Array<[number, number]> = [];
		for (const m of (rule.guarded ? guarded : raw).matchAll(rule.pattern)) {
			const start = m.index;
			const end = start + m[0].length;
			const text = input.slice(start, end);
			const match = rule.read(m, ctx);
			if (!match) continue;
			spans.push([start, end]);
			if (match === 'text') continue;
			found.push({ token: { kind: rule.kind, start, end, text }, match });
		}
		// Attributes usually trail the title, so a single-valued attribute takes its last phrase.
		for (const { token, match } of rule.repeatable ? found : found.slice(-1)) {
			tokens.push(token);
			matches.push(match);
		}
		for (const [start, end] of spans) {
			raw = claim(raw, start, end);
			guarded = claim(guarded, start, end);
		}
	};
	for (const rule of rules) {
		apply(rule);
		// A section belongs to one project, so `/name` reads the typed `#project`'s sections, else the outside one's.
		if (rule.kind !== 'project') continue;
		const typed = matches.findLast(match => match.kind === 'project');
		const inProject = typed?.kind === 'project' ? typed.projectId : (options.projectId ?? null);
		const sections = (options.sections ?? []).filter(section => section.projectId === inProject);
		const sectionRule = namedRule('section', '/', sections, sectionId => ({ kind: 'section', sectionId }));
		if (sectionRule) apply(sectionRule);
	}
	tokens.sort((a, b) => a.start - b.start);

	let duePhrase: DuePhrase | null = null;
	let repeat: RecurrencePhrase | null = null;
	let priority: Priority | null = null;
	let projectId: string | null = null;
	let sectionId: string | null = null;
	const labelIds = new Set<string>();
	let placeId: string | null = null;
	const reminderDrafts: ReminderDraft[] = [];
	for (const match of matches) {
		switch (match.kind) {
			case 'due':
				duePhrase = match.due;
				break;
			case 'recurrence':
				repeat = match.recurrence;
				break;
			case 'priority':
				priority = match.priority;
				break;
			case 'project':
				projectId = match.projectId;
				break;
			case 'section':
				sectionId = match.sectionId;
				break;
			case 'label':
				labelIds.add(match.labelId);
				break;
			case 'place':
				placeId = match.labelId;
				break;
			case 'reminder':
				reminderDrafts.push(match.reminder);
				break;
			default: {
				const never: never = match;
				throw new Error(`Unhandled match ${JSON.stringify(never)}`);
			}
		}
	}

	// Punctuation right after a removed phrase stays on the word before it, so `Pay rent oct 20.` saves `Pay rent.`,
	// and a comma or colon left at the very start, as in `Tomorrow, call mom`, goes.
	let title = '';
	let cursor = 0;
	const append = (segment: string) => {
		if (!/^[.,;:!?]/.test(segment)) title += segment;
		else if (title.trim()) title = title.trimEnd() + segment;
		else title = segment.replace(/^[,;:]+/, '');
	};
	for (const token of tokens) {
		append(input.slice(cursor, token.start));
		title += ' ';
		cursor = token.end;
	}
	append(input.slice(cursor));
	title = title.replaceAll(/\s+/g, ' ').trim();

	const place = labels.find(l => l.id === placeId);
	const outside = options.due ?? null;
	const due = resolveDue(duePhrase, repeat, outside, ctx);
	return {
		title,
		due,
		recurrence: repeat?.recurrence ?? null,
		priority,
		reminders: reminderDrafts.map(draft => resolveReminder(draft, due ?? outside, ctx)),
		projectId,
		sectionId,
		labelIds: [...labelIds],
		location: place && isSavedPlace(place) ? placeLocation(place, 'arrive') : null,
		tokens,
	};
}
