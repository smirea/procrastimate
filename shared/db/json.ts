import { z } from 'zod';
import { pushSubscriptionSchema, scheduledPushSchema } from '../push.ts';
import { isHlc } from '../sync/hlc.ts';
import { dueSchema, prioritySchema, recurrenceSchema, reminderSchema } from '../values.ts';

/**
 * What a column holds when its SQL type says less than the value: a JSON column's shape, or an integer column
 * that only takes some values. `db/schema.ts` types those columns from here, and `scripts/generate` writes the
 * row schemas in `db/generated/zod.ts` with them, so each shape is stated once.
 */

export const hlcSchema = z.string().refine(isHlc, 'Invalid HLC');
const clocks = z.record(z.string(), hlcSchema);

export const COLUMN_VALUES = {
	tasks: {
		labelIds: z.array(z.string()),
		due: dueSchema,
		recurrence: recurrenceSchema,
		priority: prioritySchema,
		reminders: z.array(reminderSchema),
		clocks,
	},
	projects: { clocks },
	labels: { clocks },
	settings: { clocks },
	log: { fields: z.record(z.string(), z.unknown()) },
	push: { subscription: pushSubscriptionSchema, notifications: z.array(scheduledPushSchema) },
} as const;

type Values = typeof COLUMN_VALUES;
export type ColumnValue<T extends keyof Values, C extends keyof Values[T]> = Values[T][C] extends z.ZodType
	? z.infer<Values[T][C]>
	: never;
