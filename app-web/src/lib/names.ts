import type { Component } from 'svelte';
import Hash from 'phosphor-svelte/lib/Hash';
import Tag from 'phosphor-svelte/lib/Tag';
import { labelIdsOf, projectIdsOf, type Named, type Sigil } from 'shared/name-search.ts';
import type { Task } from 'shared/task.ts';
import { store } from './store.svelte.ts';

/** Everything typed after a sigil and picked by name. Both kinds share one autocomplete. */
export type NameKind = 'project' | 'label';

export type NameSource = {
	sigil: Sigil;
	/** The listbox's accessible name. */
	list: string;
	noun: string;
	icon: Component<{ size?: number; class?: string }>;
	items: () => readonly Named[];
	idsOf: (task: Task) => readonly string[];
	create: (name: string) => Named;
};

export const NAME_SOURCES: Record<NameKind, NameSource> = {
	project: {
		sigil: '#',
		list: 'Projects',
		noun: 'project',
		icon: Hash,
		items: () => store.projects,
		idsOf: projectIdsOf,
		create: name => store.addProject(name),
	},
	label: {
		sigil: '@',
		list: 'Labels',
		noun: 'label',
		icon: Tag,
		items: () => store.labels,
		idsOf: labelIdsOf,
		create: name => store.addLabel(name),
	},
};
