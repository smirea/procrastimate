import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * The version every client shows and iOS ships as `CFBundleShortVersionString`: the commit count, then the commit's UTC
 * date as `yyyyMMdd`, such as `465.20261017`. Both come from `HEAD`, so a web deploy and a TestFlight build of the
 * same commit agree. A shallow clone would count only the commits it fetched, so it fails instead.
 * Run directly, it prints the version.
 */
export function appVersion(): string {
	const cwd = fileURLToPath(new URL('.', import.meta.url));
	const git = (...args: string[]) =>
		execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } }).trim();
	if (git('rev-parse', '--is-shallow-repository') === 'true') {
		throw new Error('The app version counts commits, so it needs full history: run `git fetch --unshallow`.');
	}
	return `${git('rev-list', '--count', 'HEAD')}.${git('log', '-1', '--format=%cd', '--date=format-local:%Y%m%d')}`;
}

if (import.meta.main) console.log(appVersion());
