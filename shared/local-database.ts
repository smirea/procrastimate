// Plain constants, free of the engine's imports, so the end-to-end specs on Node can read them too.
/** The engine's routes: the client posts to `<endpoint>/sync` and opens `<endpoint>/live`. */
export const SYNC_ENDPOINT = '/api';

/** The web's database in OPFS, one per browser profile. */
export const DATABASE_FILE = 'procrastimate.sqlite';

/**
 * Test only: a `localStorage` key naming another database file. Playwright's WebKit contexts share one OPFS store, so
 * each end-to-end context sets its own; a real browser keeps OPFS per profile and never sets it.
 */
export const DATABASE_FILE_KEY = 'procrastimate-e2e-database-file';
