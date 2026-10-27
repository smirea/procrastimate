import { z } from 'zod';
import { dateKeySchema, timeOfDaySchema } from '../values.ts';

/**
 * What the language model returns for a ramble: the tasks the speaker meant once their corrections apply, with each
 * field as a short phrase or an existing name. The client resolves phrases to dates and names to ids
 * (`resolveOutline`), so the model never picks an id or does date math.
 */
export type RambleOutlineTask = {
	title: string;
	/** The due date, time, and repeat as a short English phrase such as `tomorrow at 4pm` or `every monday`, or empty. */
	when: string;
	/** A reminder as `30 minutes before` or `at 9am`, or empty. */
	reminder: string;
	/** 1 is the most urgent. 0 when the speaker set none. */
	priority: number;
	/** An existing project's name, or empty. */
	project: string;
	labels: string[];
	notes: string;
	subtasks: RambleOutlineTask[];
};

export const rambleOutlineTaskSchema: z.ZodType<RambleOutlineTask> = z
	.object({
		title: z.string(),
		when: z.string(),
		reminder: z.string(),
		priority: z.number().int().min(0).max(4),
		project: z.string(),
		labels: z.array(z.string()),
		notes: z.string(),
		get subtasks(): z.ZodArray<z.ZodType<RambleOutlineTask>> {
			return z.array(rambleOutlineTaskSchema);
		},
	})
	.meta({
		id: 'RambleOutlineTask',
		description:
			'A task the model read from a ramble. Fields are phrases and names, empty when unsaid; `resolveOutline` turns them into a `RambleTask`.',
	});

export const RAMBLE_OUTLINE_MAX_TRANSCRIPT = 12_000;

export const rambleOutlineInputSchema = z
	.object({
		transcript: z.string().min(1).max(RAMBLE_OUTLINE_MAX_TRANSCRIPT),
		/** The speaker's local date and time, which relative phrases count from. */
		today: dateKeySchema,
		time: timeOfDaySchema,
		projects: z.array(z.string().max(200)),
		labels: z.array(z.string().max(200)),
	})
	.meta({ id: 'RambleOutlineInput' });
export type RambleOutlineInput = z.infer<typeof rambleOutlineInputSchema>;

export const rambleOutlineSchema = z.object({ tasks: z.array(rambleOutlineTaskSchema) }).meta({ id: 'RambleOutline' });
export type RambleOutline = z.infer<typeof rambleOutlineSchema>;
