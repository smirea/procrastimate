const encoder = new TextEncoder();

export const utf8 = (text: string): Uint8Array<ArrayBuffer> => encoder.encode(text);

export const base64Encode = (bytes: Uint8Array): string => bytes.toBase64();

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
