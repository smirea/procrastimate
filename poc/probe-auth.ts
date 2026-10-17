const B = process.env.B ?? 'http://127.0.0.1:58081';
const headers = { origin: 'http://127.0.0.1:58083', 'content-type': 'application/json' };
const email = `p${Date.now()}@x.test`;
const signUp = await fetch(`${B}/api/auth/sign-up/email`, {
	method: 'POST',
	headers,
	body: JSON.stringify({ email, password: 'password123', name: 'P' }),
});
const bearer = signUp.headers.get('set-auth-token')!;
const { token } = (await (
	await fetch(`${B}/api/auth/token`, { headers: { authorization: `Bearer ${bearer}` } })
).json()) as { token: string };
const [h, p] = token
	.split('.')
	.slice(0, 2)
	.map(s => JSON.parse(Buffer.from(s, 'base64url').toString()));
console.log(
	'jwt header',
	h,
	'payload keys',
	Object.keys(p),
	'aud',
	p.aud,
	'exp-iat',
	p.exp - p.iat,
	'sub==user',
	typeof p.sub,
);
const wc = await fetch(`${B}/api/powersync/write-checkpoint2.json?client_id=probe`, {
	headers: { authorization: `Token ${token}` },
});
console.log('write-checkpoint via proxy', wc.status, (await wc.text()).slice(0, 200));
