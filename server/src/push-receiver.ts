import { base64urlDecode, base64urlEncode, deriveContentKey, ecdhSecret, importEcdhPublic, utf8 } from './web-push';

/** A fake browser's side of a push subscription. Test infrastructure for unit tests and the end to end push service. */
export type PushReceiver = { privateKey: CryptoKey; publicKey: Uint8Array<ArrayBuffer>; auth: Uint8Array<ArrayBuffer> };

export async function createReceiverKeys(): Promise<{
	receiver: PushReceiver;
	keys: { p256dh: string; auth: string };
}> {
	const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
		'deriveBits',
	])) as CryptoKeyPair;
	const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
	const auth = crypto.getRandomValues(new Uint8Array(16));
	return {
		receiver: { privateKey: pair.privateKey, publicKey, auth },
		keys: { p256dh: base64urlEncode(publicKey), auth: base64urlEncode(auth) },
	};
}

/** Decrypts a single-record `aes128gcm` push body (RFC 8188, RFC 8291) back to its plaintext. */
export async function decryptPush(body: Uint8Array, receiver: PushReceiver): Promise<string> {
	const salt = body.slice(0, 16);
	const idLength = body[20] ?? 0;
	const senderPublic = body.slice(21, 21 + idLength);
	const { key, nonce } = await deriveContentKey({
		ecdhSecret: await ecdhSecret(await importEcdhPublic(senderPublic), receiver.privateKey),
		auth: receiver.auth,
		receiverPublic: receiver.publicKey,
		senderPublic,
		salt,
	});
	const padded = new Uint8Array(
		await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idLength)),
	);
	const delimiter = padded.findLastIndex(byte => byte !== 0);
	if (padded[delimiter] !== 2) throw new Error('Push record is missing its last-record delimiter');
	return new TextDecoder().decode(padded.subarray(0, delimiter));
}

/** Checks a VAPID `Authorization` header (RFC 8292): the ES256 signature against `k`, the audience, and expiry. */
export async function verifyVapid(authorization: string | null, expectedAudience: string): Promise<boolean> {
	const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(authorization ?? '');
	if (!match) return false;
	const [, header, payload, signature, publicKey] = match as unknown as [string, string, string, string, string];
	const key = await crypto.subtle.importKey(
		'raw',
		base64urlDecode(publicKey),
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['verify'],
	);
	const valid = await crypto.subtle.verify(
		{ name: 'ECDSA', hash: 'SHA-256' },
		key,
		base64urlDecode(signature),
		utf8(`${header}.${payload}`),
	);
	if (!valid) return false;
	const claims = JSON.parse(new TextDecoder().decode(base64urlDecode(payload))) as { aud?: string; exp?: number };
	const now = Date.now() / 1000;
	return (
		claims.aud === expectedAudience && typeof claims.exp === 'number' && claims.exp > now && claims.exp <= now + 86_400
	);
}
