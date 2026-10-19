import type { Snapshot } from './model.ts';
import { emptySnapshot } from './snapshot.ts';
import type { Label, Project, Section, Task } from './task.ts';

export const task = (id: string, fields: Partial<Task> = {}): Task => ({
	id,
	parentId: null,
	order: 0,
	title: id,
	notes: '',
	projectId: null,
	sectionId: null,
	labelIds: [],
	due: null,
	recurrence: null,
	priority: 4,
	reminders: [],
	location: null,
	event: null,
	images: [],
	createdAt: 1,
	completedAt: null,
	createdBy: null,
	completedBy: null,
	lastCompletedAt: null,
	...fields,
});

export const project = (id: string, fields: Partial<Project> = {}): Project => ({
	id,
	name: id,
	order: 0,
	icon: null,
	createdAt: 1,
	...fields,
});

export const section = (id: string, projectId: string, fields: Partial<Section> = {}): Section => ({
	id,
	projectId,
	name: id,
	order: 0,
	createdAt: 1,
	...fields,
});

export const label = (id: string, fields: Partial<Label> = {}): Label => ({
	id,
	name: id,
	color: 'gray',
	place: null,
	createdAt: 1,
	...fields,
});

export const snapshotOf = (
	fields: Partial<Omit<Snapshot, 'settings'>> & { settings?: Partial<Snapshot['settings']> } = {},
): Snapshot => ({
	...emptySnapshot(),
	...fields,
	settings: { ...emptySnapshot().settings, ...fields.settings },
});
