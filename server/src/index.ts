import { openRambleBudget } from './account/ramble-budget';
import { cassetteUpstream } from './account/ramble-cassette';
import { bunUpstream, serveDev } from './dev-server';
import env from './env';

const elevenLabs = env.RAMBLE_UPSTREAM !== 'cassette' && env.ELEVENLABS_API_KEY;
const turso =
	env.TURSO_DATABASE_URL && env.TURSO_AUTH_TOKEN
		? { url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN }
		: undefined;
const server = serveDev({
	port: env.API_PORT,
	turso,
	ramble: {
		connect: elevenLabs ? bunUpstream(elevenLabs) : cassetteUpstream(),
		budget: elevenLabs && turso ? openRambleBudget(turso) : null,
	},
});

console.log('Server running at:', server.url);
console.log('Ramble transcribes with:', elevenLabs ? 'ElevenLabs' : 'cassettes');
