import type { R2Bucket, R2HTTPMetadata } from '@cloudflare/workers-types';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * The attachments bucket outside Cloudflare, for the Bun server and the unit tests: a folder that answers the part of
 * R2's binding `image-bytes.ts` and the sweep use, with the rules a client can trip over (a put that only creates,
 * ranges, multipart parts of one size). Bytes stream to and from disk. `dir` is where it keeps them, or null for a
 * temporary folder removed when the process exits. Wrangler's own emulation was tried first: it runs a `workerd`
 * process that outlives the server and ignores SIGTERM, so every restart leaked one. The end to end suite runs on
 * `wrangler dev`, so the real binding is still tested.
 */
export function localBucket(dir: string | null): R2Bucket {
	const root = dir ?? mkdtempSync(join(tmpdir(), 'procrastimate-bucket-'));
	if (!dir) process.on('exit', () => rmSync(root, { recursive: true, force: true }));
	const bytes = (key: string) => join(root, 'bytes', key);
	const meta = (key: string) => Bun.file(join(root, 'meta', `${key}.json`));
	const part = (upload: string, number: number) => join(root, 'uploads', upload, String(number));
	const md5 = (data: Uint8Array) => createHash('md5').update(data).digest('hex');
	const failure = (call: string, message: string, code: number) => new Error(`${call}: ${message} (${code})`);

	type Meta = { etag: string; httpMetadata: R2HTTPMetadata; size: number };

	const describe = async (key: string) => {
		const stored = meta(key);
		if (!(await stored.exists())) return null;
		const { etag, httpMetadata, size } = (await stored.json()) as Meta;
		return { key, size, etag, httpEtag: `"${etag}"`, httpMetadata };
	};

	/** `value` to `path`, streamed, with its md5 and length. */
	const write = async (path: string, value: unknown) => {
		mkdirSync(dirname(path), { recursive: true });
		const hash = createHash('md5');
		const sink = Bun.file(path).writer();
		let size = 0;
		for await (const chunk of new Response(value as BodyInit).body ?? []) {
			hash.update(chunk);
			sink.write(chunk);
			size += chunk.byteLength;
		}
		await sink.end();
		return { etag: hash.digest('hex'), size };
	};

	const keep = async (key: string, etag: string, size: number, httpMetadata: R2HTTPMetadata = {}) => {
		mkdirSync(dirname(join(root, 'meta', key)), { recursive: true });
		await Bun.write(meta(key), JSON.stringify({ etag, httpMetadata, size } satisfies Meta));
	};

	const multipart = (key: string, uploadId: string) => ({
		uploadId,
		async uploadPart(partNumber: number, value: unknown) {
			if (!(await Bun.file(join(root, 'uploads', uploadId, 'meta.json')).exists())) {
				throw failure('uploadPart', 'The specified multipart upload does not exist.', 10024);
			}
			const { etag } = await write(part(uploadId, partNumber), value);
			return { partNumber, etag };
		},
		async complete(parts: { partNumber: number; etag: string }[]) {
			const begun = Bun.file(join(root, 'uploads', uploadId, 'meta.json'));
			if (!(await begun.exists())) {
				throw failure('completeMultipartUpload', 'The specified multipart upload does not exist.', 10024);
			}
			const files = parts.map(({ partNumber }) => Bun.file(part(uploadId, partNumber)));
			const sizes = files.map(file => file.size);
			const body = sizes.slice(0, -1);
			if (body.some(size => size !== sizes[0] || size < 5 * 1024 * 1024)) {
				throw failure('completeMultipartUpload', 'There was a problem with the multipart upload.', 10048);
			}
			const etags = createHash('md5');
			mkdirSync(dirname(bytes(key)), { recursive: true });
			const sink = Bun.file(bytes(key)).writer();
			for (const [index, file] of files.entries()) {
				const data = await file.bytes();
				if (md5(data) !== parts[index]!.etag) {
					throw failure('completeMultipartUpload', 'One or more of the specified parts could not be found.', 10025);
				}
				etags.update(Buffer.from(parts[index]!.etag, 'hex'));
				sink.write(data);
			}
			await sink.end();
			const size = sizes.reduce((sum, length) => sum + length, 0);
			await keep(key, `${etags.digest('hex')}-${parts.length}`, size, (await begun.json()) as R2HTTPMetadata);
			rmSync(join(root, 'uploads', uploadId), { recursive: true, force: true });
			return describe(key);
		},
	});

	const bucket = {
		head: describe,
		async get(key: string, options: { range?: Headers; onlyIf?: Headers } = {}) {
			const object = await describe(key);
			if (!object) return null;
			const unless = options.onlyIf?.get('if-none-match');
			if (unless && (unless === '*' || unless === object.httpEtag)) return object;
			const asked = options.range?.get('range')?.match(/^bytes=(\d*)-(\d*)$/);
			const [from, to] = [asked?.[1], asked?.[2]];
			let [offset, end] = [0, object.size];
			if (from) {
				if (Number(from) < object.size)
					[offset, end] = [Number(from), to ? Math.min(Number(to) + 1, object.size) : object.size];
			} else if (to && Number(to) < object.size) offset = object.size - Number(to);
			return {
				...object,
				range: { offset, length: end - offset },
				body: Bun.file(bytes(key)).slice(offset, end).stream(),
			};
		},
		async put(key: string, value: unknown, options: { onlyIf?: Headers; httpMetadata?: R2HTTPMetadata } = {}) {
			if (options.onlyIf?.get('if-none-match') === '*' && (await describe(key))) return null;
			const { etag, size } = await write(bytes(key), value);
			await keep(key, etag, size, options.httpMetadata);
			return describe(key);
		},
		async list() {
			const keys = readdirSync(join(root, 'meta'), { recursive: true, encoding: 'utf8' })
				.filter(name => name.endsWith('.json'))
				.map(name => name.slice(0, -'.json'.length))
				.sort();
			return { objects: keys.map(key => ({ key })), truncated: false };
		},
		async delete(keys: string | string[]) {
			for (const key of [keys].flat()) {
				rmSync(bytes(key), { force: true });
				rmSync(join(root, 'meta', `${key}.json`), { force: true });
			}
		},
		async createMultipartUpload(key: string, options: { httpMetadata?: R2HTTPMetadata } = {}) {
			const uploadId = randomUUID();
			mkdirSync(join(root, 'uploads', uploadId), { recursive: true });
			await Bun.write(join(root, 'uploads', uploadId, 'meta.json'), JSON.stringify(options.httpMetadata ?? {}));
			return multipart(key, uploadId);
		},
		resumeMultipartUpload: multipart,
	};
	mkdirSync(join(root, 'meta'), { recursive: true });
	return bucket as unknown as R2Bucket;
}
