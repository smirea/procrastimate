import type { PushMessage, PushSubscriptionInfo } from '../../shared/push';

/** VAPID keys are base64url: the uncompressed P-256 public point (65 bytes) and the private scalar `d` (32 bytes). */
export type Vapid = { publicKey: string; privateKey: string; subject: string };

export const VAPID_SUBJECT = 'https://procrastimate.stf.lol';

const RECORD_SIZE = 4096;
const JWT_LIFETIME_SECONDS = 12 * 60 * 60;

type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
export const utf8 = (text: string): Bytes => encoder.encode(text);

export function base64urlEncode(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function base64urlDecode(text: string): Bytes {
	const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
	return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export function concat(...parts: Uint8Array[]): Bytes {
	const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
	const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
	return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** RFC 8291 key schedule shared by the sender and the test receiver. */
export async function deriveContentKey(input: {
	ecdhSecret: Bytes;
	auth: Bytes;
	receiverPublic: Bytes;
	senderPublic: Bytes;
	salt: Bytes;
}): Promise<{ key: CryptoKey; nonce: Bytes }> {
	const info = concat(utf8('WebPush: info\0'), input.receiverPublic, input.senderPublic);
	const ikm = await hkdf(input.auth, input.ecdhSecret, info, 32);
	const cek = await hkdf(input.salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
	const nonce = await hkdf(input.salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
	const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt', 'decrypt']);
	return { key, nonce };
}

export const importEcdhPublic = (raw: Bytes) =>
	crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);

export async function ecdhSecret(publicKey: CryptoKey, privateKey: CryptoKey): Promise<Bytes> {
	return new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256));
}

async function encrypt(subscription: PushSubscriptionInfo, plaintext: Bytes): Promise<Bytes> {
	const receiverPublic = base64urlDecode(subscription.keys.p256dh);
	const sender = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
		'deriveBits',
	])) as CryptoKeyPair;
	const senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey)) as Bytes;
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const { key, nonce } = await deriveContentKey({
		ecdhSecret: await ecdhSecret(await importEcdhPublic(receiverPublic), sender.privateKey),
		auth: base64urlDecode(subscription.keys.auth),
		receiverPublic,
		senderPublic,
		salt,
	});
	const record = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, Uint8Array.of(2))),
	);
	const header = new Uint8Array(21);
	new DataView(header.buffer).setUint32(16, RECORD_SIZE);
	header.set(salt);
	header[20] = senderPublic.length;
	return concat(header, senderPublic, record);
}

async function vapidAuthorization(endpoint: string, vapid: Vapid): Promise<string> {
	const publicKey = base64urlDecode(vapid.publicKey);
	const key = await crypto.subtle.importKey(
		'jwk',
		{
			kty: 'EC',
			crv: 'P-256',
			d: vapid.privateKey,
			x: base64urlEncode(publicKey.subarray(1, 33)),
			y: base64urlEncode(publicKey.subarray(33, 65)),
		},
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['sign'],
	);
	const claims = {
		aud: new URL(endpoint).origin,
		exp: Math.floor(Date.now() / 1000) + JWT_LIFETIME_SECONDS,
		sub: vapid.subject,
	};
	const unsigned = `${base64urlEncode(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))}.${base64urlEncode(utf8(JSON.stringify(claims)))}`;
	const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(unsigned));
	return `vapid t=${unsigned}.${base64urlEncode(new Uint8Array(signature))}, k=${vapid.publicKey}`;
}

/** Encrypts `message` for the subscription and posts it to its push service. Resolves with the service's response. */
export async function sendPush(
	subscription: PushSubscriptionInfo,
	message: PushMessage,
	vapid: Vapid,
	ttlSeconds = 86_400,
): Promise<Response> {
	const body = await encrypt(subscription, utf8(JSON.stringify(message)));
	return fetch(subscription.endpoint, {
		method: 'POST',
		headers: {
			Authorization: await vapidAuthorization(subscription.endpoint, vapid),
			'Content-Encoding': 'aes128gcm',
			'Content-Type': 'application/octet-stream',
			TTL: String(ttlSeconds),
			Urgency: 'high',
		},
		body,
	});
}

export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
	const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign',
		'verify',
	])) as CryptoKeyPair;
	const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
	const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
	if (!d) throw new Error('WebCrypto exported a private key without d');
	return { publicKey: base64urlEncode(publicKey), privateKey: d };
}
