import type { ImageSize } from 'shared/images.ts';

/**
 * Image bytes on this device, in IndexedDB because the synced document is one synchronous `localStorage` value that
 * must never hold them. `bytes` caches every image this device made or fetched; `uploads` lists the ones the server
 * does not have yet, with the space they belong to (null for the user's own).
 */

export type Upload = { key: string; space: string | null; id: string; size: ImageSize };

const DB = 'procrastimate-images';
const BYTES = 'bytes';
const UPLOADS = 'uploads';

export const imageKey = (id: string, size: ImageSize) => `${id}/${size}`;

let opened: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
	opened ??= new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(DB, 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore(BYTES);
			request.result.createObjectStore(UPLOADS, { keyPath: 'key' });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	}).catch(error => {
		opened = undefined;
		throw error;
	});
	return opened;
}

function done(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = transaction.onabort = () => reject(transaction.error);
	});
}

function result<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

export async function readBytes(id: string, size: ImageSize): Promise<Blob | undefined> {
	const db = await database();
	return result<Blob | undefined>(db.transaction(BYTES).objectStore(BYTES).get(imageKey(id, size)));
}

export async function writeBytes(id: string, size: ImageSize, blob: Blob): Promise<void> {
	const transaction = (await database()).transaction(BYTES, 'readwrite');
	transaction.objectStore(BYTES).put(blob, imageKey(id, size));
	await done(transaction);
}

/** Keeps a new image's sizes and queues their uploads in one transaction, so neither exists without the other. */
export async function keepNew(space: string | null, id: string, sizes: Record<ImageSize, Blob>): Promise<void> {
	const transaction = (await database()).transaction([BYTES, UPLOADS], 'readwrite');
	for (const [size, blob] of Object.entries(sizes) as [ImageSize, Blob][]) {
		const key = imageKey(id, size);
		transaction.objectStore(BYTES).put(blob, key);
		transaction.objectStore(UPLOADS).put({ key, space, id, size } satisfies Upload);
	}
	await done(transaction);
}

export async function pendingUploads(space: string | null): Promise<Upload[]> {
	const db = await database();
	const all = await result<Upload[]>(db.transaction(UPLOADS).objectStore(UPLOADS).getAll());
	return all.filter(upload => upload.space === space);
}

export async function uploaded(key: string): Promise<void> {
	const transaction = (await database()).transaction(UPLOADS, 'readwrite');
	transaction.objectStore(UPLOADS).delete(key);
	await done(transaction);
}

/** For a different signed-in user: nothing of the previous one's stays or uploads. */
export async function clearLocalImages(): Promise<void> {
	const transaction = (await database()).transaction([BYTES, UPLOADS], 'readwrite');
	transaction.objectStore(BYTES).clear();
	transaction.objectStore(UPLOADS).clear();
	await done(transaction);
}
