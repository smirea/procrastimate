import { z } from 'zod';
import {
	accessRowSchema,
	commentsRowSchema,
	labelsRowSchema,
	projectsRowSchema,
	readsRowSchema,
	sectionsRowSchema,
	settingsRowSchema,
	tasksRowSchema,
} from './db/generated/zod.ts';
import { KINDS, type Kind } from './kinds.ts';
import { DEFAULT_QUICK_ADD_BUTTONS } from './quick-add-buttons.ts';

export { KINDS, type Kind } from './kinds.ts';

export const kindSchema = z.enum(KINDS).meta({ id: 'EntityKind' });

export const SETTINGS_ID = 'settings';

/** Each kind's fields are its table's columns without the owner and the id. A missing `sourceKey` is `null`. */
const NOT_FIELDS = { userId: true, id: true } as const;

export const taskFieldsSchema = tasksRowSchema.omit(NOT_FIELDS);
export const projectFieldsSchema = projectsRowSchema.omit(NOT_FIELDS);
export const sectionFieldsSchema = sectionsRowSchema.omit(NOT_FIELDS);
export const labelFieldsSchema = labelsRowSchema.omit(NOT_FIELDS);
export const commentFieldsSchema = commentsRowSchema.omit(NOT_FIELDS);
export const readFieldsSchema = readsRowSchema.omit(NOT_FIELDS);
export const settingsFieldsSchema = settingsRowSchema.omit(NOT_FIELDS);

export type Settings = z.infer<typeof settingsFieldsSchema>;
export const DEFAULT_SETTINGS: Settings = {
	timeZone: null,
	dictation: 'native',
	rambleMode: 'smart',
	quickAddButtons: DEFAULT_QUICK_ADD_BUTTONS,
};

export const FIELDS_SCHEMAS = {
	task: taskFieldsSchema,
	project: projectFieldsSchema,
	section: sectionFieldsSchema,
	label: labelFieldsSchema,
	comment: commentFieldsSchema,
	read: readFieldsSchema,
	settings: settingsFieldsSchema,
} as const satisfies Record<Kind, z.ZodObject>;

export type FieldsByKind = { [K in Kind]: z.infer<(typeof FIELDS_SCHEMAS)[K]> };

/** A whole entity as clients hold it: a row's fields and its id. A missing `sourceKey` stays missing. */
export const taskSchema = tasksRowSchema
	.omit({ userId: true, sourceKey: true })
	.extend({ sourceKey: z.string().optional() })
	.meta({ id: 'Task', 'x-table': 'tasks' });
export const projectSchema = projectsRowSchema
	.omit({ userId: true, sourceKey: true })
	.extend({ sourceKey: z.string().optional() })
	.meta({ id: 'Project', 'x-table': 'projects' });
export const sectionSchema = sectionsRowSchema
	.omit({ userId: true, sourceKey: true })
	.extend({ sourceKey: z.string().optional() })
	.meta({ id: 'ProjectSection', 'x-table': 'sections' });
export const labelSchema = labelsRowSchema.omit({ userId: true }).meta({ id: 'Label', 'x-table': 'labels' });
export const commentSchema = commentsRowSchema.omit({ userId: true }).meta({ id: 'Comment', 'x-table': 'comments' });
export const readSchema = readsRowSchema.omit({ userId: true }).meta({ id: 'CommentRead', 'x-table': 'reads' });
export const settingsSchema = settingsFieldsSchema.meta({ id: 'Settings', 'x-table': 'settings' });

/** One entity another user shares with the signed-in user, and whether they may edit it. Only the server writes it. */
export const accessSchema = accessRowSchema.meta({ id: 'Access', 'x-table': 'access' });

export type Task = z.infer<typeof taskSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Label = z.infer<typeof labelSchema>;
export type Comment = z.infer<typeof commentSchema>;
export type CommentRead = z.infer<typeof readSchema>;

/** One space's data: everything a store rule reads, plus the owner's settings. */
export const snapshotSchema = z
	.object({
		tasks: z.array(taskSchema),
		projects: z.array(projectSchema),
		sections: z.array(sectionSchema),
		labels: z.array(labelSchema),
		comments: z.array(commentSchema),
		reads: z.array(readSchema),
		settings: settingsSchema,
	})
	.meta({ id: 'Snapshot' });

export type Snapshot = z.infer<typeof snapshotSchema>;
