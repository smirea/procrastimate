import { implement, ORPCError } from '@orpc/server';
import { contract, JSON_UTF8, MARKDOWN } from '../../shared/api/contract';
import { CLIENT_HEADER, DEVICE_HEADER } from '../../shared/auth';
import { taskActivity } from './activity';
import { clientOf, requireActor, requireHuman, spaceOf } from './actor';
import { originOf, type App } from './app';
import { deviceIdFrom } from './actor';
import { aiAccounts, authMethods, createAiUser, deleteUser } from './better-auth';
import {
	createComment,
	createLabel,
	createProject,
	createSection,
	createTask,
	editLabel,
	editProject,
	editSection,
	editTask,
	finishTask,
	listComments,
	removeComment,
	removeLabel,
	removeProject,
	removeSection,
	removeTask,
	reopen,
	requireAccess,
	updateComment,
	view,
	type Command,
} from './commands';
import { agentDocs, agentOpenApiFor, startDocs } from './docs';
import { deleteMemoTasks, listMemoTasks, putMemoTasks } from './memo-tasks';
import { classifyDelivery } from './push-schedule';
import { pushSchedule, sendTestPush, subscribePush, unsubscribePush } from './push';
import {
	createLink,
	createShare,
	createToken,
	deleteLink,
	deleteShare,
	deleteToken,
	listLinks,
	listShares,
	listTokens,
	revokeAi,
	sharedView,
} from './sharing';
import { personById, searchPeople } from './people';
import { OUTLINE_TIMEOUT_MS, outlineRamble, RAMBLE_GEMINI } from './ramble-outline';
import { reportError } from './sentry';
import { seesTask, sightOf } from './space';

type Ctx = { app: App; request: Request };

const os = implement(contract).$context<Ctx>();

/** A share change moved `access` rows, which a guest's devices pull on the head. */
const publishHead = (app: App) => app.live.publish(app.store.space.head());

function requireClient(request: Request) {
	const client = clientOf(request);
	if (!client) throw new ORPCError('BAD_REQUEST', { message: `Invalid ${CLIENT_HEADER} header` });
	return client;
}

/** The install id push routes key on. It is not a secret; the session is the credential. */
function requireDevice(request: Request): string {
	const deviceId = deviceIdFrom(request);
	if (!deviceId) throw new ORPCError('BAD_REQUEST', { message: `Missing ${DEVICE_HEADER} header` });
	return deviceId;
}

/** An agent route: any signed-in actor, on the space the query names. Access is checked where the space loads. */
async function command({ app, request }: Ctx, space?: string): Promise<Command> {
	const actor = await requireActor(request, app);
	return {
		db: app.db,
		store: app.store,
		live: app.live,
		owner: spaceOf(actor, space),
		actor,
		client: requireClient(request),
		now: Date.now(),
	};
}

async function shared(ctx: Ctx, space?: string) {
	const cmd = await command(ctx, space);
	return { ...cmd, access: await requireAccess(cmd.db, cmd.owner, cmd.actor), origin: originOf(ctx.request) };
}

async function own({ app, request }: Ctx) {
	const actor = await requireHuman(request, app);
	return { app, actor, request, origin: originOf(request), now: Date.now() };
}

/** Named, so the smoke test's stack trace shows an in-app frame with this file and line. */
function throwSentrySmoke(): never {
	throw new Error('Sentry smoke test: Worker');
}

const markdown = (name: string, text: string) => new File([text], name, { type: MARKDOWN });
const ok = { ok: true as const };

