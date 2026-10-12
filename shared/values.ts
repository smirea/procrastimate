import { z } from 'zod';

/**
 * The values a task stores inside its JSON columns. The tables in `db/schema.ts` hold every entity; these are the
 * shapes no column type can describe, so they are Zod and the tables point their JSON columns at them.
 */

/** Local calendar date, `YYYY-MM-DD`. */
export type DateKey = `${number}-${number}-${number}`;
/** Local wall-clock time, `HH:mm`. */
export type TimeOfDay = `${number}:${number}`;

export const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_OF_DAY_PATTERN = /^\d{2}:\d{2}$/;

/** Custom so the parsed type is the template literal. The metadata is their JSON Schema. */
export const dateKeySchema = z
	.custom<DateKey>(v => typeof v === 'string' && DATE_KEY_PATTERN.test(v))
	.meta({ type: 'string', pattern: DATE_KEY_PATTERN.source });
export const timeOfDaySchema = z
	.custom<TimeOfDay>(v => typeof v === 'string' && TIME_OF_DAY_PATTERN.test(v))
	.meta({ type: 'string', pattern: TIME_OF_DAY_PATTERN.source });

/** Sunday is 0, as in `Date#getDay`. */
export const weekdaySchema = z.literal([0, 1, 2, 3, 4, 5, 6]);
export type Weekday = z.infer<typeof weekdaySchema>;

/** Todoist priorities: 1 is the most urgent, 4 is the unmarked default. */
export const prioritySchema = z.literal([1, 2, 3, 4]);
export type Priority = z.infer<typeof prioritySchema>;
export const DEFAULT_PRIORITY: Priority = 4;

export const dueSchema = z.object({ date: dateKeySchema, time: timeOfDaySchema.nullable() });
export type Due = z.infer<typeof dueSchema>;

const interval = z.number().int().positive();

/**
 * Repeats every `interval` units, counted from the due date. A weekly repeat keeps the due date's weekday, or, with
 * `days`, repeats on each listed weekday of every `interval`-th week. `days` holds two or more weekdays sorted
 * Monday first. Build it with `weeklyOn`, so one day is a plain weekly repeat. `weekday` counts Monday to Friday only.
 */
export const recurrenceSchema = z.discriminatedUnion('unit', [
	z.object({ interval, unit: z.enum(['day', 'weekday', 'month', 'year']) }),
	z.object({ interval, unit: z.literal('week'), days: z.array(weekdaySchema).min(2).readonly().optional() }),
]);
export type Recurrence = z.infer<typeof recurrenceSchema>;
export type RecurrenceUnit = Recurrence['unit'];

export const reminderSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('before'), minutes: z.number().int().nonnegative() }),
	z.object({ kind: z.literal('at'), date: dateKeySchema, time: timeOfDaySchema }),
]);
export type Reminder = z.infer<typeof reminderSchema>;
