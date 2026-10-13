import type { RambleTask, RambleToken } from 'shared/ramble.ts';
import type { DateKey, Due, Priority, Recurrence, Reminder } from 'shared/task.ts';
import type { QuickAddDefaults } from '../ui.svelte.ts';

/** One preview card. `anchor` is the transcript span start, so a reparse updates the same card. */
export type RambleCard = {
	id: string;
	anchor: number;
	title: string;
	notes: string;
	due: Due | null;
	recurrence: Recurrence | null;
	priority: Priority | null;
	reminders: Reminder[];
	projectId: string | null;
	labelIds: string[];
	subtasks: RambleTask[];
	pinned: boolean;
};

/** What one save writes. Subtasks nest; a subtask takes its parent's project in the store. */
export type RambleSave = {
	title: string;
	notes: string;
	due: Due | null;
	recurrence: Recurrence | null;
	priority: Priority | null;
	reminders: Reminder[];
	projectId: string | null;
	labelIds: string[];
	subtasks: RambleSave[];
};

const none: QuickAddDefaults = { projectId: null, labelId: null, today: false };

function materialize(task: RambleTask, defaults: QuickAddDefaults, today: DateKey): Omit<RambleCard, 'id' | 'anchor' | 'pinned'> {
	const labelIds = defaults.labelId && !task.labelIds.includes(defaults.labelId) ? [defaults.labelId, ...task.labelIds] : [...task.labelIds];
	return {
		title: task.title,
		notes: task.notes,
		due: task.due ?? (defaults.today ? { date: today, time: null } : null),
		recurrence: task.recurrence,
		priority: task.priority,
		reminders: [...task.reminders],
		projectId: task.projectId ?? defaults.projectId,
		labelIds,
		subtasks: task.subtasks,
	};
}

function saveTask(task: RambleTask): RambleSave {
	return {
		title: task.title,
		notes: task.notes,
		due: task.due,
		recurrence: task.recurrence,
		priority: task.priority,
		reminders: task.reminders,
		projectId: null,
		labelIds: task.labelIds,
		subtasks: task.subtasks.map(saveTask),
	};
}

export function saveOf(card: RambleCard): RambleSave {
	return {
		title: card.title,
		notes: card.notes,
		due: card.due,
		recurrence: card.recurrence,
		priority: card.priority,
		reminders: card.reminders,
		projectId: card.projectId,
		labelIds: card.labelIds,
		subtasks: card.subtasks.map(saveTask),
	};
}

/**
 * Rebuilds the preview from a fresh parse. A pinned card keeps the edits. A hidden anchor stays out. A card whose
 * span disappeared is gone, including a pinned one, because a spoken correction removed it.
 */
export function reconcileCards(
	previous: readonly RambleCard[],
	tasks: readonly RambleTask[],
	hidden: ReadonlySet<number>,
	defaults: QuickAddDefaults,
	today: DateKey,
	id: () => string,
): RambleCard[] {
	const byAnchor = new Map(previous.map(card => [card.anchor, card]));
	const next: RambleCard[] = [];
	for (const task of tasks) {
		if (hidden.has(task.segment.start)) continue;
		const old = byAnchor.get(task.segment.start);
		if (old?.pinned) {
			next.push(old);
			continue;
		}
		next.push({ id: old?.id ?? id(), anchor: task.segment.start, pinned: false, ...materialize(task, defaults, today) });
	}
	return next;
}

/** `Add 3 tasks` / `Added 1 task`. */
export function taskCountLabel(count: number, verb: 'Add' | 'Added'): string {
	return `${verb} ${count} ${count === 1 ? 'task' : 'tasks'}`;
}

export type TranscriptPiece = { text: string; kind: RambleToken['kind'] | null };

/** Splits a transcript on token spans. Offsets are UTF-16, which is what `String.slice` uses. */
export function transcriptPieces(text: string, tokens: readonly RambleToken[]): TranscriptPiece[] {
	const marks = tokens.filter(token => token.end > token.start).toSorted((a, b) => a.start - b.start || a.end - b.end);
	const pieces: TranscriptPiece[] = [];
	let cursor = 0;
	for (const token of marks) {
		if (token.start < cursor) continue;
		if (token.start > cursor) pieces.push({ text: text.slice(cursor, token.start), kind: null });
		pieces.push({ text: text.slice(token.start, token.end), kind: token.kind });
		cursor = token.end;
	}
	if (cursor < text.length) pieces.push({ text: text.slice(cursor), kind: null });
	return pieces;
}

/** Joins committed utterances with the partial that replaces the tail. */
export function joinTranscript(committed: string, partial: string): { text: string; partialStart: number } {
	const tail = partial.trim();
	if (!committed) return { text: tail, partialStart: 0 };
	if (!tail) return { text: committed, partialStart: committed.length };
	const gap = committed.endsWith(' ') || tail.startsWith(' ') ? '' : ' ';
	return { text: committed + gap + tail, partialStart: committed.length + gap.length };
}

export const emptyDefaults = none;
