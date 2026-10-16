import { z } from 'zod';
import { dictationChoiceSchema } from '../dictation.ts';
import { labelColorSchema } from '../label-colors.ts';
import { quickAddButtonSchema } from '../quick-add-buttons.ts';
import { pushSubscriptionSchema, scheduledPushSchema } from '../push.ts';
import { isHlc } from '../sync/hlc.ts';
import {
	actorKindSchema,
	dueSchema,
	imageRefSchema,
	prioritySchema,
	recurrenceSchema,
	reminderSchema,
	roleSchema,
	shareTargetKindSchema,
	taskEventSchema,
	taskLocationSchema,
} from '../values.ts';

/**
 * What a column holds when its SQL type says less than the value: a JSON column's shape, or an integer column
 * that only takes some values. `db/schema.ts` types those columns from here, and `scripts/generate` writes the
 * row schemas in `db/generated/zod.ts` with them, so each shape is stated once.
 */

/** `<wall ms>:<counter>:<node>`. Swift checks it with Core's `isHlc`. */
export const hlcSchema = z.string().refine(isHlc, 'Invalid HLC').meta({ id: 'Hlc', 'x-validate': 'isHlc' });
const clocks = z.record(z.string(), hlcSchema);

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
		clocks,
	},
	projects: { clocks },
	sections: { clocks },
	labels: { clocks, color: labelColorSchema },
	comments: { clocks },
	reads: { clocks },
	settings: { clocks, dictation: dictationChoiceSchema, quickAddButtons: z.array(quickAddButtonSchema) },
	log: { fields: z.record(z.string(), z.unknown()) },
	push: { subscription: pushSubscriptionSchema, notifications: z.array(scheduledPushSchema) },
	shares: { targetKind: shareTargetKindSchema, role: roleSchema },
	people: { kind: actorKindSchema },
	images: { bytes: z.instanceof(Uint8Array) },
} as const;

type Values = typeof COLUMN_VALUES;
export type ColumnValue<T extends keyof Values, C extends keyof Values[T]> = Values[T][C] extends z.ZodType
	? z.infer<Values[T][C]>
	: never;
