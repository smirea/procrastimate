import { OpenAPIGenerator } from '@orpc/openapi';
import { JSON_SCHEMA_REGISTRY, ZodToJsonSchemaConverter } from '@orpc/zod/zod4';
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

export async function openApiDocument() {
	const generator = new OpenAPIGenerator({ schemaConverters: [new ZodToJsonSchemaConverter()] });
	return generator.generate(contract, {
		info: { title: 'Procrastimate', version: '1' },
		commonSchemas: {
			AuthMethods: { schema: authMethodsSchema },
			Change: { schema: changeSchema },
			Due: { schema: dueSchema },
			Label: { schema: labelSchema },
			LabelPatch: { schema: PATCH_SCHEMAS.label },
			Ok: { schema: okSchema },
			Op: { schema: opSchema },
			Project: { schema: projectSchema },
			ProjectPatch: { schema: PATCH_SCHEMAS.project },
			PushKey: { schema: pushKeySchema },
			PushSchedule: { schema: pushScheduleResponseSchema },
			PushSubscription: { schema: pushSubscriptionSchema },
			Recurrence: { schema: recurrenceSchema },
			Reminder: { schema: reminderSchema },
			ScheduledPush: { schema: scheduledPushSchema },
			Settings: { schema: settingsSchema },
			SettingsPatch: { schema: PATCH_SCHEMAS.settings },
			Snapshot: { schema: snapshotSchema },
			SyncRequest: { schema: syncRequestSchema, strategy: 'input' },
			SyncResponse: { schema: syncResponseSchema, strategy: 'output' },
			Task: { schema: taskSchema },
			TaskPatch: { schema: PATCH_SCHEMAS.task },
		},
	});
}
