import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { config, withLocalStandIns } from './config';
import { restoreDump } from './db/backup';
import { bunStore } from './db/bun-store';
import { serveDev } from './dev-server';
import env from './env';

/**
 * The Bun entry, which never reports to Sentry: only deploys do. Values env-manager leaves empty get the local
 * stand-ins. The database is a git-ignored SQLite file in `.data/`, one per checkout, so worktrees never share one;
 * `PROCRASTIMATE_DATABASE` names another file, or `:memory:`, and `PROCRASTIMATE_RESTORE` a dump to load into it while
 * it holds no user.
 */

const { API_PORT, ...settings } = env;
const bindings = await withLocalStandIns(settings);
const parsed = config(bindings);
const root = join(import.meta.dir, '../..');
const file = process.env.PROCRASTIMATE_DATABASE ?? join(root, '.data', `${basename(root)}.sqlite`);
if (file !== ':memory:') mkdirSync(join(file, '..'), { recursive: true });
const store = bunStore(file);
// A backup or an import, loaded into a database that holds no user yet; `restoreDump` refuses any other.
const restore = process.env.PROCRASTIMATE_RESTORE;
if (restore) {
	const counts = restoreDump(store.db, JSON.parse(await Bun.file(restore).text()), Date.now());
	console.log('Restored', restore, JSON.stringify(counts));
}
const server = await serveDev(API_PORT, parsed, store);

console.log('Server running at:', server.url.href);
console.log('Database:', file, `(head ${store.space.head()})`);
console.log(
	'Ramble transcribes with:',
	parsed.ramble?.kind === 'cassette'
		? 'cassettes'
		: [parsed.ramble && 'ElevenLabs', parsed.gemini && 'Gemini Live'].filter(Boolean).join(', ') || 'nothing (off)',
);
