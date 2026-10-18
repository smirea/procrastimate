import { parseQuickAdd, type TokenKind } from './quick-add.ts';
import type { Due, Label, Priority, Project, Recurrence, Reminder } from './task.ts';

export type RambleTokenKind = TokenKind | 'separator' | 'subtask' | 'note' | 'correction' | 'end';

/** A recognized phrase, with UTF-16 offsets into the transcript, for tinting and provenance. */
export type RambleToken = { kind: RambleTokenKind; start: number; end: number; text: string };

export type RambleSpan = { start: number; end: number };

export type RambleTask = {
	segment: RambleSpan;
	title: string;
	notes: string;
	due: Due | null;
	recurrence: Recurrence | null;
	priority: Priority | null;
	reminders: Reminder[];
	/** Always null on a subtask, which takes its root's project. */
	projectId: string | null;
	labelIds: string[];
	subtasks: RambleTask[];
};

export type RambleDraft = {
	tasks: RambleTask[];
	tokens: RambleToken[];
	/** Stefan said `that's all` or `that's it` at the end, so listening stops. It never saves. */
	ended: boolean;
};

export type RambleOptions = { now: Date; projects?: readonly Project[]; labels?: readonly Label[] };

// ---------------------------------------------------------------------------------------------------
// Normalizing. Each rewrite keeps a map back to the transcript, so tokens and titles use its offsets
// and titles stay verbatim.

/** `starts[i]` is where normalized character `i` begins in the transcript; `ends[i]` is where a span ending at `i` ends. */
type Mapped = { text: string; starts: number[]; ends: number[] };

function identity(text: string): Mapped {
	const offsets = Array.from({ length: text.length + 1 }, (_, i) => i);
	return { text, starts: offsets, ends: [...offsets] };
}

function rewrite(source: Mapped, pattern: RegExp, replace: (m: RegExpExecArray) => string | null): Mapped {
	let text = '';
	const starts: number[] = [];
	const ends: number[] = [source.ends[0]!];
	let cursor = 0;
	const copy = (to: number) => {
		for (; cursor < to; cursor++) {
			text += source.text[cursor];
			starts.push(source.starts[cursor]!);
			ends.push(source.ends[cursor + 1]!);
		}
	};
	for (const m of source.text.matchAll(pattern)) {
		const replacement = replace(m);
		if (replacement === null || replacement === m[0]) continue;
		const start = m.index;
		const end = start + m[0].length;
		copy(start);
		for (let i = 0; i < replacement.length; i++) {
			text += replacement[i];
			starts.push(source.starts[start]!);
			ends.push(source.ends[end]!);
		}
		cursor = end;
	}
	copy(source.text.length);
	starts.push(source.starts[source.text.length]!);
	return { text, starts, ends };
}

const SMALL_NUMBERS = [
	'zero',
	'one',
	'two',
	'three',
	'four',
	'five',
	'six',
	'seven',
	'eight',
	'nine',
	'ten',
	'eleven',
	'twelve',
	'thirteen',
	'fourteen',
	'fifteen',
	'sixteen',
	'seventeen',
	'eighteen',
	'nineteen',
];
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90 };
const DIGIT_WORD = 'one|two|three|four|five|six|seven|eight|nine';
const NUMBER_WORD = String.raw`(?:(?:twenty|thirty|forty|fifty)(?:[\s-](?:${DIGIT_WORD}))?|${SMALL_NUMBERS.toReversed().join('|')}|sixty|ninety)`;
const HOUR_WORD = String.raw`(?:twelve|eleven|ten|${DIGIT_WORD})`;

function numberValue(text: string): number {
	const words = text.toLowerCase().split(/[\s-]+/);
	return words.reduce((sum, word) => sum + (TENS[word] ?? SMALL_NUMBERS.indexOf(word)), 0);
}

const ORDINAL_WORDS: Record<string, number> = {
	first: 1,
	second: 2,
	third: 3,
	fourth: 4,
	fifth: 5,
	sixth: 6,
	seventh: 7,
	eighth: 8,
	ninth: 9,
	tenth: 10,
	eleventh: 11,
	twelfth: 12,
	thirteenth: 13,
	fourteenth: 14,
	fifteenth: 15,
	sixteenth: 16,
	seventeenth: 17,
	eighteenth: 18,
	nineteenth: 19,
	twentieth: 20,
	thirtieth: 30,
};
const ORDINAL_WORD = String.raw`(?:(?:twenty|thirty)[\s-](?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|${Object.keys(ORDINAL_WORDS).join('|')})`;

function ordinalValue(text: string): number {
	const t = text.toLowerCase();
	if (/^\d/.test(t)) return Number.parseInt(t, 10);
	const words = t.split(/[\s-]+/);
	return words.length === 2 ? TENS[words[0]!]! + ORDINAL_WORDS[words[1]!]! : ORDINAL_WORDS[t]!;
}

function ordinal(n: number): string {
	const suffix =
		n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
	return `${n}${suffix}`;
}

