import {
	addDays,
	fromDateKey,
	toDateKey,
	toTimeOfDay,
	type DateKey,
	type Due,
	type Priority,
	type Project,
	type Reminder,
	type TimeOfDay,
} from './task.ts';

export type TokenKind = 'due' | 'priority' | 'reminder' | 'project';

export type QuickAddToken = { kind: TokenKind; start: number; end: number; text: string };

export type ParsedQuickAdd = {
	title: string;
	due: Due | null;
	priority: Priority | null;
	reminders: Reminder[];
	projectId: string | null;
	tokens: QuickAddToken[];
};

export type ParseOptions = {
	now: Date;
	projects?: readonly Project[];
	/** Token texts the user chose to keep as plain title text, compared case-insensitively. */
	disabled?: readonly string[];
};

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

const WEEKDAY = String.raw`(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)`;
const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const ORDINAL = String.raw`\d{1,2}(?:st|nd|rd|th)?`;
const DATE = String.raw`(?:today|tonight|tomorrow|tmrw?|next week|(?:next\s+)?${WEEKDAY}|in\s+\d+\s+(?:days?|weeks?)|${MONTH}\s+${ORDINAL}|${ORDINAL}\s+${MONTH})`;
const TIME = String.raw`(?:noon|midnight|\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})`;
const ON_DATE = String.raw`(?:on\s+)?(${DATE})`;
const AT_TIME = String.raw`(?:at\s+)?(${TIME})`;
/** Captures: 1 date, 2 time, 3 time, 4 date. */
const DATE_TIME = String.raw`(?:${ON_DATE}(?:\s+${AT_TIME})?|${AT_TIME}(?:\s+${ON_DATE})?)`;
const DURATION_UNIT = String.raw`(m|mins?|minutes?|h|hrs?|hours?|d|days?)`;

const BEFORE = '(?<![\\w#!])';
const AFTER = '(?![\\w!])';

type Context = { today: DateKey };

type Match =
	| { kind: 'due'; due: Due }
	| { kind: 'priority'; priority: Priority }
	| { kind: 'project'; projectId: string }
	| { kind: 'reminder'; reminder: ReminderDraft };

/** An absolute reminder may omit its date or time until the task's due date is known. */
type ReminderDraft = { kind: 'before'; minutes: number } | { kind: 'at'; date: DateKey | null; time: TimeOfDay | null };

type Rule = {
	kind: TokenKind;
	pattern: RegExp;
	repeatable: boolean;
	read: (m: RegExpExecArray, ctx: Context) => Match | null;
};

const UNIT_MINUTES: Record<string, number> = { m: 1, h: 60, d: 1440 };

function resolveTime(text: string): TimeOfDay | null {
	const t = text.toLowerCase().replaceAll(/\s+/g, '');
	if (t === 'noon') return toTimeOfDay(12, 0);
	if (t === 'midnight') return toTimeOfDay(0, 0);
	const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(t);
	if (!m) return null;
	let hours = Number(m[1]);
	const minutes = Number(m[2] ?? 0);
	const meridiem = m[3];
	if (minutes > 59) return null;
	if (meridiem) {
		if (hours < 1 || hours > 12) return null;
		hours = (hours % 12) + (meridiem === 'pm' ? 12 : 0);
	} else if (hours > 23) {
		return null;
	}
	return toTimeOfDay(hours, minutes);
}

function weekdayIndex(text: string): number {
	return WEEKDAYS.indexOf(text.slice(0, 3) as (typeof WEEKDAYS)[number]);
}

function resolveDate(text: string, today: DateKey): DateKey | null {
	const t = text.toLowerCase().replaceAll(/\s+/g, ' ').trim();
	if (t === 'today' || t === 'tonight') return today;
	if (t === 'tomorrow' || t === 'tmr' || t === 'tmrw') return addDays(today, 1);

	const todayIndex = fromDateKey(today).getDay();
	const daysToNextMonday = (8 - todayIndex) % 7 || 7;
	if (t === 'next week') return addDays(today, daysToNextMonday);

	const next = /^next (\w+)$/.exec(t);
	if (next) {
		const target = weekdayIndex(next[1]!);
		return addDays(today, daysToNextMonday + ((target + 6) % 7));
	}
	if (weekdayIndex(t) !== -1) return addDays(today, (weekdayIndex(t) - todayIndex + 7) % 7);

	const inN = /^in (\d+) (day|week)s?$/.exec(t);
	if (inN) return addDays(today, Number(inN[1]) * (inN[2] === 'week' ? 7 : 1));

	const monthFirst = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?$/.exec(t);
	const dayFirst = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)$/.exec(t);
	const monthText = monthFirst?.[1] ?? dayFirst?.[2];
	const dayText = monthFirst?.[2] ?? dayFirst?.[1];
	if (monthText && dayText) {
		const month = MONTHS.indexOf(monthText.slice(0, 3) as (typeof MONTHS)[number]);
		const day = Number(dayText);
		const year = Number(today.slice(0, 4));
		const candidate = new Date(year, month, day);
		if (candidate.getMonth() !== month) return null;
		const key = toDateKey(candidate);
		return key < today ? toDateKey(new Date(year + 1, month, day)) : key;
	}
	return null;
}

