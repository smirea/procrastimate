import { FILE_MAX_BYTES, FILE_PART_BYTES, FILE_TYPE, imageUrl, previewType, type ImageSize } from 'shared/images.ts';
import { formatBytes } from 'shared/format.ts';
import { newId } from 'shared/id.ts';
import { isImage, type Attachment, type FileRef } from 'shared/values.ts';
import { reportError } from '../sentry.ts';
import { store } from '../store.svelte.ts';
import { toastUndo } from '../completion.ts';
import { toasts } from '../toasts.svelte.ts';
import { encodeImage } from './encode.ts';
import { imageKey, keepNew, pendingUploads, readBytes, writeBytes } from './local.ts';
import { UPLOADS_CHANNEL, type UploadMessage } from './upload.ts';

/**
 * Attachments on the page. An attached file shows at once, from the bytes it was picked as; the task lists it once
 * those bytes are safe on the device and queued. The database worker uploads the queue (`upload.ts`): an image before
 * the sync that lists it, a file in the background. See `docs/decisions/images.md`.
 */

/** How long a missing image waits before it is asked for again, as when another device has not uploaded it yet. */
const RETRY_MISSING = 30_000;
const MAX_RETRIES = 20;

export const droppedFiles = (data: DataTransfer | null) => [...(data?.files ?? [])];

/** Whether a file is kept as an image, re-encoded. SVG keeps its vectors as a file, which a canvas re-encode would flatten. */
export const isImageFile = (file: File) => file.type.startsWith('image/') && file.type !== 'image/svg+xml';

const fileRef = (id: string, file: File): FileRef => ({
	id,
	name: file.name.slice(0, 255) || 'File',
	type: file.type,
	bytes: file.size,
});

class Refused extends Error {}

class Attachments {
	#urls = $state<Record<string, string>>({});
	#misses = new Map<string, number>();
	#loading = new Set<string>();
	#channel = new BroadcastChannel(UPLOADS_CHANNEL);
	/** What each task is attaching, shown as tiles until the task lists it. An image not yet measured has no size. */
	adding = $state<Record<string, Attachment[]>>({});
	/** The bytes sent of each file still in the upload queue. */
	uploading = $state<Record<string, number>>({});
	opening = $state<Record<string, boolean>>({});
	viewing = $state<{ taskId: string; id: string } | null>(null);

