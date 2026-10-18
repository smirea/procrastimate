import { imageUrl, type ImageSize } from 'shared/images.ts';
import { newId } from 'shared/id.ts';
import type { ImageRef } from 'shared/values.ts';
import { reportError } from '../sentry.ts';
import { store } from '../store.svelte.ts';
import { toasts } from '../ui.svelte.ts';
import { encodeImage } from './encode.ts';
import { imageKey, keepNew, pendingUploads, readBytes, uploaded, writeBytes } from './local.ts';

/**
 * Task images on the web. A task's `images` field syncs like any other; the bytes stay out of it. Attaching keeps
 * the new image's bytes on this device and queues their upload before the edit is written, and every upload of
 * queued writes sends the queued images first, so the server never hears of an image it cannot serve. See
 * `docs/decisions/images.md`.
 */

/** How long a missing image waits before it is asked for again, as when another device has not uploaded it yet. */
const RETRY_MISSING = 30_000;
const MAX_RETRIES = 20;
/** The server answered for good: the request was bad, no longer allowed, or the bytes will never fit. */
const PERMANENT = new Set([400, 403, 404, 413, 415]);

class Images {
	#urls = $state<Record<string, string>>({});
	#misses = new Map<string, number>();
	#loading = new Set<string>();
	/** How many images each task is still encoding, so details can show where they will land. */
	adding = $state<Record<string, number>>({});
	/** The image open full screen. */
	viewing = $state<{ taskId: string; id: string } | null>(null);

	/** The object URL of an image's bytes once this device has them. `load` fetches them. */
	url(id: string, size: ImageSize): string | undefined {
		return this.#urls[imageKey(id, size)];
	}

	/** Fetches an image's bytes unless this device has them. A miss asks again a while later, a bounded number of times. */
	async load(space: string | null, id: string, size: ImageSize): Promise<void> {
		const key = imageKey(id, size);
		if (this.#urls[key] || this.#loading.has(key)) return;
		this.#loading.add(key);
		try {
			const local = await readBytes(id, size).catch(() => undefined);
			if (local) return this.#show(key, local);
			const response = await fetch(imageUrl(space, id, size), { credentials: 'include' });
			if (!response.ok) return this.#missed(space, id, size);
			const blob = await response.blob();
			this.#show(key, blob);
			await writeBytes(id, size, blob).catch(() => undefined);
		} catch {
			this.#missed(space, id, size);
		} finally {
			this.#loading.delete(key);
		}
	}

	#missed(space: string | null, id: string, size: ImageSize) {
		const key = imageKey(id, size);
		const misses = (this.#misses.get(key) ?? 0) + 1;
		this.#misses.set(key, misses);
		if (misses <= MAX_RETRIES) setTimeout(() => void this.load(space, id, size), RETRY_MISSING);
	}

	#show(key: string, blob: Blob) {
		this.#misses.delete(key);
		this.#urls = { ...this.#urls, [key]: URL.createObjectURL(blob) };
	}

	/** Encodes each image file and appends it to the task. Files that are not images are skipped. */
	async attach(taskId: string, files: Iterable<File>) {
		const space = store.homeOf(taskId);
		for (const file of files) {
			if (!file.type.startsWith('image/')) continue;
			this.adding = { ...this.adding, [taskId]: (this.adding[taskId] ?? 0) + 1 };
			try {
				const { width, height, sizes } = await encodeImage(file);
				const id = newId();
				await keepNew(space, id, sizes);
				this.#show(imageKey(id, 'full'), sizes.full);
				this.#show(imageKey(id, 'thumb'), sizes.thumb);
				const task = store.task(taskId);
				if (task) store.updateTask(taskId, { images: [...task.images, { id, width, height }] });
			} catch (error) {
				reportError(error);
				toasts.show('Could not attach that image');
			} finally {
				this.adding = { ...this.adding, [taskId]: (this.adding[taskId] ?? 1) - 1 };
			}
		}
	}

	remove(taskId: string, id: string) {
		const task = store.task(taskId);
		const index = task?.images.findIndex(image => image.id === id) ?? -1;
		const removed = task?.images[index];
		if (!task || !removed) return;
		store.updateTask(taskId, { images: task.images.filter(image => image.id !== id) });
		if (this.viewing?.id === id) this.viewing = null;
		toasts.show('Deleted image', { label: 'Undo', run: () => this.#restore(taskId, removed, index) });
	}

	/** Puts one image back where it was, into the list as it is now, so changes made since stay. */
	#restore(taskId: string, image: ImageRef, index: number) {
		const current = store.task(taskId)?.images;
		if (!current || current.some(other => other.id === image.id)) return;
		store.updateTask(taskId, { images: current.toSpliced(index, 0, image) });
	}

	/**
	 * Uploads every queued image, each to its own space, before the writes that list them. Throws when the server
	 * cannot be reached, so those writes wait too; an upload the server refuses for good is dropped instead of
	 * blocking them.
	 */
	async upload() {
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
}

export const images = new Images();
