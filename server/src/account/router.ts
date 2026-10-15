import { implement, ORPCError } from '@orpc/server';
import { USER_HEADER } from '../../../shared/auth';
import { accountContract, internalContract } from '../../../shared/api/contract';
import { authenticate, type AccountContext } from '../auth';
import { notImplemented } from '../errors';
import { deleteMemoTasks, listMemoTasks, putMemoTasks } from './memo-tasks';
import { pushSchedule, refreshPush, subscribePush, unsubscribePush } from './push';
import { sync } from './sync';

export type AccountRequestContext = AccountContext & { request: Request };

const os = implement({ ...accountContract, internal: internalContract }).$context<AccountRequestContext>();

/**
 * The device the request names, registered on first use. A revoked device is not signed in. `actorId` is the user
 * the Worker vouched for, whom the log names as the author of every op the request writes.
 */
const device = os.middleware(async ({ context, next }) => {
	const deviceId = await authenticate(context.request, context);
	const actorId = context.request.headers.get(USER_HEADER);
	if (!deviceId || !actorId) throw new ORPCError('UNAUTHORIZED', { message: 'Not signed in' });
	return next({ context: { deviceId, actorId } });
});

export const accountRouter = os.router({
	sync: os.sync.use(device).handler(async ({ input, context }) => {
		const response = sync(context.store, input.body, context.now, context.actorId);
		if (input.body.ops.length) await refreshPush(context);
		return response;
	}),
	spaces: {
		list: os.spaces.list.handler(notImplemented),
	},
	shares: {
		list: os.shares.list.handler(notImplemented),
		create: os.shares.create.handler(notImplemented),
		delete: os.shares.delete.handler(notImplemented),
	},
	tokens: {
		list: os.tokens.list.handler(notImplemented),
		create: os.tokens.create.handler(notImplemented),
		delete: os.tokens.delete.handler(notImplemented),
	},
	activity: {
		list: os.activity.list.handler(notImplemented),
	},
	view: os.view.handler(notImplemented),
	tasks: {
		create: os.tasks.create.handler(notImplemented),
		update: os.tasks.update.handler(notImplemented),
		complete: os.tasks.complete.handler(notImplemented),
		reopen: os.tasks.reopen.handler(notImplemented),
		delete: os.tasks.delete.handler(notImplemented),
	},
	push: {
		subscribe: os.push.subscribe.use(device).handler(async ({ input, context }) => {
			await subscribePush(context, context.deviceId, input.subscription);
			return { ok: true as const };
		}),
		unsubscribe: os.push.unsubscribe.use(device).handler(async ({ context }) => {
			await unsubscribePush(context, context.deviceId);
			return { ok: true as const };
		}),
		schedule: os.push.schedule.use(device).handler(({ context }) => pushSchedule(context.store, context.deviceId)),
	},
	memoTasks: {
		list: os.memoTasks.list
			.use(device)
			.handler(({ input, context }) => listMemoTasks(context.store, input.query.memoId)),
		put: os.memoTasks.put.use(device).handler(async ({ input, context }) => {
			const head = context.store.lastSeq();
			const response = putMemoTasks(context.store, input, context.now, context.actorId);
			if (context.store.lastSeq() > head) await refreshPush(context);
			return response;
		}),
		delete: os.memoTasks.delete.use(device).handler(async ({ input, context }) => {
			const head = context.store.lastSeq();
			deleteMemoTasks(context.store, input.query.memoId, context.now, context.actorId);
			if (context.store.lastSeq() > head) await refreshPush(context);
			return { ok: true as const };
		}),
	},
	internal: {
		wipe: os.internal.wipe.handler(({ context }) => {
			if (!context.request.headers.get(USER_HEADER)) throw new ORPCError('UNAUTHORIZED');
			context.store.clearAccount();
			return { ok: true as const };
		}),
		membership: os.internal.membership.handler(notImplemented),
		nudge: os.internal.nudge.handler(notImplemented),
		resolveToken: os.internal.resolveToken.handler(notImplemented),
	},
});