export const router = os.router({
	status: os.status.handler(() => ok),
	auth: {
		methods: os.auth.methods.handler(({ context }) => authMethods(context.app.config)),
	},
	push: {
		key: os.push.key.handler(({ context }) => ({ publicKey: context.app.config.vapid.publicKey })),
		test: os.push.test.handler(async ({ input, context, errors }) => {
			await requireHuman(context.request, context.app);
			const status = await sendTestPush(input.subscription, context.app.config.vapid);
			if (status !== null && status >= 200 && status < 300) return ok;
			const data = { status };
			throw classifyDelivery(status) === 'gone' ? errors.GONE({ data }) : errors.BAD_GATEWAY({ data });
		}),
		subscribe: os.push.subscribe.handler(async ({ input, context }) => {
			const actor = await requireHuman(context.request, context.app);
			await subscribePush(context.app.db, actor.id, requireDevice(context.request), input.subscription, Date.now());
			return ok;
		}),
		unsubscribe: os.push.unsubscribe.handler(async ({ context }) => {
			const actor = await requireHuman(context.request, context.app);
			await unsubscribePush(context.app.db, actor.id, requireDevice(context.request));
			return ok;
		}),
		schedule: os.push.schedule.handler(async ({ context }) => {
			const actor = await requireHuman(context.request, context.app);
			return pushSchedule(context.app.db, actor.id, requireDevice(context.request));
		}),
	},
	people: {
		/**
		 * The people the caller knows: everyone they shared with, the owners of the spaces shared with them, their AI
		 * accounts, and whoever made or finished a task they see, all read from Better Auth's users. An empty query lists them all, which is how a guest's device
		 * learns an owner's name; a query filters on a name prefix and adds an exact email match over every user.
		 */
		search: os.people.search.handler(async ({ input, context }) => {
			const actor = await requireHuman(context.request, context.app);
			return { people: await searchPeople(context.app.db, actor.id, input.query.q) };
		}),
	},
	me: os.me.handler(({ context }) => requireHuman(context.request, context.app)),
	ai: {
		list: os.ai.list.handler(async ({ context }) => {
			const actor = await requireHuman(context.request, context.app);
			return { accounts: await aiAccounts(context.app, actor.id) };
		}),
		create: os.ai.create.handler(async ({ input, context }) => {
			const { app, actor, origin, now } = await own(context);
			const name = input.name.trim();
			if (!name) throw new ORPCError('BAD_REQUEST', { message: 'An AI account needs a name' });
			const ai = await createAiUser(app, actor.id, name);
			createShare(app.store, actor.id, origin, { kind: 'space', id: '' }, ai, 'edit', now);
			return ai;
		}),
		delete: os.ai.delete.handler(async ({ input, context }) => {
			const actor = await requireHuman(context.request, context.app);
			const ai = await personById(context.app.db, input.query.id);
			if (!ai || ai.kind !== 'ai' || ai.ownerId !== actor.id) {
				throw new ORPCError('NOT_FOUND', { message: 'No such AI account' });
			}
			await deleteUser(context.app, ai.id);
			revokeAi(context.app.store, actor.id, ai.id);
			publishHead(context.app);
			return ok;
		}),
	},
	shared: {
		view: os.shared.view.handler(async ({ input, context }) => {
			const [ownerId, id, ...rest] = input.query.token.split('.');
			if (!ownerId || !id || rest.length) throw new ORPCError('NOT_FOUND', { message: 'No such link' });
			return sharedView(context.app, ownerId, id);
		}),
	},
	shares: {
		create: os.shares.create.handler(async ({ input, context }) => {
			const { app, actor, origin, now } = await own(context);
			const { audience, target } = input;
			const grantee = audience.kind === 'user' ? await personById(app.db, audience.userId) : null;
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
			const view = createShare(app.store, actor.id, origin, target, grantee, role, now);
			publishHead(app);
			return view;
		}),
		list: os.shares.list.handler(async ({ context }) => {
			const { app, actor, origin } = await own(context);
			return { shares: await listShares(app.db, actor.id, origin) };
		}),
		delete: os.shares.delete.handler(async ({ input, context }) => {
			const { app, actor } = await own(context);
			deleteShare(app.store, actor.id, input.query.id);
			publishHead(app);
			return ok;
		}),
	},
	tokens: {
		list: os.tokens.list.handler(async ({ context }) => {
			const actor = await requireHuman(context.request, context.app);
			return { tokens: await listTokens(context.app.db, actor.id) };
		}),
		create: os.tokens.create.handler(async ({ input, context }) => {
			const { app, actor, origin, now } = await own(context);
			return createToken(app.db, actor.id, origin, input.aiUserId, input.name, now);
		}),
		delete: os.tokens.delete.handler(async ({ input, context }) => {
			const actor = await requireHuman(context.request, context.app);
			await deleteToken(context.app.db, actor.id, input.query.id);
			return ok;
		}),
	},
	ramble: {
		outline: os.ramble.outline.handler(async ({ input, context, errors }) => {
			await requireHuman(context.request, context.app);
			const gemini = context.app.config.gemini;
			if (!gemini) throw errors.SERVICE_UNAVAILABLE({ message: 'Ramble has no Gemini key' });
			try {
				return await outlineRamble(input, gemini.apiKey, RAMBLE_GEMINI, AbortSignal.timeout(OUTLINE_TIMEOUT_MS));
			} catch (error) {
				reportError(error);
				throw errors.BAD_GATEWAY({ message: 'Gemini could not read the ramble' });
			}
		}),
	},
	debug: {
		error: os.debug.error.handler(async ({ context }) => {
			await requireActor(context.request, context.app);
			throwSentrySmoke();
		}),
	},
	docs: {
		start: os.docs.start.handler(({ context }) => markdown('procrastimate.md', startDocs(originOf(context.request)))),
		agent: os.docs.agent.handler(async ({ context }) => {
			await requireActor(context.request, context.app);
			return markdown('procrastimate-agent.md', agentDocs(originOf(context.request)));
		}),
		openapi: os.docs.openapi.handler(async ({ context }) => {
			await requireActor(context.request, context.app);
			const document = JSON.stringify(agentOpenApiFor(originOf(context.request)), null, '\t');
			return new File([document], 'procrastimate-agent.openapi.json', { type: JSON_UTF8 });
		}),
	},
	sync: {
		token: os.sync.token.handler(async ({ context }) => {
			const actor = await requireHuman(context.request, context.app);
			const session = (await context.app.auth.api.getSession({ headers: context.request.headers })) as {
				session?: { token: string };
			} | null;
			if (!session?.session) throw new ORPCError('UNAUTHORIZED', { message: 'Not signed in' });
			return { token: session.session.token, user: { id: actor.id, name: actor.name, email: actor.email ?? '' } };
		}),
	},
	view: os.view.handler(async ({ input, context }) => view(await command(context, input.query.space))),
	tasks: {
		create: os.tasks.create.handler(async ({ input, context }) =>
			createTask(await command(context, input.query.space), input.body),
		),
		update: os.tasks.update.handler(async ({ input, context }) =>
			editTask(await command(context, input.query.space), input.query.id, input.body),
		),
		complete: os.tasks.complete.handler(async ({ input, context }) =>
			finishTask(await command(context, input.query.space), input.query.id),
		),
		reopen: os.tasks.reopen.handler(async ({ input, context }) =>
			reopen(await command(context, input.query.space), input.query.id),
		),
		delete: os.tasks.delete.handler(async ({ input, context }) => {
			await removeTask(await command(context, input.query.space), input.query.id);
			return ok;
		}),
	},
	activity: {
		list: os.activity.list.handler(async ({ input, context }) => {
			const { db, owner, actor, access } = await shared(context, input.query.space);
			const sight = sightOf(actor, access);
			const [seen, entries] = await Promise.all([
				seesTask(db, owner, sight, input.query.id),
				taskActivity(db, owner, sight, input.query.id),
			]);
			if (!seen) throw new ORPCError('NOT_FOUND', { message: 'No such task' });
			return { entries };
		}),
	},
	comments: {
		list: os.comments.list.handler(async ({ input, context }) => ({
			comments: await listComments(await command(context, input.query.space), input.query.id),
		})),
		create: os.comments.create.handler(async ({ input, context }) =>
			createComment(await command(context, input.query.space), input.body),
		),
		update: os.comments.update.handler(async ({ input, context }) =>
			updateComment(await command(context, input.query.space), input.query.id, input.body.body),
		),
		delete: os.comments.delete.handler(async ({ input, context }) => {
			await removeComment(await command(context, input.query.space), input.query.id);
			return ok;
		}),
	},
	projects: {
		create: os.projects.create.handler(async ({ input, context }) =>
			createProject(await command(context, input.query.space), input.body.name),
		),
		update: os.projects.update.handler(async ({ input, context }) =>
			editProject(await command(context, input.query.space), input.query.id, input.body),
		),
		delete: os.projects.delete.handler(async ({ input, context }) => {
			await removeProject(await command(context, input.query.space), input.query.id);
			return ok;
		}),
	},
	sections: {
		create: os.sections.create.handler(async ({ input, context }) =>
			createSection(await command(context, input.query.space), input.body),
		),
		update: os.sections.update.handler(async ({ input, context }) =>
			editSection(await command(context, input.query.space), input.query.id, input.body),
		),
		delete: os.sections.delete.handler(async ({ input, context }) => {
			await removeSection(await command(context, input.query.space), input.query.id);
			return ok;
		}),
	},
	labels: {
		create: os.labels.create.handler(async ({ input, context }) =>
			createLabel(await command(context, input.query.space), input.body),
		),
		update: os.labels.update.handler(async ({ input, context }) =>
			editLabel(await command(context, input.query.space), input.query.id, input.body),
		),
		delete: os.labels.delete.handler(async ({ input, context }) => {
			await removeLabel(await command(context, input.query.space), input.query.id);
			return ok;
		}),
	},
	links: {
		list: os.links.list.handler(async ({ input, context }) => {
			const { db, owner, access, origin } = await shared(context, input.query.space);
			return { links: await listLinks(db, owner, access, origin) };
		}),
		create: os.links.create.handler(async ({ input, context }) => {
			const { db, owner, access, origin, now } = await shared(context, input.query.space);
			return createLink(context.app.store, owner, access, origin, input.body.target, now);
		}),
		delete: os.links.delete.handler(async ({ input, context }) => {
			const { db, owner, access } = await shared(context, input.query.space);
			await deleteLink(db, owner, access, input.query.id);
			return ok;
		}),
	},
	images: {
		// `api.ts` answers image requests before the router, so this never runs.
		get: os.images.get.handler(() => {
			throw new ORPCError('NOT_FOUND', { message: 'Image requests never reach the router' });
		}),
	},
	memoTasks: {
		list: os.memoTasks.list.handler(async ({ input, context }) => {
			const actor = await requireHuman(context.request, context.app);
			return listMemoTasks(context.app.db, actor.id, input.query.memoId);
		}),
		put: os.memoTasks.put.handler(async ({ input, context }) => {
			const cmd = await command(context);
			if (cmd.actor.kind !== 'human') throw new ORPCError('FORBIDDEN', { message: 'Not for AI accounts' });
			return putMemoTasks(cmd, input);
		}),
		delete: os.memoTasks.delete.handler(async ({ input, context }) => {
			const cmd = await command(context);
			if (cmd.actor.kind !== 'human') throw new ORPCError('FORBIDDEN', { message: 'Not for AI accounts' });
			await deleteMemoTasks(cmd, input.query.memoId);
			return ok;
		}),
	},
});
