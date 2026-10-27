/**
 * Runs the iOS Sentry smoke test on a simulator that is already signed in against a dev server:
 *
 *   bun scripts/sentry-ios-smoke.ts --udid <simulator> [--api http://127.0.0.1:6121]
 *
 * Builds Debug reporting as `development` with a dSYM, uploads the dSYM to `procrastimate-ios` (Debug builds keep
 * their DWARF in object files, so Sentry cannot symbolicate them otherwise), installs over the existing app, which
 * keeps its Keychain session, and relaunches it with `PROCRASTIMATE_SENTRY_SMOKE=1`. Then run
 * `bun scripts/sentry-check.ts --expect ios,worker`. Needs `SENTRY_AUTH_TOKEN`.
 */
import { parseArgs } from 'node:util';
import env from './env.ts';
import { run as runCommand } from './lib';

const { values } = parseArgs({
	options: { udid: { type: 'string' }, api: { type: 'string', default: 'http://127.0.0.1:6121' } },
});
const { udid, api } = values;
if (!udid) throw new Error('Pass --udid, for example the output of ./sim udid');
if (!env.SENTRY_AUTH_TOKEN)
	throw new Error('SENTRY_AUTH_TOKEN is not set. It lives in env-manager under the scripts target.');

const root = new URL('..', import.meta.url).pathname;
const derived = `${root}app-ios/DerivedData/sentry-smoke`;
const products = `${derived}/Build/Products/Debug-iphonesimulator`;

const run = (command: string[], env?: Record<string, string>) => runCommand(command, { stdio: 'inherit', env });

run([
	'xcodebuild',
	'-quiet',
	'-project',
	`${root}app-ios/App.xcodeproj`,
	'-scheme',
	'App',
	'-configuration',
	'Debug',
	'-destination',
	`id=${udid}`,
	'-derivedDataPath',
	derived,
	'-clonedSourcePackagesDirPath',
	`${root}app-ios/DerivedData/SourcePackages`,
	'CODE_SIGN_IDENTITY=-',
	'SENTRY_ENVIRONMENT=development',
	`API_URL=${api.replaceAll('//', '/$()/')}`,
	'DEBUG_INFORMATION_FORMAT=dwarf-with-dsym',
	'build',
]);
run([
	'bunx',
	'sentry-cli',
	'debug-files',
	'upload',
	'--org',
	'self-uo7',
	'--project',
	'procrastimate-ios',
	`${products}/App.app.dSYM`,
]);
run(['xcrun', 'simctl', 'install', udid, `${products}/App.app`]);
runCommand(['xcrun', 'simctl', 'terminate', udid, 'com.stefan.procrastimate'], { allowFail: true });
run(['xcrun', 'simctl', 'launch', udid, 'com.stefan.procrastimate'], { SIMCTL_CHILD_PROCRASTIMATE_SENTRY_SMOKE: '1' });
console.log('Launched with PROCRASTIMATE_SENTRY_SMOKE=1. Give it a minute, then run scripts/sentry-check.ts.');
