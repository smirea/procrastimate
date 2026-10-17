import { z } from 'zod';

/**
 * The values a task stores inside its JSON columns. The tables in `db/schema.ts` hold every entity; these are the
 * shapes no column type can describe, so they are Zod and the tables point their JSON columns at them.
 */

/** Local calendar date, `YYYY-MM-DD`. */
export type DateKey = `${number}-${number}-${number}`;
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

/**
 * The longest repeat. Larger intervals stepped dates past 9999-12-31, or to `NaN`, which the server rejects along with
 * the rest of the device's outbox, and overflowed Swift's month math.
 */
export const MAX_RECURRENCE_INTERVAL = 999;

const interval = z.number().int().positive().max(MAX_RECURRENCE_INTERVAL);

/** The `week`-th `weekday` of a month, from the 1st to the 4th, or the last one when `week` is -1. */
export const nthWeekdaySchema = z
	.object({ week: z.literal([1, 2, 3, 4, -1]), weekday: weekdaySchema })
	.meta({ id: 'NthWeekday' });
export type NthWeekday = z.infer<typeof nthWeekdaySchema>;

/** `weekday` counts Monday to Friday only. */
export const recurrenceUnitSchema = z.enum(['day', 'weekday', 'week', 'month', 'year']).meta({ id: 'RecurrenceUnit' });

/**
 * Repeats every `interval` units, counted from the due date. A weekly repeat keeps the due date's weekday, or, with
 * `days`, repeats on each listed weekday of every `interval`-th week. `days` holds two or more weekdays sorted
 * Monday first. Build it with `weeklyOn`, so one day is a plain weekly repeat. A monthly repeat with `day` lands on
 * that day of the month, or on the last day of a month that lacks it, so a repeat on the 31st returns to the 31st
 * after February. One with `nth` lands on that weekday of the month, as in the 3rd Monday. It sets one of the two.
 */
export const recurrenceSchema = z
	.discriminatedUnion('unit', [
		z.object({ interval, unit: recurrenceUnitSchema.exclude(['week', 'month']) }),
		z.object({ interval, unit: z.literal('week'), days: z.array(weekdaySchema).min(2).readonly().optional() }),
		z
			.object({
				interval,
				unit: z.literal('month'),
				day: z.number().int().min(1).max(31).optional(),
				nth: nthWeekdaySchema.optional(),
			})
			.refine(r => r.day === undefined || r.nth === undefined, 'A monthly repeat sets `day` or `nth`, not both'),
	])
	// Swift keeps one struct whose `days`, `day`, and `nth` only their unit sets, which reads better than an enum of three.
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

/** What a place does for its task: notify on arrival, notify on leaving, or show the task while there. */
export const locationTriggerSchema = z.enum(['arrive', 'leave', 'during']).meta({ id: 'LocationTrigger' });
export type LocationTrigger = z.infer<typeof locationTriggerSchema>;

/**
 * A place picked from Apple Maps. iOS watches a circle of `radius` meters around it. `fittedRadius` is the radius iOS
 * fitted to the Apple Maps result at pick time, kept so the radius editor can go back to it; places picked before it
 * existed lack it.
 */
export const taskLocationSchema = z
	.object({
		name: z.string(),
		address: z.string().nullable(),
		latitude: z.number().min(-90).max(90),
		longitude: z.number().min(-180).max(180),
		radius: z.number().positive(),
		fittedRadius: z.number().positive().optional(),
		trigger: locationTriggerSchema,
	})
	.meta({ id: 'TaskLocation' });
export type TaskLocation = z.infer<typeof taskLocationSchema>;

/** Where a task sits relative to its calendar event: `minutes` before the start, at the start, while it runs, or `minutes` after the end. */
export const eventEdgeSchema = z.enum(['before', 'start', 'during', 'after']).meta({ id: 'EventEdge' });
export type EventEdge = z.infer<typeof eventEdgeSchema>;

