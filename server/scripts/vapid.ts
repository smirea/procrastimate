import { generateVapidKeys } from '../src/web-push';

const devVarsPath = new URL('../../.dev.vars', import.meta.url).pathname;
const SECRET_NAMES = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'];

/** Gives `wrangler dev` a VAPID pair in `.dev.vars`, keeping one that is already there. */
async function devVars() {
	const file = Bun.file(devVarsPath);
	const existing = (await file.exists()) ? await file.text() : '';
	if (/^VAPID_PRIVATE_KEY=/m.test(existing)) {
		console.log('.dev.vars already has VAPID keys');
		return;
	}
	const keys = await generateVapidKeys();
	const kept = existing
		.split('\n')
		.filter(line => line && !line.startsWith('VAPID_PUBLIC_KEY='))
		.map(line => `${line}\n`)
		.join('');
	await Bun.write(file, `${kept}VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`);
	console.log('Wrote a new VAPID key pair to .dev.vars');
}

/**
 * Uploads a VAPID pair as Worker secrets unless both already exist. Rotate by deleting them and redeploying.
 * Extra arguments go to wrangler, such as `--config` for another Worker.
 */
async function ensure() {
	const wranglerArgs = process.argv.slice(3);
	const list = Bun.spawnSync(['bunx', 'wrangler', 'secret', 'list', '--format', 'json', ...wranglerArgs], {
		stderr: 'inherit',
	});
	if (list.exitCode !== 0) throw new Error('wrangler secret list failed');
	const output = list.stdout.toString();
	// Wrangler can print a banner before the JSON.
	const secrets = JSON.parse(output.slice(output.indexOf('['))) as { name: string }[];
	const names = new Set(secrets.map(secret => secret.name));
	if (SECRET_NAMES.every(name => names.has(name))) {
		console.log('VAPID secrets already exist');
		return;
	}
	const keys = await generateVapidKeys();
	const upload = Bun.spawnSync(['bunx', 'wrangler', 'secret', 'bulk', ...wranglerArgs], {
		stdin: new TextEncoder().encode(
			JSON.stringify({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }),
		),
		stdout: 'inherit',
		stderr: 'inherit',
	});
	if (upload.exitCode !== 0) throw new Error('wrangler secret bulk failed');
	console.log('Uploaded a new VAPID key pair');
}

const commands: Record<string, () => Promise<void>> = { 'dev-vars': devVars, ensure };
const command = commands[process.argv[2] ?? ''];
if (!command) {
	console.error(`Usage: bun server/scripts/vapid.ts <${Object.keys(commands).join('|')}>`);
	process.exit(1);
}
await command();
