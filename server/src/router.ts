import { implement, ORPCError } from '@orpc/server';
import { JSON_UTF8, MARKDOWN, workerContract } from '../../shared/api/contract';
import { namePrefixed, type Person } from '../../shared/sharing';
import { requireActor, requireHuman } from './actor';
import { agentDocs, agentOpenApiFor, startDocs } from './docs';
import { internalClient } from './account/peers';
import { aiAccounts, authMethods, createAiUser, deleteAccount, deleteUser, userByEmail, userById } from './better-auth';
import type { Env } from './bindings';
import { classifyDelivery } from './push-schedule';
import { requireVapid, sendTestPush } from './push';

const os = implement(workerContract).$context<{ env: Env; request: Request }>();

/** The caller's own space, for the routes that resolve a user with Better Auth before the space writes anything. */
function ownSpace(env: Env, request: Request, actor: Person) {
	if (!env.ACCOUNT) throw new ORPCError('SERVICE_UNAVAILABLE', { message: 'Sync is not configured' });
	// The origin shapes link URLs; behind Vite's dev proxy only the browser's `Origin` names the app's port.
	return internalClient(env.ACCOUNT, actor.id, originOf(request));
}

// Behind Vite's dev proxy only the browser's `Origin` names the app's port; a bot's request has none.
const originOf = (request: Request) => request.headers.get('origin') ?? new URL(request.url).origin;

/** Named, so the smoke test's stack trace shows an in-app frame with this file and line. */
function throwSentrySmoke(): never {
	throw new Error('Sentry smoke test: Worker');
}

const markdown = (name: string, text: string) => new File([text], name, { type: MARKDOWN });

/** The contract's procedures the Worker serves itself. The rest run in the space's `Account` object. */
export const workerRouter = os.router({
	status: os.status.handler(() => ({ ok: true as const })),
	auth: {
		methods: os.auth.methods.handler(({ context }) => authMethods(context.env)),
	},
	account: {
		delete: os.account.delete.handler(async ({ context }) => {
			const actor = await requireHuman(context.request, context.env);
			await deleteAccount(context.request, context.env, actor);
			return { ok: true as const };
		}),
	},
	push: {
		key: os.push.key.handler(({ context }) => ({ publicKey: requireVapid(context.env).publicKey })),
		test: os.push.test.handler(async ({ input, context, errors }) => {
			const vapid = requireVapid(context.env);
			await requireHuman(context.request, context.env);
			const status = await sendTestPush(input.subscription, vapid);
			if (status !== null && status >= 200 && status < 300) return { ok: true as const };
			const data = { status };
			throw classifyDelivery(status) === 'gone' ? errors.GONE({ data }) : errors.BAD_GATEWAY({ data });
		}),
	},
	people: {
		search: os.people.search.handler(async ({ input, context }) => {
			const actor = await requireHuman(context.request, context.env);
			const q = input.query.q.trim();
			if (!q) return { people: [] };
			const found = new Map<string, Person>();
			const byEmail = q.includes('@') ? await userByEmail(context.env, q.toLowerCase()) : null;
			if (byEmail && byEmail.id !== actor.id) found.set(byEmail.id, byEmail);
			for (const ai of await aiAccounts(context.env, actor.id)) if (namePrefixed(ai.name, q)) found.set(ai.id, ai);
			const { people } = await ownSpace(context.env, context.request, actor).people();
			for (const person of people) {
				if (person.id !== actor.id && namePrefixed(person.name, q)) found.set(person.id, person);
			}
			return { people: [...found.values()] };
		}),
	},
	me: os.me.handler(({ context }) => requireHuman(context.request, context.env)),
	ai: {
		list: os.ai.list.handler(async ({ context }) => {
			const actor = await requireHuman(context.request, context.env);
			return { accounts: await aiAccounts(context.env, actor.id) };
		}),
		create: os.ai.create.handler(async ({ input, context }) => {
			const actor = await requireHuman(context.request, context.env);
			const name = input.name.trim();
			if (!name) throw new ORPCError('BAD_REQUEST', { message: 'An AI account needs a name' });
			const ai = await createAiUser(context.env, actor.id, name);
			await ownSpace(context.env, context.request, actor).share({
				target: { kind: 'space', id: '' },
				grantee: ai,
				role: 'edit',
			});
			return ai;
		}),
		delete: os.ai.delete.handler(async ({ input, context }) => {
			const actor = await requireHuman(context.request, context.env);
			const ai = await userById(context.env, input.query.id);
			if (!ai || ai.kind !== 'ai' || ai.ownerId !== actor.id) {
				throw new ORPCError('NOT_FOUND', { message: 'No such AI account' });
			}
			await deleteUser(context.env, ai.id);
			await ownSpace(context.env, context.request, actor).revokeAi({ aiUserId: ai.id });
			return { ok: true as const };
		}),
	},
	shared: {
		view: os.shared.view.handler(async ({ input, context }) => {
			const { env, request } = context;
			if (!env.ACCOUNT) throw new ORPCError('SERVICE_UNAVAILABLE', { message: 'Sync is not configured' });
			const [ownerId, id, ...rest] = input.query.token.split('.');
			if (!ownerId || !id || rest.length) throw new ORPCError('NOT_FOUND', { message: 'No such link' });
			return internalClient(env.ACCOUNT, ownerId, new URL(request.url).origin).sharedView({ id });
		}),
	},
	debug: {
		error: os.debug.error.handler(async ({ context }) => {
			await requireActor(context.request, context.env);
			throwSentrySmoke();
		}),
	},
	docs: {
		start: os.docs.start.handler(({ context }) => markdown('procrastimate.md', startDocs(originOf(context.request)))),
		agent: os.docs.agent.handler(async ({ context }) => {
			await requireActor(context.request, context.env);
			return markdown('procrastimate-agent.md', agentDocs(originOf(context.request)));
		}),
		openapi: os.docs.openapi.handler(async ({ context }) => {
			await requireActor(context.request, context.env);
			const document = JSON.stringify(agentOpenApiFor(originOf(context.request)), null, '\t');
			return new File([document], 'procrastimate-agent.openapi.json', { type: JSON_UTF8 });
		}),
	},
	shares: {
		create: os.shares.create.handler(async ({ input, context }) => {
			const actor = await requireHuman(context.request, context.env);
			const { audience, target } = input;
			const grantee = audience.kind === 'user' ? await userById(context.env, audience.userId) : null;
			if (audience.kind === 'user' && (!grantee || grantee.id === actor.id)) {
				throw new ORPCError('NOT_FOUND', { message: 'No such user' });
			}
			if (grantee?.kind === 'ai' && grantee.ownerId !== actor.id) {
				throw new ORPCError('NOT_FOUND', { message: 'No such user' });
			}
			if (target.kind === 'space' && grantee?.kind !== 'ai') {
				throw new ORPCError('BAD_REQUEST', { message: 'Only an AI account can be given the whole space' });
			}
			const role = audience.kind === 'user' ? audience.role : 'view';
			return ownSpace(context.env, context.request, actor).share({ target, grantee, role });
		}),
	},
});