	constructor() {
		this.#channel.addEventListener('message', ({ data }: MessageEvent<UploadMessage>) => {
			if (data.kind === 'progress') this.uploading[data.id] = data.sent;
			else if (data.kind === 'done') delete this.uploading[data.id];
		});
		void pendingUploads()
			.then(pending => {
				for (const { id, size } of pending) if (size === 'file') this.uploading[id] ??= 0;
			})
			.catch(() => undefined);
	}

	/** How far a long file's upload is, from 0 to 1, or undefined once the server has it. */
	progress(file: FileRef): number | undefined {
		const sent = this.uploading[file.id];
		return sent === undefined || file.bytes <= FILE_PART_BYTES ? undefined : sent / file.bytes;
	}

	url(id: string, size: ImageSize): string | undefined {
		return this.#urls[imageKey(id, size)];
	}

	async load(space: string | null, id: string, size: ImageSize): Promise<void> {
		const key = imageKey(id, size);
		if (this.#urls[key] || this.#loading.has(key)) return;
		this.#loading.add(key);
		try {
			const blob = await this.#bytes(space, id, size);
			if (!blob) return this.#missed(space, id, size);
			this.#show(key, blob);
		} catch {
			this.#missed(space, id, size);
		} finally {
			this.#loading.delete(key);
		}
	}

	/** An image size, from the device or else the server, which is then kept on the device so it shows offline. */
	async #bytes(space: string | null, id: string, size: ImageSize): Promise<Blob | null> {
		const local = await readBytes(id, size).catch(() => undefined);
		if (local) return local;
		const response = await fetch(imageUrl(space, id, size), { credentials: 'include' });
		if (!response.ok) return null;
		const blob = await response.blob();
		await writeBytes(id, size, blob).catch(() => undefined);
		return blob;
	}

	#missed(space: string | null, id: string, size: ImageSize) {
		const key = imageKey(id, size);
		const misses = (this.#misses.get(key) ?? 0) + 1;
		this.#misses.set(key, misses);
		if (misses <= MAX_RETRIES) setTimeout(() => void this.load(space, id, size), RETRY_MISSING);
	}

	#show(key: string, blob: Blob) {
		this.#misses.delete(key);
		const shown = this.#urls[key];
		this.#urls[key] = URL.createObjectURL(blob);
		if (shown) URL.revokeObjectURL(shown);
	}

	/**
	 * Shows every file at once, then keeps each on the device and lists it on the task, in order. A file the app
	 * cannot take is refused before it shows.
	 */
	async attach(taskId: string, files: Iterable<File>) {
		const space = store.homeOf(taskId);
		const picked: { id: string; file: File }[] = [];
		for (const file of files) {
			const name = file.name || 'File';
			if (!file.size) toasts.show(`${name} is empty`);
			else if (!isImageFile(file) && file.size > FILE_MAX_BYTES) {
				toasts.show(`${name} is over ${formatBytes(FILE_MAX_BYTES)}`);
			} else picked.push({ id: newId(), file });
		}
		const shown = picked.map(({ id, file }): Attachment => {
			if (!isImageFile(file)) return fileRef(id, file);
			this.#show(imageKey(id, 'thumb'), file);
			return { id, width: 0, height: 0 };
		});
		this.adding[taskId] = [...(this.adding[taskId] ?? []), ...shown];
		const settle = (id: string, as?: Attachment) => {
			const rest = (this.adding[taskId] ?? []).flatMap(item => (item.id !== id ? [item] : as ? [as] : []));
			if (rest.length) this.adding[taskId] = rest;
			else delete this.adding[taskId];
		};
		for (const { id, file } of picked) {
			try {
				const attachment = await this.#keep(space, id, file, () => settle(id, fileRef(id, file)));
				const task = store.task(taskId);
				if (task) store.updateTask(taskId, { attachments: [...task.attachments, attachment] });
			} catch (error) {
				if (error instanceof Refused) toasts.show(error.message);
				else {
					reportError(error);
					toasts.show('Could not attach that file');
				}
			} finally {
				settle(id);
			}
		}
	}

	/**
	 * An image becomes its two encoded sizes; anything else, an image no canvas decodes included (`undecoded`), its
	 * own bytes, uploaded in the background.
	 */
	async #keep(space: string | null, id: string, file: File, undecoded: () => void): Promise<Attachment> {
		const encoded = isImageFile(file) ? await encodeImage(file).catch(() => null) : null;
		if (encoded) {
			await keepNew(space, id, [
				['full', encoded.sizes.full],
				['thumb', encoded.sizes.thumb],
			]);
			this.#show(imageKey(id, 'full'), encoded.sizes.full);
			this.#show(imageKey(id, 'thumb'), encoded.sizes.thumb);
			return { id, width: encoded.width, height: encoded.height };
		}
		const kept = fileRef(id, file);
		if (isImageFile(file)) {
			undecoded();
			if (file.size > FILE_MAX_BYTES) throw new Refused(`${kept.name} is over ${formatBytes(FILE_MAX_BYTES)}`);
		}
		await keepNew(space, id, [['file', file]], { name: kept.name, type: kept.type });
		this.uploading[id] = 0;
		this.#channel.postMessage({ kind: 'queued' } satisfies UploadMessage);
		return kept;
	}

	/**
	 * Opens a file in a new tab when the browser shows its kind safely, else downloads it under its name: from the
	 * device while it still waits to upload, else from the server, which streams it. The tab opens inside the click,
	 * before anything is awaited, or the browser would block it as a popup.
	 */
	async open(taskId: string, file: FileRef) {
		const space = store.homeOf(taskId);
		const type = previewType(file);
		const tab = type ? window.open('', '_blank') : null;
		this.opening[file.id] = true;
		try {
			const local = await readBytes(file.id, 'file').catch(() => undefined);
			let url: string;
			if (local) {
				url = URL.createObjectURL(new Blob([local], { type: type ?? FILE_TYPE }));
				setTimeout(() => URL.revokeObjectURL(url), 60_000);
			} else {
				const path = imageUrl(space, file.id, 'file', { download: !type });
				const head = await fetch(path, { method: 'HEAD', credentials: 'include' });
				if (!head.ok) throw new Refused(`${file.name} has not finished uploading`);
				url = new URL(path, location.href).href;
			}
			if (tab) tab.location.href = url;
			else Object.assign(document.createElement('a'), { href: url, download: file.name }).click();
		} catch (error) {
			tab?.close();
			if (error instanceof Refused) toasts.show(error.message);
			else {
				reportError(error);
				toasts.show(`Could not open ${file.name}`);
			}
		} finally {
			delete this.opening[file.id];
		}
	}

	remove(taskId: string, id: string) {
		const task = store.task(taskId);
		const index = task?.attachments.findIndex(attachment => attachment.id === id) ?? -1;
		const removed = task?.attachments[index];
		if (!task || !removed) return;
		store.updateTask(taskId, { attachments: task.attachments.filter(attachment => attachment.id !== id) });
		if (this.viewing?.id === id) this.viewing = null;
		toastUndo(isImage(removed) ? 'Deleted image' : 'Deleted file', {
			kind: 'attachment',
			taskId,
			attachment: removed,
			index,
		});
	}
}

export const attachments = new Attachments();
