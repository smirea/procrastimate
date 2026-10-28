import { z } from 'zod';
import type { Task } from './task.ts';
import { placeKey } from './triggers.ts';
import { taskLocationSchema } from './values.ts';

export const suggestionFieldsSchema = z
	.object({
		projectId: z.string().nullable(),
		sure: z.boolean(),
		sectionId: z.string().nullable(),
		labelIds: z.array(z.string()),
		location: taskLocationSchema.nullable(),
	})
	.meta({
		id: 'SuggestionFields',
		description:
			"What similar past tasks agree on. A split vote leaves a field null or empty. `sure` says the project holds nearly the whole vote, and a section shows only when nearly all of that project's matching tasks sit in it.",
	});
export type MetadataSuggestions = z.infer<typeof suggestionFieldsSchema>;

export const suggestionDraftSchema = z
	.object({
		projectId: z.string().nullable(),
		sectionId: z.string().nullable(),
		labelIds: z.array(z.string()),
		location: taskLocationSchema.nullable(),
	})
	.meta({ id: 'SuggestionDraft', description: 'What the quick add draft already holds, which no pill repeats.' });
export type DraftFields = z.infer<typeof suggestionDraftSchema>;

type Filed = Pick<Task, 'title' | 'createdAt' | 'projectId' | 'sectionId' | 'labelIds' | 'location'>;

export type SuggestionIndex = {
	tasks: readonly Filed[];
	words: readonly ReadonlySet<string>[];
	norms: readonly number[];
	idf: ReadonlyMap<string, number>;
};

const STOP_WORDS = new Set([
	'a',
	'an',
	'the',
	'to',
	'for',
	'and',
	'of',
	'on',
	'with',
	'about',
	'my',
	'in',
	'at',
	're',
	'from',
	'up',
]);
const NEIGHBORS = 8;
/**
 * The share of the vote that overrides where the draft already sits, or names a section. Half the vote was right on
 * only 59% of section pills; 90% of a project's own matching tasks was right on 81% (see docs/decisions/quick-add.md).
 */
const SURE = 0.9;
/** Days for a past task's recency weight to fall by e, so a habit that changed wins over the old one. */
const RECENCY_DAYS = 120;
const DAY = 86_400_000;

/** Lowercase words without stop words, with a plural `s` dropped from words over three letters. */
export function suggestionWords(text: string): Set<string> {
	const words = new Set<string>();
	for (const [word] of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
		if (STOP_WORDS.has(word)) continue;
		words.add(word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word);
	}
	return words;
}

export function suggestionIndex(tasks: readonly Filed[]): SuggestionIndex {
	const words = tasks.map(task => suggestionWords(task.title));
	const counts = new Map<string, number>();
	for (const set of words) for (const word of set) counts.set(word, (counts.get(word) ?? 0) + 1);
	const idf = new Map([...counts].map(([word, count]) => [word, Math.log((tasks.length + 1) / count)]));
	const norms = words.map(set => norm(set, idf));
	return { tasks, words, norms, idf };
}

function norm(words: ReadonlySet<string>, idf: ReadonlyMap<string, number>): number {
	let sum = 0;
	for (const word of words) sum += (idf.get(word) ?? 0) ** 2;
	return Math.sqrt(sum);
}

/**
 * The project, labels, and place that the eight past tasks sharing the most rare words with `title` agree on,
 * each past task weighted by how closely and how recently it matches. A value shows only when the tasks that hold it
 * carry at least half the vote, and a missing value votes too, so a word that sometimes means Home shows nothing.
 * A section needs `SURE` of the vote among the project's own matching tasks, because one project's sections share
 * their words, and at half the vote they were right only about 60% of the time (see docs/decisions/quick-add.md).
 */
