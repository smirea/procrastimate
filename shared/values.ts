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

/**
 * Custom so the parsed type is the template literal. The metadata is their JSON Schema. Every `id` names the type in
 * the OpenAPI document and in Swift, and `x-` keys tell the Swift generator how to shape it.
 */
export const dateKeySchema = z
	.custom<DateKey>(v => typeof v === 'string' && DATE_KEY_PATTERN.test(v))
	.meta({
		id: 'DateKey',
		description: 'Local calendar date, `YYYY-MM-DD`.',
		type: 'string',
		pattern: DATE_KEY_PATTERN.source,
	});
export const timeOfDaySchema = z
	.custom<TimeOfDay>(v => typeof v === 'string' && TIME_OF_DAY_PATTERN.test(v))
	.meta({
		id: 'TimeOfDay',
		description: 'Local wall-clock time, `HH:mm`.',
		type: 'string',
		pattern: TIME_OF_DAY_PATTERN.source,
	});

/** Sunday is 0, as in `Date#getDay`. */
export const weekdaySchema = z
	.literal([0, 1, 2, 3, 4, 5, 6])
	.meta({ id: 'Weekday', description: 'Sunday is 0, as in `Date#getDay`.' });
export type Weekday = z.infer<typeof weekdaySchema>;

export const DEFAULT_PRIORITY = 4;

/** Todoist priorities: 1 is the most urgent, 4 is the unmarked default. */
export const prioritySchema = z.literal([1, 2, 3, DEFAULT_PRIORITY]).meta({
	id: 'Priority',
	description: 'Todoist priorities: 1 is the most urgent, 4 is the unmarked default.',
	default: DEFAULT_PRIORITY,
	'x-enum-names': ['p1', 'p2', 'p3', 'p4'],
});
export type Priority = z.infer<typeof prioritySchema>;

export const dueSchema = z.object({ date: dateKeySchema, time: timeOfDaySchema.nullable() }).meta({ id: 'Due' });
export type Due = z.infer<typeof dueSchema>;

const interval = z.number().int().positive();

/** `weekday` counts Monday to Friday only. */
export const recurrenceUnitSchema = z.enum(['day', 'weekday', 'week', 'month', 'year']).meta({ id: 'RecurrenceUnit' });

/**
 * Repeats every `interval` units, counted from the due date. A weekly repeat keeps the due date's weekday, or, with
 * `days`, repeats on each listed weekday of every `interval`-th week. `days` holds two or more weekdays sorted
 * Monday first. Build it with `weeklyOn`, so one day is a plain weekly repeat.
 */
export const recurrenceSchema = z
	.discriminatedUnion('unit', [
		z.object({ interval, unit: recurrenceUnitSchema.exclude(['week']) }),
		z.object({ interval, unit: z.literal('week'), days: z.array(weekdaySchema).min(2).readonly().optional() }),
	])
	// Swift keeps one struct whose `days` only a weekly repeat sets, which reads better than an enum of two.
	.meta({ id: 'Recurrence', 'x-flatten': { unit: 'RecurrenceUnit' } });
export type Recurrence = z.infer<typeof recurrenceSchema>;
export type RecurrenceUnit = z.infer<typeof recurrenceUnitSchema>;

export const reminderSchema = z
	.discriminatedUnion('kind', [
		z.object({ kind: z.literal('before'), minutes: z.number().int().nonnegative() }),
		z.object({ kind: z.literal('at'), date: dateKeySchema, time: timeOfDaySchema }),
	])
	// Each case is small, so Swift carries its fields inline: `.before(minutes:)` and `.at(date:time:)`.
	.meta({ id: 'Reminder', 'x-inline': true });
export type Reminder = z.infer<typeof reminderSchema>;
