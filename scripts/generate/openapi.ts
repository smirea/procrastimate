import { OpenAPIGenerator } from '@orpc/openapi';
import { z } from 'zod';
import { JSON_SCHEMA_REGISTRY, ZodToJsonSchemaConverter } from '@orpc/zod';
import { authMethodsSchema, contract, okSchema, pushKeySchema } from '../../shared/api/contract';
import { pushScheduleResponseSchema, pushSubscriptionSchema, scheduledPushSchema } from '../../shared/push';
import {
	changeSchema,
	DATE_KEY_PATTERN,
	dateKeySchema,
	dueSchema,
	labelSchema,
	opSchema,
	PATCH_SCHEMAS,
	projectSchema,
	recurrenceSchema,
	reminderSchema,
	settingsSchema,
	snapshotSchema,
	syncRequestSchema,
	syncResponseSchema,
	taskSchema,
	TIME_OF_DAY_PATTERN,
	timeOfDaySchema,
} from '../../shared/sync/protocol';

// The converter merges these into its `{ not: {} }` for a custom schema, so `not` has to be cleared.
JSON_SCHEMA_REGISTRY.add(dateKeySchema, { not: undefined, type: 'string', pattern: DATE_KEY_PATTERN.source });
JSON_SCHEMA_REGISTRY.add(timeOfDaySchema, { not: undefined, type: 'string', pattern: TIME_OF_DAY_PATTERN.source });

/** Component names. zod's JSON Schema output turns an `id` into a `$defs` entry, which oRPC hoists into components. */
const COMPONENTS: [z.ZodType, string][] = [
	[authMethodsSchema, 'AuthMethods'],
	[changeSchema, 'Change'],
	[dueSchema, 'Due'],
	[labelSchema, 'Label'],
	[PATCH_SCHEMAS.label, 'LabelPatch'],
	[okSchema, 'Ok'],
	[opSchema, 'Op'],
	[projectSchema, 'Project'],
	[PATCH_SCHEMAS.project, 'ProjectPatch'],
	[pushKeySchema, 'PushKey'],
	[pushScheduleResponseSchema, 'PushSchedule'],
	[pushSubscriptionSchema, 'PushSubscription'],
	[recurrenceSchema, 'Recurrence'],
	[reminderSchema, 'Reminder'],
	[scheduledPushSchema, 'ScheduledPush'],
	[settingsSchema, 'Settings'],
	[PATCH_SCHEMAS.settings, 'SettingsPatch'],
	[snapshotSchema, 'Snapshot'],
	[syncRequestSchema, 'SyncRequest'],
	[syncResponseSchema, 'SyncResponse'],
	[taskSchema, 'Task'],
	[PATCH_SCHEMAS.task, 'TaskPatch'],
];
for (const [schema, id] of COMPONENTS) z.globalRegistry.add(schema, { id });

export async function openApiDocument() {
	const generator = new OpenAPIGenerator({ converters: [new ZodToJsonSchemaConverter()] });
	return generator.generate(contract, {
		version: '3.1.1',
		base: { info: { title: 'Procrastimate', version: '1' } },
	});
}
