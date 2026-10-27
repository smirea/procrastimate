/**
 * The one bridge from env-manager project `procrastimate` to the Worker, GitHub, and `.dev.vars`.
 * Never prints a value: logs key names only and hands values to child processes on stdin.
 *
 * bun server/scripts/secrets.ts <push|github|dev-vars|check|verify|ios> [--env <name>] [--generate-only]
 *
 * Environments are `prod` (the Worker and Release iOS) and `dev` (local development and Debug iOS).
 * There is no `local` environment. `--generate-only` skips AWS, for CI and any machine without credentials.
 */
import { chmod, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REQUIRED_WORKER_SECRETS } from '../src/config';
import { generateVapidKeys } from '../src/web-push';
import { parseDotenv, type Values } from '../../scripts/lib';

/** The Bun dev server's stand-in; `wrangler dev` gets the same through `.dev.vars`. */
const INSECURE_DEV_AUTH_SECRET = 'insecure-local-dev-better-auth-secret-0123456789';

export const WORKER_SECRETS = [
	'VAPID_PUBLIC_KEY',
	'VAPID_PRIVATE_KEY',
	'ELEVENLABS_API_KEY',
	'GEMINI_API_KEY',
	'BETTER_AUTH_SECRET',
	'GOOGLE_CLIENT_ID',
	'GOOGLE_CLIENT_SECRET',
	'GOOGLE_IOS_CLIENT_ID',
	'APPLE_CLIENT_ID',
	'APPLE_CLIENT_SECRET',
	'APPLE_TEAM_ID',
	'APPLE_KEY_ID',
	'APPLE_PRIVATE_KEY',
] as const;
const CLOUDFLARE_SECRETS = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'] as const;
const ASC_SECRETS = ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_PRIVATE_KEY_B64'] as const;
const SENTRY_SECRETS = ['SENTRY_AUTH_TOKEN'] as const;
export const GITHUB_SECRETS = [...CLOUDFLARE_SECRETS, ...ASC_SECRETS, ...SENTRY_SECRETS] as const;
const REPO = 'smirea/procrastimate';
const PROJECT = 'procrastimate';

type WorkerSecret = (typeof WORKER_SECRETS)[number];

const rootPath = new URL('../../', import.meta.url).pathname;
const devVarsPath = join(rootPath, '.dev.vars');
const iosConfigPath = join(rootPath, 'app-ios/Config/Env.xcconfig');

/** `Config/Base.xcconfig` pins the same URL. */
export const PROD_API_URL = 'https://procrastimate.stf.lol';

/** `optional` keys, like `SENTRY_ENVIRONMENT`, may stay empty: CI's `--generate-only` has no dev or prod values. */
export type IosKey = { name: string; fallback: string; optional: boolean };

