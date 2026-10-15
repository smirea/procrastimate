import { implement, ORPCError } from '@orpc/server';
import { accountContract, internalContract } from '../../../shared/api/contract';
import { authenticate, type AccountContext } from '../auth';
import { taskActivity } from './activity';
import { createTask, editTask, finishTask, removeTask, reopen, view } from './commands';
import { deleteMemoTasks, listMemoTasks, putMemoTasks } from './memo-tasks';
import { pushSchedule, refreshPush, subscribePush, unsubscribePush } from './push';
import {
	createShare,
	createToken,
	deleteShare,
	deleteToken,
	listShares,
	listSpaces,
	listTokens,
	recordMembership,
	resolveToken,
	revokeAi,
	sharedView,
} from './sharing';
import { guestSync, sync } from './sync';

export type AccountRequestContext = AccountContext & { request: Request };

const os = implement({ ...accountContract, internal: internalContract }).$context<AccountRequestContext>();

/**
 * The human owner on one of their own devices, registered on first use. A revoked device is not signed in. Guests
 * and AI accounts have no device here; the routes they may call take `member` instead.
 */
const owner = os.middleware(async ({ context, next }) => {
	if (context.access.role !== 'owner' || context.actor.kind !== 'human') {
		throw new ORPCError('FORBIDDEN', { message: 'Only the owner can do this' });
	}
	const deviceId = await authenticate(context.request, context);
	if (!deviceId) throw new ORPCError('UNAUTHORIZED', { message: 'Not signed in' });
	return next({ context: { deviceId } });
});

const commands = (context: AccountContext) => ({
	store: context.store,
	now: context.now,
	actor: context.actor.id,
	access: context.access,
});

/** Writes through the command API replan the owner's notifications like a sync does. */
async function moved<T>(context: AccountContext, run: () => T): Promise<T> {
	const head = context.store.lastSeq();
	const result = run();
	if (context.store.lastSeq() > head) await refreshPush(context);
	return result;
}

export const accountRouter = os.router({
	sync: os.sync.handler(async ({ input, context }) => {
		const { store, now, actor, access } = context;
		let response;
		if (access.role === 'owner') {
			if (actor.kind === 'human' && !(await authenticate(context.request, context))) {
				throw new ORPCError('UNAUTHORIZED', { message: 'Not signed in' });
			}
			response = sync(store, input.body, now, actor.id);
		} else {
			response = guestSync(store, input.body, now, actor.id, access.shares);
		}
		if (input.body.ops.length) await refreshPush(context);
		return response;
	}),
	spaces: {
		list: os.spaces.list.use(owner).handler(({ context }) => ({ spaces: listSpaces(context.store) })),
	},
	shares: {
		list: os.shares.list.use(owner).handler(({ context }) => ({ shares: listShares(context) })),
		delete: os.shares.delete.use(owner).handler(({ input, context }) => {
			deleteShare(context, input.query.id);
			return { ok: true as const };
		}),
	},
	tokens: {
		list: os.tokens.list.use(owner).handler(({ context }) => ({ tokens: listTokens(context.store) })),
		create: os.tokens.create
			.use(owner)
			.handler(({ input, context }) => createToken(context, input.aiUserId, input.name)),
		delete: os.tokens.delete.use(owner).handler(({ input, context }) => {
			deleteToken(context.store, input.query.id);
			return { ok: true as const };
		}),
	},
	activity: {
		list: os.activity.list.handler(({ input, context }) => {
			const visible = view(commands(context));
			if (!visible.tasks.some(task => task.id === input.query.id)) {
				throw new ORPCError('NOT_FOUND', { message: 'No such task' });
			}
			return { entries: taskActivity(context.store, input.query.id) };
		}),
	},
	view: os.view.handler(({ context }) => view(commands(context))),
	tasks: {
		create: os.tasks.create.handler(({ input, context }) =>
			moved(context, () => createTask(commands(context), input.body)),
		),
		update: os.tasks.update.handler(({ input, context }) =>
			moved(context, () => editTask(commands(context), input.query.id, input.body)),
		),
		complete: os.tasks.complete.handler(({ input, context }) =>
			moved(context, () => finishTask(commands(context), input.query.id)),
		),
		reopen: os.tasks.reopen.handler(({ input, context }) =>
			moved(context, () => reopen(commands(context), input.query.id)),
		),
		delete: os.tasks.delete.handler(async ({ input, context }) => {
			await moved(context, () => removeTask(commands(context), input.query.id));
			return { ok: true as const };
		}),
	},
	push: {
		subscribe: os.push.subscribe.use(owner).handler(async ({ input, context }) => {
			await subscribePush(context, context.deviceId, input.subscription);
			return { ok: true as const };
		}),
		unsubscribe: os.push.unsubscribe.use(owner).handler(async ({ context }) => {
			await unsubscribePush(context, context.deviceId);
			return { ok: true as const };
		}),
		schedule: os.push.schedule.use(owner).handler(({ context }) => pushSchedule(context.store, context.deviceId)),
	},
	memoTasks: {
		list: os.memoTasks.list
			.use(owner)
			.handler(({ input, context }) => listMemoTasks(context.store, input.query.memoId)),
		put: os.memoTasks.put
			.use(owner)
			.handler(({ input, context }) =>
				moved(context, () => putMemoTasks(context.store, input, context.now, context.actor.id)),
			),
		delete: os.memoTasks.delete.use(owner).handler(async ({ input, context }) => {
			await moved(context, () => deleteMemoTasks(context.store, input.query.memoId, context.now, context.actor.id));
			return { ok: true as const };
		}),
	},
	internal: {
		wipe: os.internal.wipe.handler(({ context }) => {
			context.store.clearAccount();
			return { ok: true as const };
		}),
		membership: os.internal.membership.handler(({ input, context }) => {
			recordMembership(context.store, input.spaceId, input.owner, input.live, context.now);
			// A membership never moves this space's log, so the open clients hear about it here or not until they
			// list their spaces again.
			context.realtime.nudge(context.store.lastSeq(), input.spaceId);
			return { ok: true as const };
		}),
		// The nudge never reaches the router: the object answers it before the serial queue. See `account.ts`.
		nudge: os.internal.nudge.handler(() => ({ ok: true as const })),
		resolveToken: os.internal.resolveToken.handler(async ({ input, context }) => ({
			aiUserId: await resolveToken(context.store, input.secret, context.now),
		})),
		share: os.internal.share.handler(({ input, context }) =>
			createShare(context, input.target, input.grantee, input.role),
		),
		revokeAi: os.internal.revokeAi.handler(({ input, context }) => {
			revokeAi(context.store, input.aiUserId);
			return { ok: true as const };
		}),
		people: os.internal.people.handler(({ context }) => ({
			people: context.store.people().map(({ id, name, kind, ownerId }) => ({ id, name, kind, ownerId })),
		})),
		sharedView: os.internal.sharedView.handler(({ input, context }) =>
			sharedView(context.store, context.space, input.id),
		),
	},
});
