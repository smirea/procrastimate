import {
	addDays,
	addInterval,
	isWeekday,
	fromDateKey,
	toDateKey,
	toTimeOfDay,
	type DateKey,
	type Due,
	type Label,
	type Priority,
	type Project,
	type Recurrence,
	type RecurrenceUnit,
	type Reminder,
	type TimeOfDay,
} from './task.ts';

export type TokenKind = 'due' | 'recurrence' | 'priority' | 'reminder' | 'project' | 'label';

export type QuickAddToken = { kind: TokenKind; start: number; end: number; text: string };

export type ParsedQuickAdd = {
	title: string;
	due: Due | null;
	recurrence: Recurrence | null;
	priority: Priority | null;
	reminders: Reminder[];
	projectId: string | null;
	labelIds: string[];
	tokens: QuickAddToken[];
};

export type ParseOptions = {
	now: Date;
	projects?: readonly Project[];
	labels?: readonly Label[];
	/** Token texts the user chose to keep as plain title text, compared case-insensitively. */
	disabled?: readonly string[];
	/** The due date set outside the text, such as by a picker or on an existing task. */
	due?: Due | null;
};

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

const WEEKDAY = String.raw`(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)`;
const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const ORDINAL = String.raw`\d{1,2}(?:st|nd|rd|th)?`;
/** `mo` is listed before `m` everywhere, so months never read as minutes. */
const DAY_UNIT = String.raw`(?:d(?:ays?)?|w(?:ks?|eeks?)?|mo(?:s|nths?)?|y(?:rs?|ears?)?)`;
const CLOCK_UNIT = String.raw`(?:m(?:ins?|inutes?)?|h(?:rs?|ours?)?)`;
const BEFORE_UNIT = String.raw`(?:m(?:ins?|inutes?)?|h(?:rs?|ours?)?|d(?:ays?)?|w(?:ks?|eeks?)?)`;

const DATE = [
	'today|tonight|tomorrow|tmrw?|tom|eod|eow',
	String.raw`(?:next|nxt)\s+(?:week|${WEEKDAY})`,
	WEEKDAY,
	String.raw`in\s+\d+\s*${DAY_UNIT}`,
	String.raw`\d+(?:d|wks?|w|mos?)`,
	String.raw`${MONTH}\s+${ORDINAL}`,
	String.raw`${ORDINAL}\s+${MONTH}`,
	String.raw`the\s+\d{1,2}(?:st|nd|rd|th)`,
	String.raw`\d{1,2}/\d{1,2}(?:/(?:\d{4}|\d{2}))?`,
].join('|');
/** A bare four-digit 19xx or 20xx reads as a year unless `at` comes first. */
const TIME = String.raw`noon|midnight|\d{1,2}(?::\d{2})?(?:\s*[ap]m|[ap])|\d{1,2}:\d{2}|(?<=\bat\s+)\d{4}|(?!(?:19|20)\d\d)\d{4}`;
/** Minutes and hours from now. A spelled-out unit needs `in`, since `study 2 hours` is a length, not a time. */
const MOMENT = String.raw`in\s+\d+(?:\s*${CLOCK_UNIT})?|\d+${CLOCK_UNIT}|\d+\s+(?:mins?|hrs?)`;
const DATE_TIME = String.raw`(?:(?:on\s+)?(?<date1>${DATE})(?:\s+(?:at\s+)?(?<time1>${TIME}))?|(?:at\s+)?(?<time2>${TIME})(?:\s+(?:on\s+)?(?<date2>${DATE}))?|(?<moment>${MOMENT}))`;

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
		String.raw`\b(?:tom|sun|sat|wed|daily|weekdays|weekly|monthly|yearly)\b(?=\s+(?!(?:${PHRASE_WORDS})\b)[a-z]+(?![\w'’]))`,
		'gi',
	),
	new RegExp(String.raw`(?<=\b(?:${ADDRESS})\.?\s+)\d[\w:/]*`, 'gi'),
	new RegExp(String.raw`(?<!\w)\d[\w:/]*(?=\s+(?:[\w.]+\s+)?(?:${STREET})\b)`, 'gi'),
];

function maskGuarded(input: string): string {
	return GUARDS.reduce((text, guard) => text.replace(guard, m => '_'.repeat(m.length)), input);
}

type Context = { now: Date; today: DateKey; time: TimeOfDay };

/** A due phrase. A null date means only a time was typed. */
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
	| { kind: 'label'; labelId: string }
	| { kind: 'reminder'; reminder: ReminderDraft };

