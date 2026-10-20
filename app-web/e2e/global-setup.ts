import type { FullConfig } from '@playwright/test';

/**
 * Waits until PowerSync streams a new account's rows, once, before any test starts. A PowerSync that just restarted
 * (it exits whenever the shared Postgres restarts) answers its probes and completes a first checkpoint before its
 * replication reaches the newest writes, so a new account's `settings` row is missing from it. The app holds its first
 * settings write until that row arrives, so `pending()` stayed at 1 and every test that seeds through
 * `App.pushFromOtherDevice` timed out in turn on the first run. The signal is the one the tests need: an account
 * signed up now gets its `settings` row through the app's origin, its proxy, and PowerSync.
 */

const LIMIT = 120_000;
const RETRY = 500;

export default async function globalSetup(config: FullConfig) {
	const origin = config.projects[0]!.use.baseURL!;
	const deadline = Date.now() + LIMIT;
	const signUp = await fetch(`${origin}/api/auth/sign-up/email`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin },
		body: JSON.stringify({
			email: `e2e-ready-${crypto.randomUUID()}@procrastimate.test`,
			password: 'e2e-password-1',
			name: 'Ready',
		}),
	});
	const session = signUp.headers.get('set-auth-token');
	if (!signUp.ok || !session) throw new Error(`sign-up failed: ${signUp.status} ${await signUp.text()}`);
	const credentials = await fetch(`${origin}/api/sync/token`, {
		headers: { authorization: `Bearer ${session}`, origin },
	});
	if (!credentials.ok) throw new Error(`/api/sync/token failed: ${credentials.status} ${await credentials.text()}`);
	const { token, endpoint } = (await credentials.json()) as { token: string; endpoint: string };
	const stream = `${origin}${new URL(endpoint).pathname}/sync/stream`;

	let last = '';
	while (Date.now() < deadline) {
		last = await settingsArrive(stream, token, deadline - Date.now()).catch(error => String(error));
		if (!last) return;
		await new Promise(resolve => setTimeout(resolve, RETRY));
	}
	throw new Error(
		`PowerSync did not stream a new account's settings row within ${LIMIT / 1000} s (last: ${last}). ` +
			"See `docker logs` of the worktree's PowerSync container.",
	);
}

/** Resolves to '' once the account's `settings` row streams down, or to why this stream ended without it. */
async function settingsArrive(stream: string, token: string, timeout: number): Promise<string> {
	const response = await fetch(stream, {
		method: 'POST',
		headers: { authorization: `Token ${token}`, 'content-type': 'application/json' },
		body: JSON.stringify({ buckets: [], include_checksum: true, raw_data: true, client_id: 'e2e-ready' }),
		signal: AbortSignal.timeout(timeout),
	});
	if (!response.ok || !response.body) return `${response.status} from ${stream}`;
	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let text = '';
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) return 'the stream ended';
			text += value;
			if (text.includes('"object_type":"settings"')) return '';
		}
	} finally {
		await reader.cancel();
	}
}