export function suggestMetadata(index: SuggestionIndex, title: string, now: number): MetadataSuggestions {
	const query = suggestionWords(title);
	const queryNorm = norm(query, index.idf);
	const none: MetadataSuggestions = { projectId: null, sure: false, sectionId: null, labelIds: [], location: null };
	if (queryNorm === 0) return none;
	const neighbors: { task: Filed; score: number }[] = [];
	index.tasks.forEach((task, i) => {
		let shared = 0;
		for (const word of query) if (index.words[i]!.has(word)) shared += index.idf.get(word)! ** 2;
		if (shared === 0) return;
		const recency = Math.exp(-Math.max(0, now - task.createdAt) / DAY / RECENCY_DAYS);
		neighbors.push({ task, score: (shared / (queryNorm * index.norms[i]!)) * (0.5 + 0.5 * recency) });
	});
	const near = neighbors.toSorted((a, b) => b.score - a.score).slice(0, NEIGHBORS);

	const total = near.reduce((sum, n) => sum + n.score, 0);

	function agreed(valuesOf: (task: Filed) => readonly string[], voters = near, share = 0.5): string[] {
		const quorum = voters.reduce((sum, n) => sum + n.score, 0) * share;
		const weights = new Map<string, number>();
		for (const { task, score } of voters)
			for (const value of valuesOf(task)) weights.set(value, (weights.get(value) ?? 0) + score);
		return [...weights]
			.filter(([, weight]) => weight >= quorum)
			.toSorted((a, b) => b[1] - a[1])
			.map(([value]) => value);
	}

	// Two values can both hold exactly half the vote, and a tie suggests neither.
	const only = (values: string[]) => (values.length === 1 ? values[0]! : null);
	const projectId = only(agreed(task => (task.projectId ? [task.projectId] : [])));
	const project = near.filter(({ task }) => projectId !== null && task.projectId === projectId);
	const sectionId = only(agreed(task => (task.sectionId ? [task.sectionId] : []), project, SURE));
	const place = only(agreed(task => (task.location ? [placeKey(task.location)] : [])));
	return {
		projectId,
		sure: projectId !== null && project.reduce((sum, n) => sum + n.score, 0) >= total * SURE,
		sectionId,
		labelIds: agreed(task => task.labelIds),
		location: place ? near.find(({ task }) => task.location && placeKey(task.location) === place)!.task.location : null,
	};
}

export const suggestionPillSchema = z
	.discriminatedUnion('kind', [
		z.object({ kind: z.literal('project'), projectId: z.string(), sectionId: z.string().nullable() }),
		z.object({ kind: z.literal('label'), labelId: z.string() }),
		z.object({ kind: z.literal('place'), location: taskLocationSchema }),
	])
	.meta({
		id: 'SuggestionPill',
		description: 'A value quick add offers under the title. A project pill may name a section of it too.',
		'x-inline': true,
	});
export type SuggestionPill = z.infer<typeof suggestionPillSchema>;

export const suggestionAvailableSchema = z
	.object({ projectIds: z.array(z.string()), sectionIds: z.array(z.string()), labelIds: z.array(z.string()) })
	.meta({
		id: 'SuggestionAvailable',
		description:
			'Ids the draft may still use. A suggestion naming a deleted or view-only project, section, or label never shows.',
	});
export type Available = z.infer<typeof suggestionAvailableSchema>;

/**
 * The pills to show, in field order: each suggestion the draft can use and does not already hold. Where the draft
 * already sits, the project and section quick add opened in or Stefan picked, moves only on a sure vote, so adding
 * inside a section stays quiet unless the history strongly says otherwise. A section of the draft's own project still
 * shows when the vote names one, since a more specific place is not a contradiction.
 */
export function suggestionPills(
	suggestions: MetadataSuggestions,
	draft: DraftFields,
	available: Available,
): SuggestionPill[] {
	const pills: SuggestionPill[] = [];
	const { projectId, sure, labelIds, location } = suggestions;
	const sectionId =
		suggestions.sectionId && available.sectionIds.includes(suggestions.sectionId) ? suggestions.sectionId : null;
	if (projectId && available.projectIds.includes(projectId)) {
		const moves = draft.projectId !== projectId;
		if (moves ? sure || draft.projectId === null : sectionId !== null && sectionId !== draft.sectionId)
			pills.push({ kind: 'project', projectId, sectionId });
	}
	for (const labelId of labelIds) {
		if (available.labelIds.includes(labelId) && !draft.labelIds.includes(labelId))
			pills.push({ kind: 'label', labelId });
	}
	if (location && (!draft.location || placeKey(draft.location) !== placeKey(location)))
		pills.push({ kind: 'place', location });
	return pills;
}
