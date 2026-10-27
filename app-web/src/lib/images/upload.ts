import { imageUrl } from 'shared/images.ts';
import { pendingUploads, readBytes, uploaded } from './local.ts';

const PERMANENT = new Set([400, 403, 404, 413, 415]);

/**
 * Uploads every queued image, each to its own space, before the writes that list them: the database worker runs it
 * before each sync that sends writes. Throws when the server cannot be reached, so those writes wait too; an upload
 * the server refuses for good is dropped instead of blocking them. The session cookie goes with it, from the worker
 * as from the page.
 */
export async function uploadQueuedImages(): Promise<void> {
	const pending = await pendingUploads().catch(() => []);
	for (const { key, space, id, size } of pending) {
		// A failed read throws and stops the upload; only bytes that are truly gone leave the queue unsent.
		const blob = await readBytes(id, size);
		if (blob) {
			const response = await fetch(imageUrl(space, id, size), {
				method: 'PUT',
				body: blob,
				headers: { 'content-type': blob.type },
				credentials: 'include',
				signal: AbortSignal.timeout(60_000),
			});
			if (!response.ok && !PERMANENT.has(response.status)) throw new Error(`Image upload failed: ${response.status}`);
		}
		await uploaded(key);
	}
}
