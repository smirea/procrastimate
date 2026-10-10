import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { createReceiverKeys, decryptPush, verifyVapid } from './push-receiver';
import { base64urlDecode, base64urlEncode, concat, generateVapidKeys, sendPush, VAPID_SUBJECT } from './web-push';

afterEach(() => mock.restore());

test('decryptPush recovers the RFC 8291 example message', async () => {
	const uaPublic = base64urlDecode(
		'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
	);
	const privateKey = await crypto.subtle.importKey(
		'jwk',
		{
			kty: 'EC',
			crv: 'P-256',
			d: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
			x: base64urlEncode(uaPublic.subarray(1, 33)),
			y: base64urlEncode(uaPublic.subarray(33, 65)),
		},
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		['deriveBits'],
	);
	const message = concat(
		base64urlDecode(
			'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
		),
		base64urlDecode('8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ'),
	);
	const auth = base64urlDecode('BTBZMqHH6r4Tts7J_aSIgg');

	expect(await decryptPush(message, { privateKey, publicKey: uaPublic, auth })).toBe(
		'When I grow up, I want to be a watermelon',
	);
});

test('sendPush posts an aes128gcm body the subscriber decrypts, signed with a VAPID JWT for the push origin', async () => {
	const { receiver, keys } = await createReceiverKeys();
	const vapid = { ...(await generateVapidKeys()), subject: VAPID_SUBJECT };
	const requests: Request[] = [];
	spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
		requests.push(new Request(input, init));
		return new Response(null, { status: 201 });
	}) as typeof fetch);

	const message = { title: 'Pay rent ☕', body: 'Due now', tag: 'task-1:42', taskId: 'task-1' };
	const response = await sendPush({ endpoint: 'https://push.example.com/send/abc', keys }, message, vapid);

	expect(response.status).toBe(201);
	const request = requests[0]!;
	expect(request.url).toBe('https://push.example.com/send/abc');
	expect(request.method).toBe('POST');
	expect(request.headers.get('content-encoding')).toBe('aes128gcm');
	expect(request.headers.get('content-type')).toBe('application/octet-stream');
	expect(request.headers.get('ttl')).toBe('86400');
	expect(request.headers.get('urgency')).toBe('high');
	const body = new Uint8Array(await request.arrayBuffer());
	expect([...body.subarray(16, 21)]).toEqual([0, 0, 16, 0, 65]);
	expect(JSON.parse(await decryptPush(body, receiver))).toEqual({
		title: 'Pay rent ☕',
		body: 'Due now',
		tag: 'task-1:42',
		taskId: 'task-1',
	});

	const authorization = request.headers.get('authorization');
	expect(authorization).toEndWith(`, k=${vapid.publicKey}`);
	expect(await verifyVapid(authorization, 'https://push.example.com')).toBe(true);
	expect(await verifyVapid(authorization, 'https://evil.example')).toBe(false);
	expect(
		await verifyVapid(
			authorization!.replace(/k=.*/, `k=${(await generateVapidKeys()).publicKey}`),
			'https://push.example.com',
		),
	).toBe(false);
});
