import { implement, ORPCError } from '@orpc/server';
import { USER_HEADER } from '../../../shared/auth';
import { accountContract, internalContract } from '../../../shared/api/contract';
import { authenticate, type AccountContext } from '../auth';
import { deleteMemoTasks, listMemoTasks, putMemoTasks } from './memo-tasks';
import { pushSchedule, refreshPush, subscribePush, unsubscribePush } from './push';
import { sync } from './sync';

export type AccountRequestContext = AccountContext & { request: Request };

const os = implement({ ...accountContract, internal: internalContract }).$context<AccountRequestContext>();

/** The device the request names, registered on first use. A revoked device is not signed in. */
const device = os.middleware(async ({ context, next }) => {
	const deviceId = await authenticate(context.request, context);
	if (!deviceId) throw new ORPCError('UNAUTHORIZED', { message: 'Not signed in' });
	return next({ context: { deviceId } });
});

export const accountRouter = os.router({
	sync: os.sync.use(device).handler(async ({ input, context }) => {
		const response = sync(context.store, input, context.now);
		if (input.ops.length) await refreshPush(context);
		return response;
	}),
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
			const response = putMemoTasks(context.store, input, context.now);
			if (context.store.lastSeq() > head) await refreshPush(context);
			return response;
		}),
		delete: os.memoTasks.delete.use(device).handler(async ({ input, context }) => {
			const head = context.store.lastSeq();
			deleteMemoTasks(context.store, input.query.memoId, context.now);
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
	},
});
