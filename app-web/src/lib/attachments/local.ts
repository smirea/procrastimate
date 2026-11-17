import type { ByteKey } from 'shared/images.ts';

/**
 * A queued upload: one size of an image, or a file. A file past one part carries the multipart upload it began and
 * the etag of each part the server holds, so an upload cut short resumes instead of starting over.
 */
export type Upload = {
	key: string;
	space: string | null;
	id: string;
	size: ByteKey;
	name?: string;
	type?: string;
	multipart?: { upload: string; etags: (string | null)[] };
};

/**
 * An `ArrayBuffer` with its type, because WebKit refuses a `Blob` in IndexedDB in a private window. A long file stays
 * a `Blob`, which the browser keeps on disk instead of in memory; a private WebKit window cannot attach one.
 */
type Stored = { type: string; bytes: ArrayBuffer | Blob };
const IN_MEMORY_BYTES = 64 * 1024 * 1024;

const stored = async (blob: Blob): Promise<Stored> => ({
	type: blob.type,
	bytes: blob.size > IN_MEMORY_BYTES ? blob : await blob.arrayBuffer(),
});

const DB = 'procrastimate-images';
const BYTES = 'bytes';
const UPLOADS = 'uploads';

export const imageKey = (id: string, size: ByteKey) => `${id}/${size}`;

let opened: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
	opened ??= new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(DB, 3);
		request.onupgradeneeded = () => {
			for (const name of request.result.objectStoreNames) request.result.deleteObjectStore(name);
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

export async function readBytes(id: string, size: ByteKey): Promise<Blob | undefined> {
	const db = await database();
	const value = await result<Stored | undefined>(db.transaction(BYTES).objectStore(BYTES).get(imageKey(id, size)));
	return value && new Blob([value.bytes], { type: value.type });
}

export async function writeBytes(id: string, size: ByteKey, blob: Blob): Promise<void> {
	const value = await stored(blob);
	const transaction = (await database()).transaction(BYTES, 'readwrite');
	transaction.objectStore(BYTES).put(value, imageKey(id, size));
	await done(transaction);
}

/**
 * Keeps a new attachment's bytes, an image's sizes or a file, and queues their uploads in one transaction, so neither
 * exists without the other.
 */
export async function keepNew(
	space: string | null,
	id: string,
	rows: [ByteKey, Blob][],
	file?: { name: string; type: string },
): Promise<void> {
	// Read before the transaction opens, which would commit on its own while it waited.
	const values = await Promise.all(rows.map(async ([size, blob]) => [size, await stored(blob)] as const));
	const transaction = (await database()).transaction([BYTES, UPLOADS], 'readwrite');
	for (const [size, value] of values) {
		const key = imageKey(id, size);
		transaction.objectStore(BYTES).put(value, key);
		transaction.objectStore(UPLOADS).put({ key, space, id, size, ...file } satisfies Upload);
	}
	await done(transaction);
}

export async function pendingUploads(): Promise<Upload[]> {
	const db = await database();
	return result<Upload[]>(db.transaction(UPLOADS).objectStore(UPLOADS).getAll());
}

/** Records how far a multipart upload got. */
export async function saveUpload(upload: Upload): Promise<void> {
	const transaction = (await database()).transaction(UPLOADS, 'readwrite');
	transaction.objectStore(UPLOADS).put(upload);
	await done(transaction);
}

/**
 * Takes an upload off the queue. A file's bytes go with it: it opens from the server from then on, and keeping a copy
 * of every file ever attached would fill the device.
 */
export async function uploaded({ key, size }: Upload): Promise<void> {
	const transaction = (await database()).transaction([BYTES, UPLOADS], 'readwrite');
	transaction.objectStore(UPLOADS).delete(key);
	if (size === 'file') transaction.objectStore(BYTES).delete(key);
	await done(transaction);
}

export async function clearLocalImages(): Promise<void> {
	const transaction = (await database()).transaction([BYTES, UPLOADS], 'readwrite');
	transaction.objectStore(BYTES).clear();
	transaction.objectStore(UPLOADS).clear();
	await done(transaction);
}
