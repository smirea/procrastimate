import { implement, ORPCError } from '@orpc/server';
import { USER_HEADER } from '../../../shared/auth';
import { accountContract, internalContract } from '../../../shared/api/contract';
import { authenticate, type AccountContext } from '../auth';
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
	internal: {
		wipe: os.internal.wipe.handler(({ context }) => {
			if (!context.request.headers.get(USER_HEADER)) throw new ORPCError('UNAUTHORIZED');
			context.store.clearAccount();
			return { ok: true as const };
		}),
	},
});