const DAY_NAME = '(?:mon|tues|wednes|thurs|fri|satur|sun)day';
const MONTH_NAME = '(?:january|february|march|april|may|june|july|august|september|sept|october|november|december)';
const HOUR = `(?:\\d{1,2}|${HOUR_WORD})`;
const MERIDIEM_AHEAD = String.raw`(?=\s*[ap]\.?\s?m\b)`;
const UNIT_WORD = String.raw`(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)`;
const PRIORITY_LEVELS: Record<string, Priority> = {
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	won: 1,
	to: 2,
	too: 2,
	for: 4,
	fore: 4,
	'1': 1,
	'2': 2,
	'3': 3,
	'4': 4,
};
const SEPARATOR = String.raw`(?:next|new|another)\s+task|next\s+one|and\s+another\s+thing`;

const TIME = String.raw`(?:\d{1,2}(?::\d{2})?[ap]m|noon|midnight)`;
const WHEN = String.raw`(?:(?:on|at|by|for|due)\s+)?(?:(?:every|each)\s+)?(?:today|tomorrow|tonight|eod|eow|next\s+(?:week|month|${DAY_NAME})|${DAY_NAME}(?:\s+and\s+${DAY_NAME})?|(?:the\s+)?\d{1,2}(?:st|nd|rd|th)|${MONTH_NAME}\s+\d{1,2}(?:st|nd|rd|th)?|\d{1,2}(?::\d{2})?[ap]m|noon|midnight|in\s+\d+\s+${UNIT_WORD})(?:\s+(?:at\s+)?(?:\d{1,2}(?::\d{2})?[ap]m|noon|midnight))?`;
const PRIORITY_WORDS = String.raw`(?:priority\s+[1-4]|p[1-4])`;
const CORRECTED = String.raw`\s*,?\s*(?:actually|no\s+wait|wait|sorry|no|i\s+mean|i\s+meant|scratch\s+that|or\s+rather|rather)\s*,?\s*(?:(?:make|change)\s+(?:that|it)(?:\s+to)?\s+|let's\s+(?:say|do)\s+)?`;

const hourValue = (text: string) => (/^\d/.test(text) ? Number(text) : numberValue(text));

/** Ordered: each rewrite reads the output of the ones before it. */
const REWRITES: Array<[RegExp, (m: RegExpExecArray) => string | null]> = [
	[/[’‘]/g, () => "'"],
	[/\bthe day after tomorrow\b/gi, () => 'in 2 days'],
	[/\b(?:(?:at|by)\s+)?(?:the\s+)?end of (?:the )?day\b/gi, () => 'eod'],
	[/\b(?:(?:at|by)\s+)?(?:the\s+)?end of (?:the )?week\b/gi, () => 'eow'],
	[/\bthis (?:morning|afternoon)\b/gi, () => 'today'],
	[/\bthis evening\b/gi, () => 'tonight'],
	[
		new RegExp(String.raw`\b(today|tomorrow|${DAY_NAME})\s+(morning|afternoon|evening|night)\b`, 'gi'),
		m => (/^[A-Z]/.test(m[2]!) ? null : m[1]!),
	],
	[new RegExp(String.raw`\b(?:this\s+(?:coming\s+)?|coming\s+)(${DAY_NAME})\b`, 'gi'), m => m[1]!],
	[
		new RegExp(String.raw`\b(half past|quarter past|quarter to)\s+(${HOUR})\b${MERIDIEM_AHEAD}`, 'gi'),
		m => {
			const hour = hourValue(m[2]!);
			if (hour < 1 || hour > 12) return null;
			const phrase = m[1]!.toLowerCase();
			if (phrase === 'quarter to') return `${hour === 1 ? 12 : hour - 1}:45`;
			return `${hour}:${phrase === 'half past' ? '30' : '15'}`;
		},
	],
	[
		new RegExp(String.raw`\b(${HOUR_WORD})(?:\s+(oh\s+(?:${DIGIT_WORD})|${NUMBER_WORD}))?\b${MERIDIEM_AHEAD}`, 'gi'),
		m => {
			const hour = numberValue(m[1]!);
			if (!m[2]) return String(hour);
			const minutes = numberValue(m[2].replace(/^oh\s+/i, ''));
			return minutes < 60 ? `${hour}:${String(minutes).padStart(2, '0')}` : null;
		},
	],
	[
		/\b(\d{1,2}(?::\d{2})?)\s*([ap])(?:\.\s?m\.?|\s?m\b)/gi,
		m => {
			const rest = m.input.slice(m.index + m[0].length);
			const period = m[0].endsWith('.') && /^(?:\s+[A-Z]|\s*$)/.test(rest) ? '.' : '';
			return `${m[1]}${m[2]!.toLowerCase()}m${period}`;
		},
	],
	[/\bhalf an? hour\b/gi, () => '30 minutes'],
	[new RegExp(String.raw`\b(${NUMBER_WORD})(?=[\s-]+${UNIT_WORD}\b)`, 'gi'), m => String(numberValue(m[1]!))],
	[/(?<=\bin\s+)an?(?=\s+(?:minute|hour|day|week|month|year)\b)/gi, () => '1'],
	[/\ban?(?=\s+(?:minute|hour|day|week)\s+before\b)/gi, () => '1'],
	[
		new RegExp(String.raw`\b(${MONTH_NAME})\s+(?:the\s+)?(${ORDINAL_WORD}|\d{1,2}(?:st|nd|rd|th)?)\b`, 'gi'),
		m => `${m[1]} ${/^\d+$/.test(m[2]!) ? m[2] : ordinal(ordinalValue(m[2]!))}`,
	],
	[
		new RegExp(String.raw`\b(?:the\s+)?(${ORDINAL_WORD}|\d{1,2}(?:st|nd|rd|th))\s+of\s+(${MONTH_NAME})\b`, 'gi'),
		m => `${ordinal(ordinalValue(m[1]!))} ${m[2]}`,
	],
	[new RegExp(String.raw`(?<=\bthe\s+)(${ORDINAL_WORD})\b`, 'gi'), m => ordinal(ordinalValue(m[1]!))],
	[
		new RegExp(
			String.raw`(?<=\b(?:today|tomorrow|tonight|${DAY_NAME}|\d(?:st|nd|rd|th)?))\s*,(?=\s+(?:at\s+)?(?:\d{1,2}(?::\d{2})?[ap]m\b|noon\b|midnight\b|\d{1,2}:\d{2}\b))`,
			'gi',
		),
		() => '',
	],
	[
		/\bpriority\s+(?:number\s+|level\s+)?(one|two|three|four|[1-4])\b(?![.:,]?\d)/gi,
		m => `p${PRIORITY_LEVELS[m[1]!.toLowerCase()]}`,
	],
	// Homophones only directly after `priority` and at the end of a clause, so `priority to finish` stays text.
	[
		new RegExp(String.raw`\bpriority\s+(won|to|too|for|fore)\b(?=\s*(?:[.,;!?]|$|(?:${SEPARATOR})\b))`, 'gi'),
		m => `p${PRIORITY_LEVELS[m[1]!.toLowerCase()]}`,
	],
	[
		/\b(?:pee\s+(?:one|two|three|four|[1-4])|p\s+(?:one|two|three|four)|p-[1-4])\b/gi,
		m => `p${PRIORITY_LEVELS[m[0].split(/[\s-]+/)[1]!.toLowerCase()]}`,
	],
	// A spoken correction keeps only the phrase it switches to: `Thursday, actually make that Friday` becomes `Friday`.
	[new RegExp(String.raw`\b(?:at\s+)?${TIME}${CORRECTED}(?:at\s+)?(${TIME})(?![\w:])`, 'gi'), m => `at ${m[1]}`],
	[new RegExp(String.raw`\b${WHEN}${CORRECTED}(${WHEN})\b`, 'gi'), m => m[1]!],
	[new RegExp(String.raw`\b${PRIORITY_WORDS}${CORRECTED}(${PRIORITY_WORDS})\b`, 'gi'), m => m[1]!],
];

