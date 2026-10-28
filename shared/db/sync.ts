import { defineSchema } from 'sync-engine/core';
import { COLUMN_VALUES } from './json.ts';
import { access, comments, labels, projects, reads, sections, settings, tasks } from './schema.ts';

/**
 * The synced tables as sync-engine sees them, in snapshot order, with the Zod shape of each JSON or narrowed column
 * as its validator. The server, the web worker, and the generated `SyncSchema.swift` all take their DDL from it.
 */
export const syncSchema = defineSchema({
	tables: { projects, sections, labels, tasks, comments, reads, settings, access },
	values: {
		tasks: COLUMN_VALUES.tasks,
		projects: COLUMN_VALUES.projects,
		sections: COLUMN_VALUES.sections,
		labels: COLUMN_VALUES.labels,
		settings: COLUMN_VALUES.settings,
		access: COLUMN_VALUES.access,
	},
});
