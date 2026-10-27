import { imageUrl, type ImageSize } from 'shared/images.ts';
import { newId } from 'shared/id.ts';
import { reportError } from '../sentry.ts';
import { store } from '../store.svelte.ts';
import { toastUndo } from '../completion.ts';
import { toasts } from '../ui.svelte.ts';
import { encodeImage } from './encode.ts';
import { imageKey, keepNew, readBytes, writeBytes } from './local.ts';

/**
 * The database worker sends the queued images before every sync that carries writes (`upload.ts`), so the server
 * never hears of an image it cannot serve. See `docs/decisions/images.md`.
 */

/** How long a missing image waits before it is asked for again, as when another device has not uploaded it yet. */
const RETRY_MISSING = 30_000;
const MAX_RETRIES = 20;

export const imageFiles = (data: DataTransfer | null) =>
	[...(data?.files ?? [])].filter(file => file.type.startsWith('image/'));

class Images {
	#urls = $state<Record<string, string>>({});
	#misses = new Map<string, number>();
	#loading = new Set<string>();
	adding = $state<Record<string, number>>({});
	viewing = $state<{ taskId: string; id: string } | null>(null);

	url(id: string, size: ImageSize): string | undefined {
		return this.#urls[imageKey(id, size)];
	}

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
		toastUndo('Deleted image', { kind: 'image', taskId, image: removed, index });
	}
}

export const images = new Images();
