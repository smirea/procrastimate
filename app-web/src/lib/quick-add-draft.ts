import { typedOver, type Placed } from 'shared/quick-add-merge.ts';
import type { ParsedQuickAdd, QuickAddToken } from 'shared/quick-add.ts';
import type { ListDefaults } from 'shared/screens.ts';
import { DEFAULT_PRIORITY, type Due, type Label, type Priority, type Recurrence, type Reminder } from 'shared/task.ts';
import { applyPickedLabels, isSavedPlace } from 'shared/triggers.ts';
import type { TaskEvent, TaskLocation } from 'shared/values.ts';
import type { NewTask } from 'shared/store.ts';

/** Values set with the chips rather than typed. The text wins over a pick for the same attribute. */
export type Picked = {
	due: Due | null;
	priority: Priority | null;
	projectId: string | null;
	sectionId: string | null;
	labelIds: string[];
	reminders: Reminder[];
	/** Set by the repeat chip or a ramble. A typed repeat wins. */
	recurrence: Recurrence | null;
	/** Only a place or event screen sets these on the web, since picking one needs iPhone. */
	location: TaskLocation | null;
	event: TaskEvent | null;
};

export const initialPicked = (defaults: ListDefaults): Picked => ({
	due: defaults.date ? { date: defaults.date, time: null } : null,
	priority: null,
	projectId: defaults.projectId,
	sectionId: defaults.sectionId,
	labelIds: [...defaults.labelIds],
	reminders: [],
	recurrence: null,
	location: defaults.location,
	event: defaults.event,
});

/** The values the chips show: the text's when it has one, else the pick's. */
export const merged = (parsed: ParsedQuickAdd, picked: Picked): Placed<Priority> =>
	typedOver({ ...picked, priority: picked.priority ?? DEFAULT_PRIORITY }, parsed, null);

/** Cuts each token's phrase from the text, as unchecking a typed label does. */
export function cutTokens(text: string, tokens: readonly QuickAddToken[]): string {
	let next = text;
	for (const token of tokens.toSorted((a, b) => b.start - a.start))
		next = next.slice(0, token.start) + next.slice(token.end);
	return next.replaceAll(/\s{2,}/g, ' ');
}

export const labelIdOf = (token: QuickAddToken, labels: readonly Label[]) =>
	labels.find(l => `@${l.name}`.toLowerCase() === token.text.toLowerCase())?.id;

/** A typed `@place` wins over a picked one, as typed attributes do. */
export const typedPlaceId = (parsed: ParsedQuickAdd, labels: readonly Label[]) =>
	parsed.tokens
		.filter(t => t.kind === 'place')
		.map(token => labelIdOf(token, labels))
		.at(-1);

const placeIds = (labels: readonly Label[]) => new Set(labels.filter(isSavedPlace).map(l => l.id));

/** What the labels picker shows: the picked labels, the typed ones, and the one saved place. */
export function shownLabelIds(parsed: ParsedQuickAdd, picked: Picked, labels: readonly Label[]): string[] {
	const places = placeIds(labels);
	const typedPlace = typedPlaceId(parsed, labels);
	return [
		...new Set([
			...picked.labelIds.filter(id => !typedPlace || !places.has(id)),
			...parsed.labelIds,
			...(typedPlace ? [typedPlace] : []),
		]),
	];
}

/**
 * Unchecking a typed label removes its `@name`, so the picker's list is what saves. A task has one place, so checking
 * a saved place unchecks any other, typed or picked. A label the text still types stays the text's, so deleting its
 * `@name` later drops it.
 */
export function labelPick(
	next: readonly string[],
	parsed: ParsedQuickAdd,
	picked: Picked,
	labels: readonly Label[],
): { cut: QuickAddToken[]; labelIds: string[] } {
	const places = placeIds(labels);
	const typedPlace = typedPlaceId(parsed, labels);
	const place = next.filter(id => places.has(id)).at(-1);
	const cut = parsed.tokens.filter(token => {
		if (token.kind === 'label') return !next.includes(labelIdOf(token, labels) ?? '');
		return token.kind === 'place' && labelIdOf(token, labels) !== place;
	});
	const labelIds = next.filter(id =>
		places.has(id) ? id === place && id !== typedPlace : !parsed.labelIds.includes(id) || picked.labelIds.includes(id),
	);
	return { cut, labelIds };
}

/** The task to save, or null while the title is empty. An event stands in for the date and the repeat. */
export function draftTask(parsed: ParsedQuickAdd, picked: Picked, labels: readonly Label[]): NewTask | null {
	if (!parsed.title) return null;
	const applied = applyPickedLabels(labels, shownLabelIds(parsed, picked, labels), picked.location);
	return {
		title: parsed.title,
		...typedOver({ ...picked, priority: picked.priority ?? DEFAULT_PRIORITY }, parsed, picked.event),
		labelIds: applied.labelIds,
		reminders: [...parsed.reminders, ...picked.reminders],
		location: applied.location,
		event: picked.event,
	};
}
