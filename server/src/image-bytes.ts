import type { R2Bucket, R2HTTPMetadata, R2Object, R2ObjectBody } from '@cloudflare/workers-types';
import type { z } from 'zod';
import {
	byteKeySchema,
	FILE_MAX_PARTS,
	FILE_PART_BYTES,
	FILE_TYPE,
	IMAGE_LIMITS,
	IMAGES_PATH,
	imageTypeSchema,
	previewType,
	sniffImageType,
	uploadCompletionSchema,
	type uploadBegunSchema,
	type uploadedPartSchema,
	type ImageSize,
} from '../../shared/images';
import { errorResponse } from './errors';

/**
 * Attachment bytes between a client and the bucket, apart from the database: the Worker runs this itself, so a large
 * download or upload never holds the `App` object, which only grants the request (`authorizeImages`). An image is one
 * object per size and a file one object, sent whole or, past `FILE_PART_BYTES`, as a multipart upload the client
 * drives. See `docs/decisions/images.md`.
 */

/** The object a request may read or write. */
export type Grant = { key: string };
export type Authorize = (request: Request) => Promise<Grant | Response>;

export const isImageRoute = (request: Request) => new URL(request.url).pathname === IMAGES_PATH;

/**
 * An id's bytes never change. `no-transform` here and `Content-Encoding: identity` on every answer keep Cloudflare from
 * compressing a text file on the way out, which breaks a ranged read: the range counts the stored bytes. The edge
 * honours the first and the Workers runtime the second.
 */
const CACHE = 'private, max-age=31536000, immutable, no-transform';
/** R2's error code for a multipart upload that was aborted, completed, or never begun. */
const NO_SUCH_UPLOAD = /\(10024\)/;

/**
 * `GET` and `HEAD` answer an object, with ranges, so audio and video seek. `PUT` stores one whole, or one part of a
 * multipart upload named by `upload` and `part`. `POST` begins a multipart upload, or with `upload` completes it from
 * the parts' etags. An id's bytes are written once: a second upload of an id keeps the stored bytes.
 */
export async function imagesRoute(request: Request, bucket: R2Bucket, authorize: Authorize): Promise<Response> {
	const grant = await authorize(request);
	if (grant instanceof Response) return grant;
	const query = new URL(request.url).searchParams;
	const size = byteKeySchema.parse(query.get('size'));
	const upload = query.get('upload');
	if (request.method === 'GET' || request.method === 'HEAD') return read(request, bucket, grant.key, query);
	if (size !== 'file') {
		return request.method === 'PUT' && upload === null
			? putImage(request, bucket, grant.key, size)
			: errorResponse('BAD_REQUEST', 'An image is one PUT per size');
	}
	if (request.method === 'PUT') {
		return upload === null
			? putFile(request, bucket, grant.key, query)
			: putPart(request, bucket, grant.key, upload, query);
	}
	return upload === null ? begin(bucket, grant.key, query) : complete(request, bucket, grant.key, upload);
}

function headersOf(object: R2Object, download: boolean): Headers {
	const { contentType, contentDisposition } = object.httpMetadata ?? {};
	const headers = new Headers({
		'Content-Type': contentType ?? FILE_TYPE,
		'Cache-Control': CACHE,
		ETag: object.httpEtag,
		'Accept-Ranges': 'bytes',
		'X-Content-Type-Options': 'nosniff',
		'Content-Encoding': 'identity',
	});
	const disposition = download
		? (contentDisposition ?? 'attachment').replace(/^inline/, 'attachment')
		: contentDisposition;
	if (disposition) headers.set('Content-Disposition', disposition);
	return headers;
}

async function read(request: Request, bucket: R2Bucket, key: string, query: URLSearchParams): Promise<Response> {
	const download = query.has('download');
	if (request.method === 'HEAD') {
		const head = await bucket.head(key);
		if (!head) return errorResponse('NOT_FOUND', 'No such attachment');
		const headers = headersOf(head, download);
		headers.set('Content-Length', String(head.size));
		return new Response(null, { headers });
	}
	const object: R2Object | R2ObjectBody | null = await bucket.get(key, {
		range: request.headers as never,
		onlyIf: request.headers as never,
	});
	if (!object) return errorResponse('NOT_FOUND', 'No such attachment');
	const headers = headersOf(object, download);
	if (!('body' in object)) return new Response(null, { status: 304, headers });
	const body = object.body as unknown as ReadableStream;
	// The bucket answers a range it cannot satisfy, or cannot read, with the whole object.
	const asked = request.headers.get('range')?.match(/^bytes=(\d*)-\d*$/);
	const range = asked ? object.range : undefined;
	if (!range) {
		headers.set('Content-Length', String(object.size));
		return new Response(body, { headers });
	}
	if (Number(asked![1]) >= object.size) {
		headers.set('Content-Range', `bytes */${object.size}`);
		return new Response(null, { status: 416, headers });
	}
	// The binding names every field of a range and leaves the ones that do not apply undefined.
	const { suffix, ...from } = range as { suffix?: number; offset?: number; length?: number };
	const offset = suffix === undefined ? (from.offset ?? 0) : object.size - suffix;
	const length = suffix ?? from.length ?? object.size - offset;
	headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
	headers.set('Content-Length', String(length));
	return new Response(body, { status: 206, headers });
}

