import { OpenAPIGenerator } from '@orpc/openapi';
import { z } from 'zod';
import { ZodToJsonSchemaConverter } from '@orpc/zod';
import {
	authMethodsSchema,
	contract,
	okSchema,
	pushKeySchema,
	pushScheduleResponseSchema,
} from '../../shared/api/contract';
import { pushSubscriptionSchema, scheduledPushSchema } from '../../shared/push';
import {
	changeSchema,
	labelSchema,
	opSchema,
	PATCH_SCHEMAS,
	projectSchema,
	settingsSchema,
	snapshotSchema,
	syncRequestSchema,
	syncResponseSchema,
	taskSchema,
} from '../../shared/sync/protocol';
import { dueSchema, recurrenceSchema, reminderSchema } from '../../shared/values';

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
