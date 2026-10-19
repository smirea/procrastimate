import { z } from 'zod';
import { dictationChoiceSchema } from '../dictation.ts';
import { labelColorSchema } from '../label-colors.ts';
import { quickAddButtonSchema } from '../quick-add-buttons.ts';
import { scheduledNotificationSchema } from '../notifications.ts';
import { pushSubscriptionSchema } from '../push.ts';
import {
	clientSchema,
	dueSchema,
	imageRefSchema,
	prioritySchema,
	recurrenceSchema,
	reminderSchema,
	roleSchema,
	savedPlaceSchema,
	shareTargetKindSchema,
	taskEventSchema,
	taskLocationSchema,
} from '../values.ts';

/**
 * What a column holds when its SQL type says less than the value: a JSON column's shape, or an integer column
 * that only takes some values. `db/schema.ts` types those columns from here, and `scripts/generate` writes the
 * row schemas in `db/generated/zod.ts` with them, so each shape is stated once.
 */

export const COLUMN_VALUES = {
	tasks: {
		labelIds: z.array(z.string()),
		due: dueSchema,
		recurrence: recurrenceSchema,
		priority: prioritySchema,
		reminders: z.array(reminderSchema),
		location: taskLocationSchema,
		event: taskEventSchema,
		images: z.array(imageRefSchema),
	},
	labels: { color: labelColorSchema, place: savedPlaceSchema },
	settings: { dictation: dictationChoiceSchema, quickAddButtons: z.array(quickAddButtonSchema) },
	access: { role: roleSchema },
	log: { fields: z.record(z.string(), z.unknown()), client: clientSchema },
	push: { subscription: pushSubscriptionSchema, notifications: z.array(scheduledNotificationSchema) },
	shares: { targetKind: shareTargetKindSchema, role: roleSchema },
	images: { bytes: z.instanceof(Uint8Array) },
} as const;

type Values = typeof COLUMN_VALUES;
export type ColumnValue<T extends keyof Values, C extends keyof Values[T]> = Values[T][C] extends z.ZodType
	? z.infer<Values[T][C]>
	: never;
