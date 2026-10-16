import { openRambleBudget } from './account/ramble-budget';
import { cassetteUpstream } from './account/ramble-cassette';
import type { Env } from './bindings';
import { config } from './config';
import { tursoDatabase } from './db/turso';
import { bunUpstream, serveDev } from './dev-server';
import env from './env';
import { generateVapidKeys } from './web-push';

const { API_PORT, ...secrets } = env;
const bindings: Omit<Env, 'ACCOUNT'> = {
	...secrets,
	EPHEMERAL: process.env.EPHEMERAL ?? (!secrets.TURSO_DATABASE_URL && !secrets.TURSO_AUTH_TOKEN ? '1' : undefined),
};
// The `dev` environment has no VAPID pair. A fresh one per start keeps local push working until the next restart.
if (!bindings.VAPID_PUBLIC_KEY && !bindings.VAPID_PRIVATE_KEY) {
	const keys = await generateVapidKeys();
	bindings.VAPID_PUBLIC_KEY = keys.publicKey;
	bindings.VAPID_PRIVATE_KEY = keys.privateKey;
}
const { turso, ramble, ephemeral } = config(bindings);
// Migrated before listening, so a database with a foreign history stops the server instead of failing each request.
if (turso) await tursoDatabase(turso);
const elevenLabs = ramble?.kind === 'elevenlabs' ? ramble.apiKey : null;
const server = serveDev({
	port: API_PORT,
	env: bindings,
	ramble: {
		connect: elevenLabs ? bunUpstream(elevenLabs) : cassetteUpstream(),
		budget: elevenLabs && turso ? openRambleBudget(turso) : null,
	},
});

console.log('Server running at:', server.url);
console.log('Storage:', ephemeral ? 'in memory' : 'Turso');
console.log('Ramble transcribes with:', elevenLabs ? 'ElevenLabs' : 'cassettes');
