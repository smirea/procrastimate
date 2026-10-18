import type { ImageSize } from 'shared/images.ts';

/**
 * Image bytes on this device, in IndexedDB, outside the synced database, which never holds them. `bytes` caches
 * every image this device made or fetched; `uploads` lists the ones the server does not have yet, with the space
 * they belong to (null for the user's own). Bytes are stored as an `ArrayBuffer` with their type, because WebKit
 * refuses a `Blob` in IndexedDB in a private window.
 */

export type Upload = { key: string; space: string | null; id: string; size: ImageSize };
type Stored = { type: string; bytes: ArrayBuffer };

const stored = async (blob: Blob): Promise<Stored> => ({ type: blob.type, bytes: await blob.arrayBuffer() });

const DB = 'procrastimate-images';
const BYTES = 'bytes';
const UPLOADS = 'uploads';

export const imageKey = (id: string, size: ImageSize) => `${id}/${size}`;

let opened: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
	opened ??= new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(DB, 2);
		request.onupgradeneeded = () => {
			for (const name of [...request.result.objectStoreNames]) request.result.deleteObjectStore(name);
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
	const value = await result<Stored | undefined>(db.transaction(BYTES).objectStore(BYTES).get(imageKey(id, size)));
	return value && new Blob([value.bytes], { type: value.type });
}

export async function writeBytes(id: string, size: ImageSize, blob: Blob): Promise<void> {
	const value = await stored(blob);
	const transaction = (await database()).transaction(BYTES, 'readwrite');
	transaction.objectStore(BYTES).put(value, imageKey(id, size));
	await done(transaction);
}

/** Keeps a new image's sizes and queues their uploads in one transaction, so neither exists without the other. */
export async function keepNew(space: string | null, id: string, sizes: Record<ImageSize, Blob>): Promise<void> {
	// Read before the transaction opens, which would commit on its own while it waited.
	const values = await Promise.all(
		(Object.entries(sizes) as [ImageSize, Blob][]).map(async ([size, blob]) => [size, await stored(blob)] as const),
	);
	const transaction = (await database()).transaction([BYTES, UPLOADS], 'readwrite');
	for (const [size, value] of values) {
		const key = imageKey(id, size);
		transaction.objectStore(BYTES).put(value, key);
		transaction.objectStore(UPLOADS).put({ key, space, id, size } satisfies Upload);
	}
	await done(transaction);
}

export async function pendingUploads(): Promise<Upload[]> {
	const db = await database();
	return result<Upload[]>(db.transaction(UPLOADS).objectStore(UPLOADS).getAll());
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
