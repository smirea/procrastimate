/**
 * The port layout the worktree scripts and the e2e config share. setup-new-app gives each app a 10-port slot at its
 * main CLIENT_PORT (6000, 6010, 6020, ...), and worktree n of the app gets the same layout at
 * `main + 10000 + (n - 1) * 1000`, so worktrees of different apps never collide. An ES module with no imports but
 * Node's, because `setup-worktree` loads it before `bun install` and Playwright loads it under Node.
 */
import { readFileSync } from 'node:fs';

/** Every port of a block stays inside the app's 10-port slot, since the next app's slot starts at +10. */
export const OFFSET = { web: 0, api: 1, e2eWeb: 5, e2eApi: 6 } as const;

/** The root `.env` default, so the main checkout's ports live in one place. */
export const MAIN_PORT = Number(
	readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^CLIENT_PORT=(\d+)/m)?.[1],
);
if (!Number.isInteger(MAIN_PORT) || MAIN_PORT <= 0) throw new Error('The root .env has no CLIENT_PORT default.');

/** The last app's slot (6990) at worktree 33 ends at 48999, below macOS's ephemeral ports from 49152. */
export const MAX_WORKTREE = 33;

export const worktreePort = (n: number) => MAIN_PORT + 10_000 + (n - 1) * 1000;

/** The worktree number whose block starts at `port`, or undefined for any other port, such as the old 62xx blocks. */
export function worktreeOf(port: number): number | undefined {
	const n = (port - MAIN_PORT - 10_000) / 1000 + 1;
	return Number.isInteger(n) && n >= 1 && n <= MAX_WORKTREE ? n : undefined;
}