type Rule = {
	kind: TokenKind;
	pattern: RegExp;
	repeatable: boolean;
	/** Runs on the input with `GUARDS` masked out. */
	guarded: boolean;
	read: (m: RegExpExecArray, ctx: Context) => Match | null;
};

type DurationUnit = 'minute' | 'hour' | RecurrenceUnit;

const UNIT_LETTERS: Record<string, DurationUnit> = { m: 'minute', h: 'hour', d: 'day', w: 'week', y: 'year' };
const UNIT_MINUTES: Partial<Record<DurationUnit, number>> = { minute: 1, hour: 60, day: 1440, week: 10_080 };

function unitOf(text: string): DurationUnit | null {
	const t = text.toLowerCase();
	return t.startsWith('mo') ? 'month' : (UNIT_LETTERS[t[0] ?? ''] ?? null);
}

function resolveTime(text: string): TimeOfDay | null {
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
	const candidate = new Date(year, month, day);
	return month >= 0 && candidate.getDate() === day ? toDateKey(candidate) : null;
}

/** A month and day without a year means the next one, counting today. */
function monthDay(today: DateKey, month: number, day: number, yearText?: string): DateKey | null {
	if (yearText) return calendarDate(yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText), month, day);
	const year = Number(today.slice(0, 4));
	const key = calendarDate(year, month, day);
	if (!key) return null;
	return key < today ? calendarDate(year + 1, month, day) : key;
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

const DATE_READERS: Array<[RegExp, (m: RegExpExecArray, today: DateKey) => DateKey | null]> = [
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
		/^the (\d{1,2})(?:st|nd|rd|th)$/,
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
	[/^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?$/, (m, today) => monthDay(today, monthIndex(m[1]!), Number(m[2]))],
	[/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)$/, (m, today) => monthDay(today, monthIndex(m[2]!), Number(m[1]))],
];

function resolveDate(text: string, today: DateKey): Day | null {
	const t = text.toLowerCase().replaceAll(/\s+/g, ' ').trim();
	const word = DAY_WORDS[t];
	if (word) return word(today);
	for (const [pattern, read] of DATE_READERS) {
		const m = pattern.exec(t);
		const date = m && read(m, today);
		if (date) return { date, time: null };
	}
	return null;
}

function resolveMoment(text: string, now: Date): DuePhrase | null {
	const m = /^(?:in\s+)?(\d+)\s*([a-z]*)$/i.exec(text);
	if (!m) return null;
	const unit = m[2] ? unitOf(m[2]) : 'minute';
	if (unit !== 'minute' && unit !== 'hour') return null;
	const at = new Date(now.getTime() + Number(m[1]) * UNIT_MINUTES[unit]! * 60_000);
	return { date: toDateKey(at), time: toTimeOfDay(at.getHours(), at.getMinutes()) };
}