export function appIosKeys(schema: string): IosKey[] {
	let ios = false;
	const keys: IosKey[] = [];
	for (const raw of schema.split('\n')) {
		const line = raw.trim();
		const targets = /^#\s*env-manager targets:\s*(.*)$/.exec(line);
		if (targets) {
			ios = targets[1].split(',').some(target => target.trim() === 'app-ios');
			continue;
		}
		if (!ios || !line || line.startsWith('#')) continue;
		const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
		if (!match) continue;
		const [value, comment = ''] = match[2].split(/\s+#/, 2);
		keys.push({ name: match[1], fallback: value.trim(), optional: /\{\s*optional\b/.test(comment) });
	}
	return keys;
}

/** `123-abc.apps.googleusercontent.com` becomes the reversed scheme Google redirects to. Anything else keeps the placeholder. */
export function googleUrlScheme(clientId: string | undefined): string {
	const match = /^([A-Za-z0-9-]+)\.apps\.googleusercontent\.com$/.exec(clientId?.trim() ?? '');
	return match ? `com.googleusercontent.apps.${match[1]}` : 'com.stefan.procrastimate';
}

/** A missing prod `API_URL` uses the pinned production URL. */
export function iosXcconfig(schema: string, dev: Values, prod: Values): string {
	const lines = ['// Generated from env-manager dev and prod. Do not edit.'];
	for (const key of appIosKeys(schema)) {
		const devValue = dev[key.name] || key.fallback;
		const prodValue = prod[key.name] || (key.name === 'API_URL' ? PROD_API_URL : key.fallback);
		if (!key.optional && (!devValue || !prodValue))
			throw new Error(`${key.name} has no value for ${devValue ? 'prod' : 'dev'}`);
		const setting = (config: 'Debug' | 'Release', value: string) =>
			`${key.name}[config=${config}] = ${value.replaceAll('//', '/$()/')}`;
		lines.push(setting('Debug', devValue), setting('Release', prodValue));
	}
	const scheme = (config: 'Debug' | 'Release', clientId: string | undefined) =>
		`GOOGLE_URL_SCHEME[config=${config}] = ${googleUrlScheme(clientId)}`;
	lines.push(scheme('Debug', dev.GOOGLE_IOS_CLIENT_ID), scheme('Release', prod.GOOGLE_IOS_CLIENT_ID));
	return `${lines.join('\n')}\n`;
}

/** Skips unset secrets, so a push never deletes a Worker secret. */
export function workerSecrets(values: Values): Partial<Record<WorkerSecret, string>> {
	const selected: Partial<Record<WorkerSecret, string>> = {};
	for (const name of WORKER_SECRETS) if (values[name]) selected[name] = values[name];
	if (Boolean(selected.VAPID_PUBLIC_KEY) !== Boolean(selected.VAPID_PRIVATE_KEY)) {
		throw new Error('Only one of VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY is set. Set both or neither.');
	}
	return selected;
}

/** Reads one env-manager environment in a temp copy, leaving the developer's `.env.local` and env marker alone. */
async function readEnv(env: string): Promise<Values> {
	const dir = await mkdtemp(join(tmpdir(), 'procrastimate-secrets-'));
	try {
		await chmod(dir, 0o700);
		await copyFile(join(rootPath, '.env'), join(dir, '.env'));
		await Bun.write(join(dir, '.env.local'), `# env-manager: ${PROJECT}\n# env-manager env: ${env}\n`);
		const down = Bun.spawnSync(['env-manager', 'down', '--no-local', '-p', PROJECT], {
			cwd: dir,
			stdout: 'ignore',
			stderr: 'pipe',
		});
		if (down.exitCode !== 0) {
			throw new Error(
				`env-manager down failed for env "${env}". It needs AWS credentials (the agent box's grok-bot user or Stefan's MacBook).\n${down.stderr.toString()}`,
			);
		}
		return parseDotenv(await Bun.file(join(dir, '.env.local')).text());
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function run(command: string[], options: { stdin?: string; env?: Values } = {}) {
	const result = Bun.spawnSync(command, {
		stdin: options.stdin === undefined ? 'ignore' : new TextEncoder().encode(options.stdin),
		stdout: 'pipe',
		stderr: 'inherit',
		env: { ...process.env, ...options.env },
	});
	if (result.exitCode !== 0) throw new Error(`${command.slice(0, 3).join(' ')} failed`);
	return result.stdout.toString();
}

function cloudflareEnv(values: Values): Values {
	const env: Values = {};
	for (const name of CLOUDFLARE_SECRETS) {
		const value = values[name];
		if (!value) throw new Error(`${name} is not set in env-manager`);
		env[name] = value;
	}
	return env;
}

/** Wrangler can print a banner before its JSON. */
const parseJsonArray = (output: string) => JSON.parse(output.slice(output.indexOf('['))) as { name: string }[];

async function push(env: string) {
	const values = await readEnv(env);
	const secrets = workerSecrets(values);
	const names = Object.keys(secrets);
	if (!names.length) {
		console.log(`No Worker secrets set in env-manager "${env}"`);
		return;
	}
	run(['bunx', 'wrangler', 'secret', 'bulk'], { stdin: JSON.stringify(secrets), env: cloudflareEnv(values) });
	console.log(`Pushed to the Worker: ${names.join(', ')}`);
}

async function github(env: string) {
	const values = await readEnv(env);
	for (const name of GITHUB_SECRETS) {
		const value = values[name];
		if (!value) throw new Error(`${name} is not set in env-manager "${env}"`);
		run(['gh', 'secret', 'set', name, '--repo', REPO], { stdin: value });
		console.log(`Set GitHub secret ${name}`);
	}
}

/**
 * Writes `.dev.vars` for `wrangler dev`, which must exist so wrangler never falls back to the root `.env` schema. Secrets
 * env-manager lacks get the local stand-ins: the committed dev signing key, a fixed auth secret, and a VAPID pair.
 */
async function devVars(env: string, generateOnly: boolean) {
	let values: Values = {};
	if (!generateOnly) {
		try {
			values = await readEnv(env);
		} catch (error) {
			console.warn(`${error instanceof Error ? error.message : error}\nFalling back to a generated VAPID pair.`);
		}
	}
	const file = Bun.file(devVarsPath);
	const existing = parseDotenv((await file.exists()) ? await file.text() : '');
	const secrets: Values = { ...existing, ...workerSecrets(values) };
	secrets.BETTER_AUTH_SECRET ||= INSECURE_DEV_AUTH_SECRET;
	if (!secrets.VAPID_PUBLIC_KEY || !secrets.VAPID_PRIVATE_KEY) {
		const keys = await generateVapidKeys();
		secrets.VAPID_PUBLIC_KEY = keys.publicKey;
		secrets.VAPID_PRIVATE_KEY = keys.privateKey;
		console.log('Generated a new VAPID key pair');
	}
	// wrangler's dotenv takes a single-quoted value literally but keeps the backslashes of `\"` in a double-quoted one,
	// which broke the JSON signing key.
	const quoted = (value: string) => (/['\n]/.test(value) ? JSON.stringify(value) : `'${value}'`);
	const lines = Object.entries(secrets).map(([name, value]) => `${name}=${quoted(value)}\n`);
	await Bun.write(file, lines.join(''));
	console.log(`Wrote .dev.vars: ${Object.keys(secrets).join(', ')}`);
}

/** Writes `Config/Env.xcconfig` so Debug reads `dev` and Release reads `prod`, whatever `.env.local` is switched to. */
async function ios(generateOnly: boolean) {
	const schema = await Bun.file(join(rootPath, '.env')).text();
	let dev: Values = {};
	let prod: Values = {};
	if (!generateOnly) {
		try {
			dev = await readEnv('dev');
		} catch (error) {
			console.warn(`${error instanceof Error ? error.message : error}\nDebug will use the schema defaults.`);
		}
		try {
			prod = await readEnv('prod');
		} catch (error) {
			console.warn(`${error instanceof Error ? error.message : error}\nRelease will use ${PROD_API_URL}.`);
		}
	}
	if (prod.API_URL && prod.API_URL !== PROD_API_URL) {
		throw new Error(
			`prod API_URL is ${prod.API_URL}, but Release is pinned to ${PROD_API_URL} in app-ios/Config/Base.xcconfig`,
		);
	}
	await Bun.write(iosConfigPath, iosXcconfig(schema, dev, prod));
	console.log(
		`Wrote app-ios/Config/Env.xcconfig: ${appIosKeys(schema)
			.map(key => key.name)
			.join(', ')}`,
	);
}

const workerSecretNames = (env: Values) =>
	new Set(
		parseJsonArray(run(['bunx', 'wrangler', 'secret', 'list', '--format', 'json'], { env })).map(secret => secret.name),
	);

export function missingRequired(names: Set<string>): string[] {
	return REQUIRED_WORKER_SECRETS.filter(name => !names.has(name));
}

/** Run by CI before `wrangler deploy` with the Cloudflare credentials in its environment. Needs no AWS. */
function verify() {
	const missing = missingRequired(workerSecretNames(cloudflareEnv(process.env as Values)));
	if (missing.length) {
		console.error(
			`The Worker lacks required secrets: ${missing.join(', ')}. Set them in env-manager prod, then run bun run secrets:push.`,
		);
		process.exit(1);
	}
	console.log(`The Worker has every required secret: ${REQUIRED_WORKER_SECRETS.join(', ')}`);
}

async function check(env: string) {
	const values = await readEnv(env);
	const stored = new Set(Object.keys(workerSecrets(values)));
	const onWorker = workerSecretNames(cloudflareEnv(values));
	const onGithub = new Set(
		(JSON.parse(run(['gh', 'secret', 'list', '--repo', REPO, '--json', 'name'])) as { name: string }[]).map(
			secret => secret.name,
		),
	);
	let drift = false;
	for (const name of missingRequired(stored)) {
		drift = true;
		console.log(`MISSING env-manager ${name} is required by the Worker`);
	}
	for (const name of WORKER_SECRETS) {
		const ok = stored.has(name) === onWorker.has(name);
		drift ||= !ok;
		console.log(
			`${ok ? 'ok   ' : 'DRIFT'} Worker ${name}: env-manager ${stored.has(name) ? 'set' : 'unset'}, Worker ${onWorker.has(name) ? 'set' : 'unset'}`,
		);
	}
	for (const name of GITHUB_SECRETS) {
		const ok = Boolean(values[name]) && onGithub.has(name);
		drift ||= !ok;
		console.log(
			`${ok ? 'ok   ' : 'DRIFT'} GitHub ${name}: env-manager ${values[name] ? 'set' : 'unset'}, GitHub ${onGithub.has(name) ? 'set' : 'unset'}`,
		);
	}
	if (drift) process.exit(1);
}

if (import.meta.main) {
	const [command, ...args] = process.argv.slice(2);
	const flag = (name: string) => {
		const index = args.indexOf(name);
		return index === -1 ? undefined : args[index + 1];
	};
	const env = (fallback: string) => flag('--env') ?? fallback;
	switch (command) {
		case 'push':
			await push(env('prod'));
			break;
		case 'github':
			await github(env('prod'));
			break;
		case 'dev-vars':
			await devVars(env('dev'), args.includes('--generate-only'));
			break;
		case 'ios':
			await ios(args.includes('--generate-only'));
			break;
		case 'check':
			await check(env('prod'));
			break;
		case 'verify':
			verify();
			break;
		default:
			console.error(
				'Usage: bun server/scripts/secrets.ts <push|github|dev-vars|check|verify|ios> [--env <name>] [--generate-only]',
			);
			process.exit(1);
	}
}