const epochMs = z.number().int();

/** `original` is EventKit's occurrence date, the start the calendar first gave it, which stays put when it moves. */
export const eventOccurrenceSchema = z
	.object({ start: epochMs, end: epochMs, original: epochMs })
	.meta({ id: 'EventOccurrence' });
export type EventOccurrence = z.infer<typeof eventOccurrenceSchema>;

/**
 * A calendar event a task hangs off instead of a due date. iOS reads the calendar and rewrites `title` and
 * `occurrences` whenever the event moves, so every client and the push server see current times. `id` is EventKit's
 * external identifier, which every occurrence of a repeating event shares. A task that follows the `series` lists
 * its upcoming occurrences, soonest first; any other task lists its one occurrence. Each occurrence's original start
 * finds it again after it moves.
 */
export const taskEventSchema = z
	.object({
		id: z.string(),
		title: z.string(),
		allDay: z.boolean(),
		series: z.boolean(),
		edge: eventEdgeSchema,
		minutes: z.number().int().nonnegative(),
		occurrences: z.array(eventOccurrenceSchema).min(1),
	})
	.meta({ id: 'TaskEvent' });
export type TaskEvent = z.infer<typeof taskEventSchema>;

/**
 * An image attached to a task. The task carries only this; the bytes are stored on the server by `id` and fetched on
 * their own, so the synced document never holds them. `width` and `height` are the full image's pixels, so a client
 * lays it out before the bytes arrive.
 */
export const imageRefSchema = z
	.object({ id: z.string().min(1), width: z.number().int().positive(), height: z.number().int().positive() })
	.meta({ id: 'ImageRef' });
export type ImageRef = z.infer<typeof imageRefSchema>;

/** A human signs in. An AI account belongs to a human and acts only through API tokens. */
export const ACTOR_KINDS = ['human', 'ai'] as const;
export const actorKindSchema = z.enum(ACTOR_KINDS).meta({ id: 'ActorKind' });
export type ActorKind = z.infer<typeof actorKindSchema>;

export const CLIENT_KINDS = ['web', 'ios', 'api'] as const;
export const clientKindSchema = z
	.enum(CLIENT_KINDS)
	.meta({ id: 'ClientKind', description: '`api` is anything but the apps: the agent API, curl, or an integration.' });
export type ClientKind = z.infer<typeof clientKindSchema>;

/**
 * The app, version, device, OS, and time zone that sent a request, which the server records on every op it writes.
 * `api` callers fill only `device`, from their `User-Agent`.
 */
export const clientSchema = z
	.object({
		kind: clientKindSchema,
		version: z.string().max(100).nullable().meta({ description: 'The app version and build, such as `1.4 (212)`.' }),
		device: z.string().max(200).nullable().meta({ description: 'Such as `iPhone17,1` or `Chrome`.' }),
		os: z.string().max(100).nullable().meta({ description: 'Such as `iOS 27.0` or `macOS`.' }),
		timeZone: z.string().max(100).nullable().meta({ description: "The device's IANA time zone." }),
	})
	.meta({ id: 'Client' });
export type Client = z.infer<typeof clientSchema>;

/** The actor of a log row the server wrote on its own, such as a fixup. Activity never shows it. */
export const SERVER_ACTOR = 'server';

/** A link share is always `view`. */
export const ROLES = ['view', 'edit'] as const;
export const roleSchema = z.enum(ROLES).meta({ id: 'Role' });
export type Role = z.infer<typeof roleSchema>;

/** `space` is the owner's whole space, offered only to AI accounts. */
export const SHARE_TARGET_KINDS = ['space', 'project', 'label', 'task'] as const;
export const shareTargetKindSchema = z.enum(SHARE_TARGET_KINDS).meta({ id: 'ShareTargetKind' });
export type ShareTargetKind = z.infer<typeof shareTargetKindSchema>;
