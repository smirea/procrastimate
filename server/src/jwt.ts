const encoder = new TextEncoder();

export const utf8 = (text: string): Uint8Array<ArrayBuffer> => encoder.encode(text);

/** Spreading a whole image into `fromCharCode` overflows the call stack past about 125 KB on V8, so it goes in slices. */
export function base64Encode(bytes: Uint8Array): string {
	let binary = '';
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	}
	return btoa(binary);
}

export const base64Decode = (text: string): Uint8Array<ArrayBuffer> =>
	Uint8Array.from(atob(text), char => char.charCodeAt(0));

export const base64urlEncode = (bytes: Uint8Array): string =>
	base64Encode(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

export const base64urlDecode = (text: string): Uint8Array<ArrayBuffer> =>
	base64Decode(text.replaceAll('-', '+').replaceAll('_', '/'));

/** `header.claims.signature`, each part base64url, signed with `key` by `algorithm`: the sync token, VAPID, and Apple. */
export async function signJwt(
	header: Record<string, unknown>,
	claims: Record<string, unknown>,
	key: CryptoKey,
	algorithm: AlgorithmIdentifier | EcdsaParams,
): Promise<string> {
	const input = `${base64urlEncode(utf8(JSON.stringify(header)))}.${base64urlEncode(utf8(JSON.stringify(claims)))}`;
	const signature = await crypto.subtle.sign(algorithm, key, utf8(input));
	return `${input}.${base64urlEncode(new Uint8Array(signature))}`;
}
