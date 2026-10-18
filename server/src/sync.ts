import type { SigningKey } from './config';

/**
 * PowerSync's two server halves. The token tells PowerSync which user a device is: an EdDSA JWT the Worker signs
 * with `POWERSYNC_JWT_PRIVATE_KEY`, whose public half every PowerSync config lists inline, so PowerSync never calls
 * back into the Worker. The proxy keeps the browser on the app's origin.
 */

export const TOKEN_AUDIENCE = 'powersync';
export const TOKEN_SECONDS = 5 * 60;
export const POWERSYNC_PATH = '/api/powersync';

const encoder = new TextEncoder();
const base64url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll('=', '');
const encodeJson = (value: unknown) => base64url(encoder.encode(JSON.stringify(value)));

const imported = new WeakMap<SigningKey, Promise<CryptoKey>>();
function cryptoKey(key: SigningKey): Promise<CryptoKey> {
	const existing = imported.get(key);
	if (existing) return existing;
	const { kty, crv, x, d } = key;
	const created = crypto.subtle.importKey('jwk', { kty, crv, x, d }, { name: 'Ed25519' }, false, ['sign']);
	imported.set(key, created);
	return created;
}

/** `{ "alg": "EdDSA", "kid" }` over `{ sub, aud: 'powersync', iat, exp }`, five minutes long. */
export async function signSyncToken(key: SigningKey, userId: string, now = Date.now()): Promise<string> {
	const iat = Math.floor(now / 1000);
	const header = encodeJson({ alg: 'EdDSA', typ: 'JWT', kid: key.kid });
	const payload = encodeJson({ sub: userId, aud: TOKEN_AUDIENCE, iat, exp: iat + TOKEN_SECONDS });
	const input = `${header}.${payload}`;
	const signature = await crypto.subtle.sign('Ed25519', await cryptoKey(key), encoder.encode(input));
	return `${input}.${base64url(new Uint8Array(signature))}`;
}

/**
 * Forwards `/api/powersync/<path>` to the PowerSync service, the streaming sync response included. PowerSync is
 * asked for an identity encoding and the response loses `content-encoding` and `content-length`: the runtime
 * decompresses the body but keeps the headers, and a browser then closes every stream. The cookie never leaves the
 * app's origin; PowerSync reads only the `Authorization` token.
 */
export async function powersyncProxy(request: Request, upstream: string): Promise<Response> {
	const url = new URL(request.url);
	const target = new URL(url.pathname.slice(POWERSYNC_PATH.length) + url.search, `${upstream}/`);
	const headers = new Headers(request.headers);
	headers.delete('host');
	headers.delete('cookie');
	headers.set('accept-encoding', 'identity');
	const response = await fetch(target, {
		method: request.method,
		headers,
		body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
		// @ts-expect-error Bun and workerd both stream a request body with duplex half.
		duplex: 'half',
	});
	const out = new Headers(response.headers);
	out.delete('content-encoding');
	out.delete('content-length');
	return new Response(response.body, { status: response.status, headers: out });
}
