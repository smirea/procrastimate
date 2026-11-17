import { FILE_PART_BYTES, FILE_TYPE, filePartCount, IMAGES_PATH, imageUrl } from 'shared/images.ts';
import { pendingUploads, readBytes, saveUpload, uploaded, type Upload } from './local.ts';

/**
 * The upload queue's two drains, both run by the database worker. Image sizes go before the writes that list them
 * (`uploadQueuedImages`, the engine's `beforePush`): they are small, and another device then never shows an image it
 * cannot load. Files go in the background (`uploadQueuedFiles`), in parts when long, so a gigabyte never holds up a
 * sync; the task lists the file meanwhile, and another device opens it once it has arrived.
 */

/** The server answered for good: the request was bad, no longer allowed, or the bytes will never fit. */
const PERMANENT = new Set([400, 403, 413, 415]);
const PARALLEL_PARTS = 3;
const RETRY_MS = 5_000;
const RETRY_CAP_MS = 60_000;

/** What the page hears about a file's upload, and says to start one, over a `BroadcastChannel` of this name. */
export const UPLOADS_CHANNEL = 'procrastimate-uploads';
export type UploadMessage =
	| { kind: 'queued' }
	| { kind: 'progress'; id: string; sent: number }
	| { kind: 'done'; id: string };

class Refused extends Error {}
class Restart extends Error {}

async function send(url: string, init: RequestInit, timeout: number): Promise<Response> {
	const response = await fetch(url, { ...init, credentials: 'include', signal: AbortSignal.timeout(timeout) });
	if (response.ok) return response;
	if (PERMANENT.has(response.status)) throw new Refused(`Upload refused: ${response.status}`);
	throw new Error(`Upload failed: ${response.status}`);
}

/**
 * Uploads every queued image size, each to its own space. Throws when the server cannot be reached, so the writes
 * that list them wait too; an upload the server refuses for good is dropped instead of blocking them. The session
 * cookie goes with it, from the worker as from the page.
 */
export async function uploadQueuedImages(): Promise<void> {
	const pending = await pendingUploads().catch(() => []);
	for (const upload of pending) {
		if (upload.size === 'file') continue;
		// A failed read throws and stops the upload; only bytes that are truly gone leave the queue unsent.
		const blob = await readBytes(upload.id, upload.size);
		if (blob) {
			await send(
				imageUrl(upload.space, upload.id, upload.size),
				{ method: 'PUT', body: blob, headers: { 'content-type': blob.type } },
				60_000,
			).catch(error => {
				if (!(error instanceof Refused)) throw error;
			});
		}
		await uploaded(upload);
	}
}

const fileUrl = ({ space, id, name, type }: Upload, extra: Record<string, string> = {}) => {
	const query = new URLSearchParams({ id, size: 'file', name: name ?? '', type: type ?? '', ...extra });
	if (space) query.set('space', space);
	return `${IMAGES_PATH}?${query}`;
};

const octets = { 'content-type': FILE_TYPE };

/** A multipart upload: begun once, then every part the server lacks, a few at a time, then completed. */
async function uploadParts(upload: Upload, blob: Blob, report: (sent: number) => void): Promise<void> {
	if (!upload.multipart) {
		const begun = (await (await send(fileUrl(upload), { method: 'POST' }, 30_000)).json()) as { upload: string | null };
		if (begun.upload === null) return;
		upload.multipart = { upload: begun.upload, etags: Array.from({ length: filePartCount(blob.size) }, () => null) };
		await saveUpload(upload);
	}
	const { multipart } = upload;
	const sent = () => multipart.etags.filter(Boolean).length * FILE_PART_BYTES;
	const missing = multipart.etags.flatMap((etag, index) => (etag ? [] : [index]));
	const restart = async (response: Response) => {
		if (response.status !== 404) return response;
		// The server no longer knows the upload, as after a week idle, so it begins again.
		delete upload.multipart;
		await saveUpload(upload);
		throw new Restart();
	};
	const worker = async () => {
		for (let index = missing.shift(); index !== undefined; index = missing.shift()) {
			const response = await restart(
				await fetch(fileUrl(upload, { upload: multipart.upload, part: String(index + 1) }), {
					method: 'PUT',
					body: blob.slice(index * FILE_PART_BYTES, (index + 1) * FILE_PART_BYTES),
					headers: octets,
					credentials: 'include',
				}),
			);
			if (PERMANENT.has(response.status)) throw new Refused(`Upload refused: ${response.status}`);
			if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
			multipart.etags[index] = ((await response.json()) as { etag: string }).etag;
			await saveUpload(upload);
			report(Math.min(sent(), blob.size));
		}
	};
	report(Math.min(sent(), blob.size));
	await Promise.all(Array.from({ length: PARALLEL_PARTS }, worker));
	const completed = await restart(
		await fetch(fileUrl(upload, { upload: multipart.upload }), {
			method: 'POST',
			body: JSON.stringify({ parts: multipart.etags }),
			headers: { 'content-type': 'application/json' },
			credentials: 'include',
		}),
	);
	if (PERMANENT.has(completed.status)) throw new Refused(`Upload refused: ${completed.status}`);
	if (!completed.ok) throw new Error(`Upload failed: ${completed.status}`);
}

async function uploadFile(upload: Upload, channel: BroadcastChannel): Promise<void> {
	const blob = await readBytes(upload.id, 'file');
	if (blob) {
		try {
			if (blob.size <= FILE_PART_BYTES && !upload.multipart) {
				await send(fileUrl(upload), { method: 'PUT', body: blob, headers: octets }, 300_000);
			} else {
				await uploadParts(upload, blob, sent =>
					channel.postMessage({ kind: 'progress', id: upload.id, sent } satisfies UploadMessage),
				);
			}
		} catch (error) {
			if (!(error instanceof Refused)) throw error;
		}
	}
	await uploaded(upload);
	channel.postMessage({ kind: 'done', id: upload.id } satisfies UploadMessage);
}

/**
 * Uploads queued files for as long as the worker lives: when the page queues one, when the network returns, and on a
 * growing delay after a failure. Every tab has a worker, so a lock lets one upload at a time, and another takes over
 * when its tab closes.
 */
export function uploadQueuedFiles(): void {
	const channel = new BroadcastChannel(UPLOADS_CHANNEL);
	let running = false;
	let again = false;
	let delay = RETRY_MS;
	const drain = async () => {
		if (running) {
			again = true;
			return;
		}
		running = true;
		try {
			await navigator.locks.request(UPLOADS_CHANNEL, async () => {
				do {
					again = false;
					for (const upload of await pendingUploads()) {
						if (upload.size !== 'file') continue;
						await uploadFile(upload, channel).catch(error => {
							if (!(error instanceof Restart)) throw error;
							again = true;
						});
					}
				} while (again);
			});
			delay = RETRY_MS;
		} catch {
			setTimeout(() => void drain(), delay);
			delay = Math.min(delay * 2, RETRY_CAP_MS);
		} finally {
			running = false;
		}
	};
	channel.addEventListener('message', ({ data }: MessageEvent<UploadMessage>) => {
		if (data.kind === 'queued') void drain();
	});
	self.addEventListener('online', () => void drain());
	void drain();
}