function readDateTime(dateText: string | undefined, timeText: string | undefined, ctx: Context): Due | null {
	const date = dateText ? resolveDate(dateText, ctx.today) : ctx.today;
	const time = timeText ? resolveTime(timeText) : null;
	if (!date || (timeText && !time)) return null;
	if (!timeText && dateText?.toLowerCase() === 'tonight') return { date, time: toTimeOfDay(20, 0) };
	return { date, time };
}

const PRIORITY_WORDS: Record<string, Priority> = { '!!!': 1, urgent: 1, '!!': 2, important: 2 };

/** Ordered by precedence: an earlier rule claims its text before later rules can. */
const RULES: Rule[] = [
	{
		kind: 'reminder',
		repeatable: true,
		pattern: new RegExp(
			String.raw`${BEFORE}remind(?:\s+me)?\s+(?:(\d+)\s*${DURATION_UNIT}\s+before|${DATE_TIME})${AFTER}`,
			'gi',
		),
		read: (m, ctx) => {
			const [, amount, unit, date1, time1, time2, date2] = m;
			if (amount && unit) {
				const minutes = Number(amount) * UNIT_MINUTES[unit[0]!.toLowerCase()]!;
				return { kind: 'reminder', reminder: { kind: 'before', minutes } };
			}
			const dateText = date1 ?? date2;
			const timeText = time1 ?? time2;
			const date = dateText ? resolveDate(dateText, ctx.today) : null;
			const time = timeText ? resolveTime(timeText) : null;
			if ((dateText && !date) || (timeText && !time)) return null;
			return { kind: 'reminder', reminder: { kind: 'at', date, time } };
		},
	},
	{
		kind: 'priority',
		repeatable: false,
		pattern: new RegExp(String.raw`(?<![\w#])p([1-4])(?!\w)|(?<!\S)(!!!?)(?!\S)|\b(urgent|important)\b`, 'gi'),
		read: m => {
			const [, level, bangs, word] = m;
			const priority = level ? (Number(level) as Priority) : PRIORITY_WORDS[(bangs ?? word)!.toLowerCase()];
			return priority ? { kind: 'priority', priority } : null;
		},
	},
	{
		kind: 'due',
		repeatable: false,
		pattern: new RegExp(`${BEFORE}${DATE_TIME}${AFTER}`, 'gi'),
		read: (m, ctx) => {
			const [, date1, time1, time2, date2] = m;
			const due = readDateTime(date1 ?? date2, time1 ?? time2, ctx);
			return due ? { kind: 'due', due } : null;
		},
	},
];

const escapeRegExp = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

function projectRule(projects: readonly Project[]): Rule | null {
	if (projects.length === 0) return null;
	const byName = new Map(projects.map(p => [p.name.toLowerCase(), p.id]));
	const names = [...byName.keys()].toSorted((a, b) => b.length - a.length).map(escapeRegExp);
	return {
		kind: 'project',
		repeatable: false,
		pattern: new RegExp(String.raw`(?<!\S)#(${names.join('|')})(?!\w)`, 'gi'),
		read: m => {
			const projectId = byName.get(m[1]!.toLowerCase());
			return projectId ? { kind: 'project', projectId } : null;
		},
	};
}

function resolveReminder(draft: ReminderDraft, due: Due | null, today: DateKey): Reminder {
	if (draft.kind === 'before') return draft;
	return {
		kind: 'at',
		date: draft.date ?? due?.date ?? today,
		time: draft.time ?? toTimeOfDay(9, 0),
	};
}

export function parseQuickAdd(input: string, options: ParseOptions): ParsedQuickAdd {
	const ctx: Context = { today: toDateKey(options.now) };
	const disabled = new Set(options.disabled?.map(d => d.toLowerCase()));
	const project = projectRule(options.projects ?? []);
	const rules = project ? [RULES[0]!, project, ...RULES.slice(1)] : RULES;

	const tokens: QuickAddToken[] = [];
	const matches: Match[] = [];
	const overlaps = (start: number, end: number) => tokens.some(t => start < t.end && t.start < end);

	for (const rule of rules) {
		const found: Array<{ token: QuickAddToken; match: Match }> = [];
		for (const m of input.matchAll(rule.pattern)) {
			const start = m.index;
			const end = start + m[0].length;
			if (disabled.has(m[0].toLowerCase()) || overlaps(start, end)) continue;
			const match = rule.read(m, ctx);
			if (match) found.push({ token: { kind: rule.kind, start, end, text: m[0] }, match });
		}
		// Attributes usually trail the title, so a single-valued attribute takes its last phrase.
		for (const { token, match } of rule.repeatable ? found : found.slice(-1)) {
			tokens.push(token);
			matches.push(match);
		}
	}
	tokens.sort((a, b) => a.start - b.start);

	let due: Due | null = null;
	let priority: Priority | null = null;
	let projectId: string | null = null;
	const reminderDrafts: ReminderDraft[] = [];
	for (const match of matches) {
		switch (match.kind) {
			case 'due':
				due = match.due;
				break;
			case 'priority':
				priority = match.priority;
				break;
			case 'project':
				projectId = match.projectId;
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

	return {
		title,
		due,
		priority,
		reminders: reminderDrafts.map(draft => resolveReminder(draft, due, ctx.today)),
		projectId,
		tokens,
	};
}