const declaredFile = (query: URLSearchParams) =>
	fileMetadata({ name: query.get('name') ?? '', type: query.get('type') ?? '' });

const tooLarge = (limit: number) => errorResponse('PAYLOAD_TOO_LARGE', `At most ${limit} bytes`);

/** The request's body for the bucket, streamed when its length is declared, since the bucket needs one. */
async function bodyOf(request: Request, limit: number): Promise<ReadableStream | ArrayBuffer | Response> {
	const declared = request.headers.get('content-length');
	if (declared !== null && request.body) return Number(declared) > limit ? tooLarge(limit) : request.body;
	const bytes = await request.arrayBuffer();
	return bytes.byteLength > limit ? tooLarge(limit) : bytes;
}

export const imageMetadata = (type: string): R2HTTPMetadata => ({ contentType: type, cacheControl: CACHE });

const stored = () => Response.json({ ok: true });
const onlyNew = { onlyIf: new Headers({ 'If-None-Match': '*' }) as never };

async function putImage(request: Request, bucket: R2Bucket, key: string, size: ImageSize): Promise<Response> {
	const limit = IMAGE_LIMITS[size].bytes;
	if (Number(request.headers.get('content-length') ?? 0) > limit) return tooLarge(limit);
	const bytes = new Uint8Array(await request.arrayBuffer());
	if (bytes.byteLength > limit) return tooLarge(limit);
	const declared = imageTypeSchema.safeParse(request.headers.get('content-type'));
	if (!declared.success || sniffImageType(bytes) !== declared.data) {
		return errorResponse('UNSUPPORTED_MEDIA_TYPE', 'Images are WebP or JPEG');
	}
	await bucket.put(key, bytes, { ...onlyNew, httpMetadata: imageMetadata(declared.data) });
	return stored();
}

/**
 * A file is served as the type a browser may show it as in a tab, else as a download, decided once from the name and
 * type its upload declares: the bytes are never sniffed (`nosniff`), so an HTML file cannot run in the app's origin
 * whatever it claims to be.
 */
export function fileMetadata(file: { name: string; type: string }): R2HTTPMetadata {
	const name = file.name.slice(0, 255) || 'file';
	const type = previewType({ name, type: file.type });
	const encoded = encodeURIComponent(name).replace(
		/['()*]/g,
		char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	);
	return {
		contentType: type ?? FILE_TYPE,
		contentDisposition: `${type ? 'inline' : 'attachment'}; filename*=UTF-8''${encoded}`,
		cacheControl: CACHE,
	};
}

async function putFile(request: Request, bucket: R2Bucket, key: string, query: URLSearchParams): Promise<Response> {
	const body = await bodyOf(request, FILE_PART_BYTES);
	if (body instanceof Response) return body;
	await bucket.put(key, body as never, { ...onlyNew, httpMetadata: declaredFile(query) });
	return stored();
}

/** `upload: null` says the file is already stored, as when a retry begins again after its completion was lost. */
async function begin(bucket: R2Bucket, key: string, query: URLSearchParams): Promise<Response> {
	if (await bucket.head(key)) return Response.json({ upload: null } satisfies z.infer<typeof uploadBegunSchema>);
	const upload = await bucket.createMultipartUpload(key, { httpMetadata: declaredFile(query) });
	return Response.json({ upload: upload.uploadId } satisfies z.infer<typeof uploadBegunSchema>);
}

const noUpload = () => errorResponse('NOT_FOUND', 'No such upload');

async function putPart(
	request: Request,
	bucket: R2Bucket,
	key: string,
	upload: string,
	query: URLSearchParams,
): Promise<Response> {
	const part = Number(query.get('part'));
	if (!Number.isInteger(part) || part < 1 || part > FILE_MAX_PARTS) {
		return errorResponse('BAD_REQUEST', `A part is numbered 1 to ${FILE_MAX_PARTS}`);
	}
	const body = await bodyOf(request, FILE_PART_BYTES);
	if (body instanceof Response) return body;
	try {
		const { etag } = await bucket.resumeMultipartUpload(key, upload).uploadPart(part, body as never);
		return Response.json({ etag } satisfies z.infer<typeof uploadedPartSchema>);
	} catch (error) {
		if (NO_SUCH_UPLOAD.test(String(error))) return noUpload();
		throw error;
	}
}

async function complete(request: Request, bucket: R2Bucket, key: string, upload: string): Promise<Response> {
	const completion = uploadCompletionSchema.safeParse(await request.json().catch(() => null));
	const count = completion.data?.parts.length ?? 0;
	if (count < 1 || count > FILE_MAX_PARTS)
		return errorResponse('BAD_REQUEST', 'Needs the etag of every part, in order');
	const parts = completion.data!.parts.map((etag, index) => ({ partNumber: index + 1, etag }));
	try {
		await bucket.resumeMultipartUpload(key, upload).complete(parts);
		return stored();
	} catch (error) {
		// A retry of a completion whose answer was lost finds the upload gone and the file stored.
		if (await bucket.head(key)) return stored();
		if (NO_SUCH_UPLOAD.test(String(error))) return noUpload();
		return errorResponse('BAD_REQUEST', 'The parts do not make a file');
	}
}
