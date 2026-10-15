import { implement } from '@orpc/server';
import { workerContract } from '../../shared/api/contract';
import { authMethods, deleteAccount, requireUser } from './better-auth';
import type { Env } from './bindings';
import { notImplemented } from './errors';
import { classifyDelivery } from './push-schedule';
import { requireVapid, sendTestPush } from './push';

const os = implement(workerContract).$context<{ env: Env; request: Request }>();

/** The contract's procedures the Worker serves itself. The rest run in the user's `Account` object. */
export const workerRouter = os.router({
	status: os.status.handler(() => ({ ok: true as const })),
	auth: {
		methods: os.auth.methods.handler(({ context }) => authMethods(context.env)),
	},
	account: {
		delete: os.account.delete.handler(async ({ context }) => {
			await deleteAccount(context.request, context.env);
			return { ok: true as const };
		}),
	},
	push: {
		key: os.push.key.handler(({ context }) => ({ publicKey: requireVapid(context.env).publicKey })),
		test: os.push.test.handler(async ({ input, context, errors }) => {
			const vapid = requireVapid(context.env);
			await requireUser(context.request, context.env);
			const status = await sendTestPush(input.subscription, vapid);
			if (status !== null && status >= 200 && status < 300) return { ok: true as const };
			const data = { status };
			throw classifyDelivery(status) === 'gone' ? errors.GONE({ data }) : errors.BAD_GATEWAY({ data });
		}),
	},
	people: {
		search: os.people.search.handler(notImplemented),
	},
	me: os.me.handler(notImplemented),
	ai: {
		list: os.ai.list.handler(notImplemented),
		create: os.ai.create.handler(notImplemented),
		delete: os.ai.delete.handler(notImplemented),
	},
	shared: {
		view: os.shared.view.handler(notImplemented),
	},
});