function normalize(transcript: string): Mapped {
	return REWRITES.reduce((text, [pattern, replace]) => rewrite(text, pattern, replace), identity(transcript));
}

type Range = { start: number; end: number };
type FieldToken = Range & { kind: TokenKind };

type Attributes = {
	tokens: FieldToken[];
	projectId: string | null;
	labelIds: string[];
	priority: Priority | null;
	due: Due | null;
	recurrence: Recurrence | null;
	reminders: Reminder[];
};

const escapeRegExp = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/** Case-insensitive, ignoring punctuation and a trailing plural or possessive `s`. */
const nameKey = (name: string) =>
	name
		.toLowerCase()
		.replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
		.replace(/(?<=\w) ?'?s$/, '');

function namePattern(names: readonly string[]): string {
	const alternatives = names
		.toSorted((a, b) => b.length - a.length)
		.map(name =>
			name
				.split(/[^\p{L}\p{N}]+/u)
				.filter(Boolean)
				.map(escapeRegExp)
				.join(String.raw`[^\p{L}\p{N}]*`),
		);
	return String.raw`(?:${alternatives.join('|')})(?:'?s)?`;
}

type Named = { pattern: RegExp; ids: Map<string, string> };

function projectMatcher(projects: readonly Project[]): Named | null {
	if (!projects.length) return null;
	const name = namePattern(projects.map(p => p.name));
	const projectNamed = projects.filter(p => /\bproject$/i.test(p.name));
	const lead = String.raw`(?:(?:add|put|move)\s+(?:it|this|that)\s+(?:to|in|into|under)\s+|(?:in|to|for|under|into)\s+)`;
	const alternatives = [
		String.raw`\b${lead}?(?:the\s+|my\s+|our\s+)?(?<a>${name})\s+project\b`,
		String.raw`\b(?:in\s+(?:the\s+)?)?project\s+(?<b>${name})(?![\p{L}\p{N}])`,
	];
	if (projectNamed.length) {
		alternatives.push(
			String.raw`\b${lead}(?:the\s+|my\s+|our\s+)?(?<c>${namePattern(projectNamed.map(p => p.name))})(?![\p{L}\p{N}])`,
		);
	}
	return {
		pattern: new RegExp(alternatives.join('|'), 'giu'),
		ids: new Map(projects.map(p => [nameKey(p.name), p.id])),
	};
}

function labelMatchers(
	labels: readonly Label[],
): { lead: RegExp; more: RegExp; suffix: RegExp; ids: Map<string, string> } | null {
	if (!labels.length) return null;
	const name = namePattern(labels.map(l => l.name));
	return {
		lead: new RegExp(
			String.raw`\b(?:labels?|tag(?:ged)?(?:\s+it)?(?:\s+(?:with|as))?)\s+(?<name>${name})(?![\p{L}\p{N}])`,
			'giu',
		),
		more: new RegExp(String.raw`^(?:\s*,\s*(?:and\s+)?|\s+and\s+)(?<name>${name})(?![\p{L}\p{N}])`, 'iu'),
		suffix: new RegExp(String.raw`\b(?:(?:with|and)\s+)?(?:the\s+|a\s+)?(?<name>${name})\s+(?:label|tag)\b`, 'giu'),
		ids: new Map(labels.map(l => [nameKey(l.name), l.id])),
	};
}

type Grammar = { now: Date; project: Named | null; labels: ReturnType<typeof labelMatchers> };

/** Reads `text`, a slice of the normalized transcript starting at `base`, where `;` masks text that is not this task's. */
function readAttributes(text: string, base: number, grammar: Grammar, allowProject: boolean): Attributes {
	let work = text;
	const tokens: FieldToken[] = [];
	const claim = (start: number, end: number) => {
		work = work.slice(0, start) + ' '.repeat(end - start) + work.slice(end);
	};
	const add = (kind: TokenKind, start: number, end: number) =>
		tokens.push({ kind, start: base + start, end: base + end });

	let projectId: string | null = null;
	if (allowProject && grammar.project) {
		const found = [...work.matchAll(grammar.project.pattern)];
		const last = found.at(-1);
		if (last) {
			const groups = last.groups ?? {};
			projectId = grammar.project.ids.get(nameKey(groups.a ?? groups.b ?? groups.c ?? '')) ?? null;
			add('project', last.index, last.index + last[0].length);
		}
		for (const m of found) claim(m.index, m.index + m[0].length);
	}

	const labelHits: Array<{ at: number; id: string }> = [];
	const labels = grammar.labels;
	if (labels) {
		const take = (m: RegExpMatchArray, start: number, end: number) => {
			const id = labels.ids.get(nameKey(m.groups!.name!));
			if (!id) return;
			labelHits.push({ at: start, id });
			add('label', start, end);
			claim(start, end);
		};
		// Snapshot first: `take` rewrites `work`, so a live matchAll would skip or shift.
		const leads = Array.from(work.matchAll(labels.lead));
		for (const m of leads) {
			let end = m.index + m[0].length;
			take(m, m.index, end);
			for (let next = labels.more.exec(work.slice(end)); next; next = labels.more.exec(work.slice(end))) {
				take(next, end, end + next[0].length);
				end += next[0].length;
			}
		}
		for (const m of Array.from(work.matchAll(labels.suffix))) take(m, m.index, m.index + m[0].length);
	}

	const parsed = parseQuickAdd(work, { now: grammar.now, spoken: true });
	for (const token of parsed.tokens) add(token.kind, token.start, token.end);

	return {
		tokens: tokens.toSorted((a, b) => a.start - b.start),
		projectId,
		labelIds: [...new Set(labelHits.toSorted((a, b) => a.at - b.at).map(hit => hit.id))],
		priority: parsed.priority,
		due: parsed.due,
		recurrence: parsed.recurrence,
		reminders: parsed.reminders,
	};
}

const INTENT = String.raw`(?:(?:i|we)\s+(?:also\s+|still\s+|really\s+|definitely\s+|probably\s+)*(?:(?:need|have|want|got|ought)\s+to|'ve\s+got\s+to|gotta|should|must|will|'ll|'d\s+like\s+to|would\s+like\s+to|am\s+going\s+to|'m\s+going\s+to)(?:\s+(?:probably|really|also|still|definitely))?|i'll|we'll|(?:also\s+)?(?:need|have|got)\s+to|gotta|don't\s+forget\s+to|do\s+not\s+forget\s+to|remember\s+to|remind\s+me\s+to|make\s+sure\s+(?:to|i|we)|let's|let\s+me|please)`;
const FILLER = String.raw`(?:let's\s+see|let\s+me\s+(?:think|see)|hmm+|and|also|then|so|oh|hey|plus|okay|ok|um|uh|er|well|actually|wait|sorry|alright|anyway|maybe|probably|possibly)`;
const LEADING_JOINERS = new RegExp(
	String.raw`^(?:(?:${FILLER}|${INTENT})\b|(?:first|firstly|second|secondly|next|lastly|finally)\s*,)[\s,]*`,
	'i',
);
const TRAILING_JOINERS = /[\s,]*\b(?:and|also|then|so|please|as well)$/i;
const LEFTOVER_ONLY = /^(?:make it|set it|it's|it is|it|that's|that is|that|this|which is|do it|is|and|the|for it)$/i;
const BEFORE_DATE =
	/(?:\b(?:(?:it's|it\s+is|is|are|'s|it)\s+)?due|\bby|\bon|\bat|\bfor|\bstarting|\bbeginning|,?\s*\b(?:it's|it\s+is|which\s+is|that's)|,\s*(?:[\w']+\s+){1,4}(?:is|are))\s*$/i;

function cleanTitle(text: string): string {
	let title = text.replaceAll(/\s+/g, ' ').replaceAll(/ (?=[,;:.!?])/g, '');
	for (let previous = ''; previous !== title;) {
		previous = title;
		title = title.replace(/^[\s,;:.!?—–-]+/, '').replace(/[\s,;:.!?—–-]+$/, '');
		title = title.replace(/^(?:this|next)\s+week\s+(?=(?:i|we)\b)/i, '');
		title = title.replace(/^(?:i|we)'ve\s+got\s+(?:a|an)\s+/i, '');
		title = title.replace(LEADING_JOINERS, '').replace(TRAILING_JOINERS, '');
	}
	if (LEFTOVER_ONLY.test(title)) return '';
	return title.charAt(0).toUpperCase() + title.slice(1);
}

/** The pieces' text minus every token, read from the transcript so titles stay verbatim. */
function buildTitle(
	transcript: string,
	mapped: Mapped,
	pieces: readonly Range[],
	tokens: readonly FieldToken[],
	omit: readonly Range[] = [],
): string {
	const parts: string[] = [];
	for (const piece of pieces) {
		let cursor = piece.start;
		const inside = [
			...tokens
				.filter(t => t.start >= piece.start && t.end <= piece.end)
				.map(t => ({ start: t.start, end: t.end, beforeDate: ['due', 'recurrence', 'reminder'].includes(t.kind) })),
			...omit
				.filter(r => r.end > piece.start && r.start < piece.end)
				.map(r => ({ start: r.start, end: r.end, beforeDate: false })),
		].toSorted((a, b) => a.start - b.start || a.end - b.end);
		const gaps: Array<Range & { beforeDate: boolean }> = [];
		for (const token of inside) {
			if (token.end <= cursor) continue;
			gaps.push({ start: cursor, end: Math.max(cursor, token.start), beforeDate: token.beforeDate });
			cursor = Math.max(cursor, token.end);
		}
		gaps.push({ start: cursor, end: piece.end, beforeDate: false });
		for (const gap of gaps) {
			let end = gap.end;
			if (gap.beforeDate) {
				for (
					let m = BEFORE_DATE.exec(mapped.text.slice(gap.start, end));
					m;
					m = BEFORE_DATE.exec(mapped.text.slice(gap.start, end))
				) {
					end = gap.start + m.index;
				}
			}
			if (end <= gap.start) continue;
			parts.push(transcript.slice(mapped.starts[gap.start], mapped.ends[end]));
		}
	}
	return cleanTitle(parts.join(' '));
}

const VERBS = [
	'call',
	'text',
	'email',
	'e-mail',
	'phone',
	'ping',
	'message',
	'dm',
	'buy',
	'get',
	'pick',
	'grab',
	'order',
	'book',
	'schedule',
	'reschedule',
	'pay',
	'send',
	'write',
	'finish',
	'fix',
	'clean',
	'wash',
	'water',
	'walk',
	'feed',
	'renew',
	'cancel',
	'return',
	'mail',
	'file',
	'submit',
	'review',
	'read',
	'check',
	'update',
	'prepare',
	'prep',
	'plan',
	'organize',
	'set',
	'make',
	'take',
	'bring',
	'drop',
	'ask',
	'tell',
	'meet',
	'visit',
	'go',
	'start',
	'research',
	'sort',
	'print',
	'sign',
	'cook',
	'bake',
	'install',
	'replace',
	'repair',
	'paint',
	'move',
	'hang',
	'vacuum',
	'mow',
	'change',
	'charge',
	'refill',
	'follow',
	'reply',
	'respond',
	'contact',
	'invite',
	'thank',
	'confirm',
	'register',
	'apply',
	'practice',
	'study',
	'learn',
	'try',
	'look',
	'find',
	'figure',
	'think',
	'talk',
	'post',
	'upload',
	'download',
	'record',
	'publish',
	'deploy',
	'test',
	'draft',
	'edit',
	'pack',
	'unpack',
	'ship',
	'donate',
	'sell',
	'list',
	'clear',
	'empty',
	'take',
	'put',
	'collect',
	'deposit',
	'transfer',
	'withdraw',
	'backup',
	'back',
	'upgrade',
	'download',
	'see',
	'watch',
	'listen',
	'pray',
	'exercise',
	'run',
	'stretch',
	'shop',
	'wrap',
	'decorate',
	'tidy',
	'declutter',
	'iron',
	'fold',
	'sweep',
	'mop',
	'dust',
	'scrub',
	'trim',
	'cut',
	'shave',
	'floss',
	'compare',
	'do',
	'hire',
	'rent',
	'reserve',
	'drive',
	'fill',
	'lock',
	'turn',
	'gather',
	'arrange',
	'assemble',
	'build',
	'cook',
	'fetch',
	'measure',
	'prune',
	'rake',
	'recycle',
	'remove',
	'rsvp',
	'scan',
	'shred',
	'sweep',
	'tune',
	'wipe',
	'pay',
	'notify',
	'warn',
	'remember',
	'apply',
	'enroll',
	'sign',
	'share',
	'archive',
];
const VERB_SET = new Set(VERBS);
const PARTICLES = /\b(?:up|off|out|in|down|over|back|on|away)$/i;
const LEAD_FILLERS = new RegExp(
	String.raw`^(?:(?:and|then|also|plus|oh|hey|so|um|uh|okay|ok|well|first|maybe|probably|possibly)[\s,]+)*`,
	'i',
);
const INTENT_START = new RegExp(String.raw`^${INTENT}\b`, 'i');
const DUE_CLAUSE = /^(?:the|my|our|this|that)\s+[\w' ]{1,30}?(?:'s|\s+is|\s+are)\s+due\b/i;

const stripFillers = (text: string) => text.replace(LEAD_FILLERS, '');
const firstWord = (text: string) => /^[a-z'-]+/i.exec(text)?.[0].toLowerCase() ?? '';
/** A verb that is followed by more words, so `and water` alone stays a noun. */
const startsWithVerb = (text: string) => VERB_SET.has(firstWord(text)) && /^\S+\s+\S/.test(text);
const startsWithIntent = (text: string) => INTENT_START.test(text);

function isTaskLike(text: string): boolean {
	const t = stripFillers(text.trim());
	if (startsWithVerb(t) || startsWithIntent(t)) return true;
	return new RegExp(String.raw`^(?:\S+\s+){1,3}${INTENT}\b`, 'i').test(t);
}

function splitClauses(text: string, base: number): Range[] {
	const clauses: Range[] = [];
	let start = 0;
	for (const m of text.matchAll(/\s*,\s*|\s+(?=(?:and|then|also|plus|oh)\s)/g)) {
		const at = m.index;
		const rest = text.slice(at + m[0].length);
		const connectors = /^(?:(?:and|then|also|plus|oh|so|maybe|probably)[\s,]+)*/i.exec(rest)![0].toLowerCase();
		const next = rest.slice(connectors.length);
		const left = text
			.slice(start, at)
			.replace(/^[\s,;]+/, '')
			.trim();
		if (!cleanTitle(left) || !next) continue;
		const comma = m[0].includes(',');
		const strong = /\b(?:then|also|plus|oh)\b/.test(connectors);
		const words = left.split(/\s+/).length;
		const nextWords = next.split(/\s+/).filter(Boolean).length;
		// A bare `and` keeps two verbs in one task (`call the plumber and ask about the heater`).
		// `then`, `also`, `plus`, and `oh and` start another task, and so does a comma before a verb.
		const split =
			startsWithIntent(next) ||
			(DUE_CLAUSE.test(next) && words >= 2) ||
			(/\boh\s+and\b/.test(connectors) && next.length > 0) ||
			(strong && nextWords >= 2 && !/^(?:the|a|an|some|my|our|his|her|its|that|this)\b/i.test(next)) ||
			(startsWithVerb(next) &&
				(comma ? isTaskLike(left) || strong : strong || (isTaskLike(left) && words >= 2 && !PARTICLES.test(left))));
		if (!split) continue;
		clauses.push({ start: base + start, end: base + at });
		start = at;
	}
	clauses.push({ start: base + start, end: base + text.length });
	return clauses;
}

const ABBREVIATION = /\b(?:mr|mrs|ms|dr|st|jr|sr|vs|etc|e\.g|i\.e|approx|no|mt|ft)$/i;
const BOUNDARY = new RegExp(
	String.raw`(?<separator>\b(?:${SEPARATOR})\b[\s,:]*)|(?<correction>\b(?:scratch\s+that|remove\s+that|delete\s+that|never\s?mind)\b[.,!]*)|(?<sentence>[.!?]+(?=\s|$))`,
	'gi',
);
const CORRECTION_FOLLOW = new RegExp(String.raw`^\s*(?:[.,;!?]|$|(?:${SEPARATOR})\b|i\b|${INTENT}\b)`, 'i');
const correctionEnds = (rest: string) => CORRECTION_FOLLOW.test(rest) || startsWithVerb(rest.trim());
const ENDING = /(?:^|[\s,.;!?])(?:that's|thats|that\s+is)\s+(?:all|it)(?:\s+for\s+now)?[\s.!?]*$/i;

const NOTE_AT_START =
	/^\s*(?:and\s+)?(?:add\s+a\s+note|the\s+notes?\s+(?:is|are|says?)|notes?|details)(?!\s+to\s+self\b)\b[\s:,-]*/i;
const STRUCTURE = new RegExp(
	String.raw`(?<note>\b(?:with\s+(?:a|the)\s+note(?:\s+that)?|add\s+a\s+note|the\s+note\s+is)\b[\s:,-]*|(?<=[,;:]\s*)(?:and\s+)?(?:notes?|details)(?!\s+to\s+self\b)\b[\s:,-]*)|(?<list>\b(?:with\s+(?:the\s+)?|and\s+)?sub[\s-]?tasks\b[\s:,-]*|[\s,]*\b(?:the\s+steps\s+are|steps\s+are|which\s+means|that\s+means|the\s+list\s+is)\b[\s:,-]*|(?<=[a-z])\s*:\s+(?=[a-z]))|(?<one>\b(?:and\s+|with\s+)?(?:add\s+)?(?:a\s+|another\s+)?sub[\s-]?task\b[\s:,-]*)`,
	'gi',
);
const LIST_SPLIT = /\s*,\s*(?:and\s+)?|\s+and\s+/gi;
const CUE =
	/^(?:(?:and|also|oh)\s+)?(?:remind\s+me(?!\s+to\b)|priority|p[1-4]\b|project|in\s+(?:the\s+|my\s+)?project|labels?|tag(?:ged)?|it'?s\s+due|it\s+is\s+due|due|make\s+it(?:\s+to)?|set\s+it(?:\s+to)?|every|each|add\s+it|put\s+it|move\s+it|(?:for|in|to)\s+(?:the|my)\s)/i;

type Item = {
	main: Range[];
	notes: Range[];
	cues: Range[];
	subtasks: Item[];
	parent: Item | null;
};

const newItem = (parent: Item | null = null): Item => ({ main: [], notes: [], cues: [], subtasks: [], parent });

type Boundary = Range & { kind: 'separator' | 'correction' | 'sentence' };

function findBoundaries(text: string): Boundary[] {
	const boundaries: Boundary[] = [];
	for (const m of text.matchAll(BOUNDARY)) {
		const groups = m.groups ?? {};
		const start = m.index;
		const end = start + m[0].length;
		if (groups.sentence && ABBREVIATION.test(text.slice(0, start))) continue;
		if (groups.correction) {
			if (/\bto\s+$/i.test(text.slice(0, start)) || !correctionEnds(text.slice(end))) continue;
		}
		const kind = groups.separator ? 'separator' : groups.correction ? 'correction' : 'sentence';
		boundaries.push({ kind, start, end });
	}
	return boundaries;
}

const isBlank = (text: string) => !/[\p{L}\p{N}]/u.test(text);

export function parseRamble(transcript: string, options: RambleOptions): RambleDraft {
	const mapped = normalize(transcript);
	const grammar: Grammar = {
		now: options.now,
		project: projectMatcher(options.projects ?? []),
		labels: labelMatchers(options.labels ?? []),
	};
	const structural: Array<Range & { kind: 'separator' | 'subtask' | 'note' | 'correction' | 'end' }> = [];

	let text = mapped.text;
	const ending = ENDING.exec(text);
	if (ending) {
		const start = ending.index + (/^[\s,.;!?]/.test(ending[0]) ? 1 : 0);
		structural.push({ kind: 'end', start, end: text.length });
		text = text.slice(0, start);
	}

	const span = (range: Range) => mapped.text.slice(range.start, range.end);
	const sliceOf = (item: Item, allowProject: boolean) => {
		const start = Math.min(...item.main.map(r => r.start));
		const end = Math.max(...item.main.map(r => r.end));
		let masked = ';'.repeat(end - start).split('');
		for (const r of item.main) for (let i = r.start; i < r.end; i++) masked[i - start] = mapped.text[i]!;
		return { attributes: readAttributes(masked.join(''), start, grammar, allowProject), start };
	};
	const titleOf = (ranges: Range[], allowProject: boolean) => {
		const item = { ...newItem(), main: ranges };
		const { attributes } = sliceOf(item, allowProject);
		return { title: buildTitle(transcript, mapped, ranges, attributes.tokens), attributes };
	};

	const tasks: Item[] = [];
	let current: Item | null = null;
	const startTask = (range: Range | null) => {
		const task = newItem();
		if (range) task.main.push(range);
		tasks.push(task);
		current = task;
		return task;
	};
	const rootOf = (item: Item | null) => (item?.parent ?? item) as Item | null;

	const isAttributesOnly = (range: Range, item: Item) => !titleOf([range], item.parent === null).title;

	const leadingCue = (range: Range): Range | null => {
		const clause = span(range);
		const skip = clause.length - clause.replace(/^\s+/, '').length;
		const cue = CUE.exec(clause.slice(skip));
		if (!cue) return null;
		const start = range.start + skip;
		return { start, end: start + cue[0].length };
	};

	const shouldAttach = (range: Range, item: Item) => {
		const { title, attributes } = titleOf([range], item.parent === null);
		if (!title) return true;
		// The cue is structural text. It continues the task before it whenever the sentence sets a
		// field, including when that field starts after the cue (`Make it due tomorrow`).
		return leadingCue(range) !== null && attributes.tokens.length > 0;
	};

	const handleLead = (range: Range, forceNew: boolean) => {
		const clauses = splitClauses(span(range), range.start).filter(c => !isBlank(span(c)));
		clauses.forEach((clause, index) => {
			const attach =
				current && (index === 0 ? !forceNew && shouldAttach(clause, current) : isAttributesOnly(clause, current));
			if (attach && current) {
				current.main.push(clause);
				const cue = leadingCue(clause);
				if (cue) current.cues.push(cue);
			} else startTask(clause);
		});
	};

	const handleSentence = (range: Range, forceNew: boolean) => {
		const sentence = span(range);
		const note = current && !forceNew ? NOTE_AT_START.exec(sentence) : null;
		if (note && current) {
			const item: Item = current;
			item.cues.push({ start: range.start, end: range.start + note[0].length });
			item.notes.push({ start: range.start + note[0].length, end: range.end });
			structural.push({ kind: 'note', start: range.start, end: range.start + note[0].length });
			return;
		}
		const markers = [...sentence.matchAll(STRUCTURE)].map(m => ({
			kind: (m.groups?.note ? 'note' : m.groups?.list ? 'list' : 'one') as 'note' | 'list' | 'one',
			start: range.start + m.index,
			end: range.start + m.index + m[0].length,
		}));
		const leadEnd = markers[0]?.start ?? range.end;
		if (!isBlank(mapped.text.slice(range.start, leadEnd))) handleLead({ start: range.start, end: leadEnd }, forceNew);
		for (const [index, marker] of markers.entries()) {
			const nextStart = marker.kind === 'note' ? range.end : (markers[index + 1]?.start ?? range.end);
			const content = { start: marker.end, end: nextStart };
			const cue = { start: marker.start, end: marker.end };
			if (marker.kind === 'note') {
				const target: Item | null = current;
				if (!target) {
					startTask({ start: marker.start, end: range.end });
					return;
				}
				target.cues.push(cue);
				target.notes.push(content);
				structural.push({ kind: 'note', ...cue });
				return;
			}
			const root = rootOf(current);
			structural.push({ kind: 'subtask', ...cue });
			if (!root) {
				if (marker.kind === 'one') startTask(content).cues.push(cue);
				else for (const part of listParts(content)) startTask(part).cues.push(cue);
				continue;
			}
			root.cues.push(cue);
			if (marker.kind === 'one') {
				const subtask = newItem(root);
				subtask.main.push(content);
				root.subtasks.push(subtask);
				current = subtask;
			} else {
				for (const part of listParts(content)) {
					const subtask = newItem(root);
					subtask.main.push(part);
					root.subtasks.push(subtask);
				}
				current = root;
			}
		}
	};

	const listParts = (range: Range): Range[] => {
		const parts: Range[] = [];
		let start = range.start;
		for (const m of span(range).matchAll(LIST_SPLIT)) {
			parts.push({ start, end: range.start + m.index });
			start = range.start + m.index + m[0].length;
		}
		parts.push({ start, end: range.end });
		return parts.filter(p => !isBlank(span(p)));
	};

	const dropCurrent = () => {
		const item: Item | null = current;
		if (!item) return;
		if (item.parent) {
			item.parent.subtasks.splice(item.parent.subtasks.indexOf(item), 1);
			current = item.parent;
		} else {
			tasks.splice(tasks.indexOf(item), 1);
			current = tasks.at(-1) ?? null;
		}
	};

	let cursor = 0;
	let forceNew = true;
	for (const boundary of [
		...findBoundaries(text),
		{ kind: 'sentence' as const, start: text.length, end: text.length },
	]) {
		const part = { start: cursor, end: boundary.start };
		if (!isBlank(span(part))) {
			handleSentence(part, forceNew);
			forceNew = false;
		}
		cursor = boundary.end;
		if (boundary.kind === 'separator') {
			structural.push({ kind: 'separator', start: boundary.start, end: boundary.end });
			forceNew = true;
		} else if (boundary.kind === 'correction') {
			structural.push({ kind: 'correction', start: boundary.start, end: boundary.end });
			dropCurrent();
			forceNew = true;
		}
	}

	const tokens: RambleToken[] = [];
	const toOriginal = (range: Range): RambleSpan => ({
		start: mapped.starts[range.start]!,
		end: mapped.ends[range.end]!,
	});
	const pushToken = (kind: RambleTokenKind, range: Range) => {
		let { start, end } = toOriginal(range);
		while (start < end && /\s/.test(transcript[start]!)) start++;
		while (end > start && /\s/.test(transcript[end - 1]!)) end--;
		tokens.push({ kind, start, end, text: transcript.slice(start, end) });
	};

	const build = (item: Item, isRoot: boolean): RambleTask | null => {
		const attributes = item.main.length ? sliceOf(item, isRoot).attributes : null;
		const title =
			item.main.length && attributes ? buildTitle(transcript, mapped, item.main, attributes.tokens, item.cues) : '';
		if (!title) return null;
		const subtasks = isRoot ? item.subtasks.map(s => build(s, false)).filter(s => s !== null) : [];
		for (const token of attributes?.tokens ?? []) pushToken(token.kind, token);
		const notes = item.notes
			.map(r => transcript.slice(mapped.starts[r.start], mapped.ends[r.end]).trim())
			.filter(Boolean)
			.join(' ')
			.replace(/^[\s:,-]+/, '');
		const ranges = [...item.main, ...item.notes, ...item.cues];
		const covered = {
			start: Math.min(...ranges.map(r => r.start)),
			end: Math.max(...ranges.map(r => r.end)),
		};
		const segment = toOriginal(covered);
		for (const subtask of subtasks) {
			segment.start = Math.min(segment.start, subtask.segment.start);
			segment.end = Math.max(segment.end, subtask.segment.end);
		}
		return {
			segment,
			title,
			notes,
			due: attributes?.due ?? null,
			recurrence: attributes?.recurrence ?? null,
			priority: attributes?.priority ?? null,
			reminders: attributes?.reminders ?? [],
			projectId: isRoot ? (attributes?.projectId ?? null) : null,
			labelIds: attributes?.labelIds ?? [],
			subtasks,
		};
	};

	const built: RambleTask[] = [];
	for (const task of tasks) {
		const result = build(task, true);
		if (result) built.push(result);
		else
			for (const subtask of task.subtasks) {
				const promoted = build({ ...subtask, parent: null }, true);
				if (promoted) built.push(promoted);
			}
	}
	for (const s of structural) pushToken(s.kind, s);
	tokens.sort((a, b) => a.start - b.start || a.end - b.end);
	return { tasks: built, tokens, ended: ending !== null };
}
