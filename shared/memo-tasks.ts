import { z } from 'zod';
import { taskSchema } from './model.ts';
import { taskEventSchema } from './values.ts';

/**
 * Tasks Notouroboros extracts from a memo. Nothing but the task's `sourceKey`, `voicememo:<memoId>:<taskKey>`,
 * marks one, so every client derives the memo link from the key. See `docs/decisions/integrations.md`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PREFIX = 'voicememo:';

const uuidSchema = z.string().regex(UUID, 'a lowercase UUID');

export const memoSourceSchema = z.object({ memoId: uuidSchema, taskKey: uuidSchema }).meta({ id: 'MemoSource' });
export type MemoSource = z.infer<typeof memoSourceSchema>;

export const memoSourceKey = ({ memoId, taskKey }: MemoSource) => `${PREFIX}${memoId}:${taskKey}`;

export function parseMemoSource(sourceKey: string | null | undefined): MemoSource | null {
	if (!sourceKey?.startsWith(PREFIX)) return null;
	const [memoId, taskKey, ...rest] = sourceKey.slice(PREFIX.length).split(':');
	if (rest.length || !memoId || !taskKey || !UUID.test(memoId) || !UUID.test(taskKey)) return null;
	return { memoId, taskKey };
}

export const memoTaskInputSchema = z
	.object({
		key: uuidSchema,
		title: taskSchema.shape.title.min(1),
		notes: taskSchema.shape.notes,
		/** The spoken time phrase, such as `tomorrow at 3pm`. Only the due date and repeat it names are kept. */
		when: z.string().nullable(),
		/** The memo's calendar event, set only when the memo ties the task to it. It replaces `when`. */
		event: taskEventSchema.nullable(),
	})
	.meta({ id: 'MemoTaskInput' });
export type MemoTaskInput = z.infer<typeof memoTaskInputSchema>;

export const memoTasksRequestSchema = z
	.object({
		memoId: uuidSchema,
		/** When the memo was recorded, in epoch milliseconds. `when` is read as of this moment. */
		recordedAt: z.number().int(),
		tasks: z.array(memoTaskInputSchema),
	})
	.meta({ id: 'MemoTasksRequest' });
export type MemoTasksRequest = z.infer<typeof memoTasksRequestSchema>;

export const memoTaskSchema = z
	.object({
		key: uuidSchema,
		id: taskSchema.shape.id,
		title: taskSchema.shape.title,
		completedAt: taskSchema.shape.completedAt,
		due: taskSchema.shape.due,
		event: taskSchema.shape.event,
	})
	.meta({ id: 'MemoTask' });
export type MemoTask = z.infer<typeof memoTaskSchema>;

/** A memo's live tasks in the order they were sent, completed ones included. */
export const memoTasksSchema = z.object({ tasks: z.array(memoTaskSchema) }).meta({ id: 'MemoTasks' });
export type MemoTasks = z.infer<typeof memoTasksSchema>;

/** `GET` and `DELETE` name the memo in the query, since the account router matches exact paths. */
export const memoQuerySchema = z.object({ query: z.object({ memoId: uuidSchema }) });
