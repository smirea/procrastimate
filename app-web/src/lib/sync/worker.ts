import { startSyncWorker } from 'sync-engine/client-web/worker';
import wasm from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';
import { CLIENT_HEADER } from 'shared/auth.ts';
import { syncSchema } from 'shared/db/sync.ts';
import { DATABASE_FILE, SYNC_ENDPOINT } from 'shared/local-database.ts';
import { uploadQueuedImages } from '../images/upload.ts';

/**
 * The database worker every tab starts. The engine elects one tab's worker to hold the SQLite database (OPFS) and run
 * the sync loop, and the others forward to it. The page passes its client header in the query, since a worker cannot
 * read the page's state; the token arrives later through `setToken`.
 */
const query = new URL(self.location.href).searchParams;
const client = query.get('client') ?? '';
const RETRY_CAP_MS = 3000;

startSyncWorker({
	schema: syncSchema,
	endpoint: `${self.location.origin}${SYNC_ENDPOINT}`,
	filename: query.get('file') || DATABASE_FILE,
	token: null,
	headers: client ? { [CLIENT_HEADER]: client } : {},
	// PowerSync retried every 2 s here; the engine's default 15 s cap left an edit made offline waiting that long after
	// the network came back. The same tick pings the live socket, which the object answers without waking.
	maxBackoff: RETRY_CAP_MS,
	beforePush: uploadQueuedImages,
	locateFile: file => (file.endsWith('.wasm') ? wasm : file),
});
