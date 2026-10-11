import { cassetteUpstream } from './account/ramble-cassette';
import { bunUpstream, serveDev } from './dev-server';
import env from './env';

const elevenLabs = env.RAMBLE_UPSTREAM !== 'cassette' && env.ELEVENLABS_API_KEY;
const server = serveDev({
	port: env.API_PORT,
	setupCode: env.SYNC_SETUP_CODE,
	ramble: { connect: elevenLabs ? bunUpstream(elevenLabs) : cassetteUpstream() },
});

console.log('Server running at:', server.url);
console.log('Ramble transcribes with:', elevenLabs ? 'ElevenLabs' : 'cassettes');
