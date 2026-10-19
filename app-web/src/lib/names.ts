import type { Component } from 'svelte';
import Rows from 'phosphor-svelte/lib/Rows';
import { labelIdsOf, projectIdsOf, sectionIdsOf, type Named, type Sigil } from 'shared/name-search.ts';
import type { Task } from 'shared/task.ts';
import { labelIcon } from './label-icon.ts';
import { projectIcon } from './project-icon.ts';
import { store } from './store.svelte.ts';

export type NameKind = 'project' | 'section' | 'label';

export type NameSource = {
	sigil: Sigil;
	list: string;
	noun: string;
	icon: (id: string) => Component<{ size?: number; class?: string }>;
	items: () => readonly Named[];
	idsOf: (task: Task) => readonly string[];
	create: (name: string) => Named;
};

/** A section belongs to one project, so its source lists and creates that project's sections. */
export const sectionSource = (projectId: string): NameSource => ({
	sigil: '/',
	list: 'Sections',
	noun: 'section',
	icon: () => Rows,
	items: () => store.sectionsOf(projectId),
	idsOf: sectionIdsOf,
	create: name => store.addSection(projectId, name)!,
});

export const NAME_SOURCES: Record<Exclude<NameKind, 'section'>, NameSource> = {
	project: {
		sigil: '#',
		list: 'Projects',
		noun: 'project',
		icon: id => projectIcon(store.project(id)),
		items: () => store.projects,
		idsOf: projectIdsOf,
		create: name => store.addProject(name),
	},
	label: {
		sigil: '@',
		list: 'Labels',
		noun: 'label',
		icon: id => labelIcon(store.labels.find(l => l.id === id)),
		items: () => store.labels,
		idsOf: labelIdsOf,
		create: name => store.addLabel(name),
	},
};