function readDateTime(groups: Record<string, string | undefined>, ctx: Context): DuePhrase | null {
	if (groups.moment) return resolveMoment(groups.moment, ctx.now);
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
			String.raw`${BEFORE}(?:(?:every|each)\s+(?:(?<other>other)\s+(?<otherUnit>day|week|month|year)|(?<interval>\d+)\s*(?<intervalUnit>${DAY_UNIT})|(?<unit>day|week|month|year)|(?<workday>weekday|workday)|(?<weekday>${WEEKDAY}))|(?<adverb>daily|weekdays|weekly|monthly|yearly|annually))${AFTER}`,
			'gi',
		),
		read: (m, ctx) => {
			const { other, otherUnit, interval, intervalUnit, unit, workday, weekday, adverb } = m.groups ?? {};
			const unitText = otherUnit ?? intervalUnit ?? unit;
			const recurrence: Recurrence | null = workday
				? { interval: 1, unit: 'weekday' }
				: weekday
					? { interval: 1, unit: 'week' }
					: adverb
						? { interval: 1, unit: RECURRENCE_ADVERBS[adverb.toLowerCase()]! }
						: unitText
							? { interval: other ? 2 : Number(interval ?? 1), unit: unitOf(unitText) as RecurrenceUnit }
							: null;
			if (!recurrence || recurrence.interval < 1) return null;
			const anchor = weekday
				? nextWeekday(ctx.today, weekdayIndex(weekday.toLowerCase()))
				: recurrence.unit === 'weekday' && !isWeekday(ctx.today)
					? nextWeekday(ctx.today, 1)
					: null;
			return { kind: 'recurrence', recurrence: { recurrence, anchor } };
		},
	},
	{
		kind: 'priority',
		repeatable: false,
		guarded: true,
		pattern: new RegExp(String.raw`(?<![\w#@])p([1-4])(?!\w)|(?<!\S)(!!!?)(?!\S)|(?<![\w#@])(urgent|important)\b`, 'gi'),
		read: m => {
			const [, level, bangs, word] = m;
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

const escapeRegExp = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/**
 * `#Name` or `@Name` for a name that exists, at the start of the text or after whitespace, so `a@b.com`
 * never matches. The name must end the word, so `@home.com` and `@homework` do not read as `@home`.
 */
function namedRule(
	kind: 'project' | 'label',
	sigil: '#' | '@',
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
 * A typed date wins. A time alone lands on the date set outside the text, or else on the first
 * future occurrence: today, or tomorrow once that time has passed. A repeat without a typed date
 * starts on its weekday, the date set outside the text, or today, and moves one interval on when
 * its time has passed today.
 */
function resolveDue(
	phrase: DuePhrase | null,
	repeat: RecurrencePhrase | null,
	outside: Due | null,
	ctx: Context,
): Due | null {
	if (phrase?.date) return { date: phrase.date, time: phrase.time };
	const time = phrase?.time ?? null;
	const passed = (date: DateKey) => time !== null && date === ctx.today && time < ctx.time;
	if (repeat) {
		if (!repeat.anchor && outside) return { date: outside.date, time: time ?? outside.time };
		const date = repeat.anchor ?? ctx.today;
		const { interval, unit } = repeat.recurrence;
		return { date: passed(date) ? addInterval(date, interval, unit) : date, time };
	}
	if (!time) return null;
	if (outside) return { date: outside.date, time };
	return { date: passed(ctx.today) ? addDays(ctx.today, 1) : ctx.today, time };
}

function resolveReminder(draft: ReminderDraft, due: Due | null, ctx: Context): Reminder {
	if (draft.kind === 'before') return draft;
	const time = draft.time ?? toTimeOfDay(9, 0);
	const fallback = draft.time && draft.time < ctx.time ? addDays(ctx.today, 1) : ctx.today;
	return { kind: 'at', date: draft.date ?? due?.date ?? fallback, time };
}

export function parseQuickAdd(input: string, options: ParseOptions): ParsedQuickAdd {
	const now = options.now;
	const ctx: Context = { now, today: toDateKey(now), time: toTimeOfDay(now.getHours(), now.getMinutes()) };
	const disabled = new Set(options.disabled?.map(d => d.toLowerCase()));
	const named = [
		namedRule('project', '#', options.projects ?? [], projectId => ({ kind: 'project', projectId })),
		namedRule('label', '@', options.labels ?? [], labelId => ({ kind: 'label', labelId })),
	].filter(rule => rule !== null);
	const rules = [...RULES.slice(0, 2), ...named, ...RULES.slice(2)];
	// Every phrase a rule recognizes is masked out of both views, including kept-as-text and
	// superseded ones, so a later rule never reads part of it as something else.
	let raw = input;
	let guarded = maskGuarded(input);
	const claim = (text: string, start: number, end: number) =>
		text.slice(0, start) + '_'.repeat(end - start) + text.slice(end);

	const tokens: QuickAddToken[] = [];
	const matches: Match[] = [];
	for (const rule of rules) {
		const found: Array<{ token: QuickAddToken; match: Match }> = [];
		const spans: Array<[number, number]> = [];
		for (const m of (rule.guarded ? guarded : raw).matchAll(rule.pattern)) {
			const start = m.index;
			const end = start + m[0].length;
			const text = input.slice(start, end);
			const match = rule.read(m, ctx);
			if (!match) continue;
			spans.push([start, end]);
			if (!disabled.has(text.toLowerCase())) found.push({ token: { kind: rule.kind, start, end, text }, match });
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
	}
	tokens.sort((a, b) => a.start - b.start);

	let duePhrase: DuePhrase | null = null;
	let repeat: RecurrencePhrase | null = null;
	let priority: Priority | null = null;
	let projectId: string | null = null;
	const labelIds = new Set<string>();
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
			case 'label':
				labelIds.add(match.labelId);
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

	let title = '';
	let cursor = 0;
	for (const token of tokens) {
		title += `${input.slice(cursor, token.start)} `;
		cursor = token.end;
	}
	title = (title + input.slice(cursor)).replaceAll(/\s+/g, ' ').trim();

	const outside = options.due ?? null;
	const due = resolveDue(duePhrase, repeat, outside, ctx);
	return {
		title,
		due,
		recurrence: repeat?.recurrence ?? null,
		priority,
		reminders: reminderDrafts.map(draft => resolveReminder(draft, due ?? outside, ctx)),
		projectId,
		labelIds: [...labelIds],
		tokens,
	};
}
