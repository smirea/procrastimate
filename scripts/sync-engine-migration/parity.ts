/**
 * Reads the same space through two servers with one AI account's token and diffs the answers: the agent view, every
 * task's activity and comments, and the links. Run against old production and a server holding the import:
 *   bun scripts/sync-engine-migration/parity.ts <old base> <new base> <token> [space]
 * Exits 1 on any difference, printing each route that differs and the first differing path.
 */
const [oldBase, newBase, token, space] = process.argv.slice(2);
if (!oldBase || !newBase || !token) throw new Error('Usage: parity.ts <old base> <new base> <token> [space]');

const headers = { authorization: `Bearer ${token}` };
const withSpace = (path: string) =>
	space ? `${path}${path.includes('?') ? '&' : '?'}space=${encodeURIComponent(space)}` : path;

/**
 * A link's URL names the server it was read from, and neither server promised an order for the links, so they are
 * compared by id without it.
 */
const comparable = (path: string, body: unknown) =>
	path === '/api/links' && body && typeof body === 'object' && 'links' in body
		? (body.links as { id: string; url: string }[])
				.map(({ url: _, ...link }) => link)
				.toSorted((a, b) => a.id.localeCompare(b.id))
		: body;

/** Old production answers a burst with the odd 503, so a 5xx is asked again before it counts. */
async function read(base: string, path: string): Promise<unknown> {
	for (let attempt = 1; ; attempt++) {
		const response = await fetch(`${base}${withSpace(path)}`, { headers });
		if (response.status >= 500 && attempt < 8) {
			await Bun.sleep(500 * attempt);
			continue;
		}
		return { status: response.status, body: comparable(path, await response.json().catch(() => null)) };
	}
}

/** The first path at which two JSON values differ, or null. */
function difference(a: unknown, b: unknown, at = '$'): string | null {
	if (a === b) return null;
	if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
		return `${at}: ${JSON.stringify(a)?.slice(0, 120)} != ${JSON.stringify(b)?.slice(0, 120)}`;
	}
	if (Array.isArray(a) !== Array.isArray(b)) return `${at}: array vs object`;
	const keys = new Set([...Object.keys(a), ...Object.keys(b as object)]);
	for (const key of keys) {
		const found = difference((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${at}.${key}`);
		if (found) return found;
	}
	return null;
}

const view = (await read(oldBase, '/api/view')) as { status: number; body: { tasks: { id: string }[] } };
const routes = [
	'/api/view',
	'/api/links',
	...view.body.tasks.flatMap(task => [`/api/activity?id=${task.id}`, `/api/comments?id=${task.id}`]),
];
let differing = 0;
for (const route of routes) {
	const [before, after] = await Promise.all([read(oldBase, route), read(newBase, route)]);
	const found = difference(before, after);
	if (!found) continue;
	differing++;
	console.log(`DIFF ${route}\n  ${found}`);
}
console.log(`${routes.length} routes compared, ${differing} differ (${view.body.tasks.length} tasks).`);
process.exit(differing ? 1 : 0);
