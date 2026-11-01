/**
 * The port layout of a block, which the e2e config reads. setup-new-app gives each app a 10-port slot at its main
 * CLIENT_PORT (6000, 6010, 6020, ...), and `agent-t3-worktree setup` gives worktree n the same layout at
 * `main + 10000 + (n - 1) * 1000`, shifting every port by the same amount from CLIENT_PORT, the lowest. An ES module
 * with no imports but Node's, because Playwright loads it under Node.
 */
import { readFileSync } from 'node:fs';

/** Every port of a block stays inside the app's 10-port slot, since the next app's slot starts at +10. */
export const OFFSET = { web: 0, api: 1, e2eWeb: 5, e2eApi: 6 } as const;

/** The root `.env` default, so the main checkout's ports live in one place. */
export const MAIN_PORT = Number(
	readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^CLIENT_PORT=(\d+)/m)?.[1],
);
if (!Number.isInteger(MAIN_PORT) || MAIN_PORT <= 0) throw new Error('The root .env has no CLIENT_PORT default.');
