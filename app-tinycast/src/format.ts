import { Color } from '@raycast/api';
import { dueTone, formatDue, repeatLabel, type DueTone } from 'shared/format.ts';
import type { LabelColor } from 'shared/label-colors.ts';
import { linkify } from 'shared/links.ts';
import { toDateKey, type DateKey, type Priority, type Task } from 'shared/task.ts';

export const todayKey = (): DateKey => toDateKey(new Date());

const TONES: Record<DueTone, Color> = {
	overdue: Color.Red,
	today: Color.Orange,
	soon: Color.Green,
	week: Color.Purple,
	later: Color.SecondaryText,
};

export const dueColor = (task: Task, today: DateKey) => (task.due ? TONES[dueTone(task.due, today)] : undefined);

/** Raycast's palette follows the theme, which the app's light-mode hex values would not. */
export const LABEL_TINTS: Record<LabelColor, Color> = {
	red: Color.Red,
	orange: Color.Orange,
	amber: Color.Yellow,
	lime: Color.Green,
	green: Color.Green,
	teal: Color.Blue,
	cyan: Color.Blue,
	blue: Color.Blue,
	indigo: Color.Purple,
	violet: Color.Purple,
	pink: Color.Magenta,
	gray: Color.SecondaryText,
};

export const PRIORITY_TINTS: Record<Priority, Color> = {
	1: Color.Red,
	2: Color.Orange,
	3: Color.Blue,
	4: Color.SecondaryText,
};

/** `Tomorrow 5pm · every Mon`: what a task's date chip and repeat say in the app. */
export function whenText(task: Pick<Task, 'due' | 'recurrence'>, today: DateKey): string | null {
	const parts = [
		task.due ? formatDue(task.due, today) : null,
		task.recurrence ? repeatLabel(task.recurrence, task.due) : null,
	].filter(part => part !== null);
	return parts.length ? parts.join(' · ') : null;
}

/** A title as the apps show it: a Markdown link reads as its label. */
export const plainTitle = (title: string) =>
	linkify(title)
		.map(segment => segment.text)
		.join('') || 'Untitled';

export const firstLink = (title: string) => linkify(title).find(segment => segment.href)?.href ?? null;

export function addedMessage(task: Task): string {
	const when = whenText(task, todayKey());
	const title = plainTitle(task.title);
	return when ? `Added “${title}” · ${when}` : `Added “${title}”`;
}
