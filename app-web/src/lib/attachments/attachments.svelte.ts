import {
	FILE_MAX_BYTES,
	FILE_PART_BYTES,
	fileKind,
	filePartCount,
	imageUrl,
	partKey,
	type ByteKey,
	type ImageSize,
} from 'shared/images.ts';
import { formatBytes } from 'shared/format.ts';
import { newId } from 'shared/id.ts';
import { isImage, type Attachment, type FileRef } from 'shared/values.ts';
import { reportError } from '../sentry.ts';
import { store } from '../store.svelte.ts';
import { toastUndo } from '../completion.ts';
import { toasts } from '../ui.svelte.ts';
import { encodeImage } from './encode.ts';
import { imageKey, keepNew, readBytes, writeBytes } from './local.ts';

/**
 * The database worker sends the queued bytes before every sync that carries writes (`upload.ts`), so the server
 * never hears of an attachment it cannot serve. See `docs/decisions/images.md`.
 */

/** How long a missing image waits before it is asked for again, as when another device has not uploaded it yet. */
const RETRY_MISSING = 30_000;
const MAX_RETRIES = 20;

export const droppedFiles = (data: DataTransfer | null) => [...(data?.files ?? [])];

/** SVG keeps its vectors as a file, which a canvas re-encode would flatten. */
const encodable = (file: File) => file.type.startsWith('image/') && file.type !== 'image/svg+xml';

/**
 * The types a file may open as in a new tab. Anything that can run script there, such as HTML or SVG, downloads
 * instead, since the tab shares the app's origin.
 */
function previewType(file: FileRef): string | null {
	switch (fileKind(file)) {
		case 'pdf':
			return 'application/pdf';
		case 'text':
			return 'text/plain;charset=utf-8';
		case 'audio':
		case 'video':
			return /^(audio|video)\/[\w.+-]+$/.test(file.type) ? file.type : null;
		case 'image':
			return /^image\/(png|jpeg|gif|webp|avif)$/.test(file.type) ? file.type : null;
		default:
			return null;
	}
}

class Refused extends Error {}

class Attachments {
	#urls = $state<Record<string, string>>({});
	#misses = new Map<string, number>();
	#loading = new Set<string>();
	adding = $state<Record<string, number>>({});
	opening = $state<Record<string, boolean>>({});
	viewing = $state<{ taskId: string; id: string } | null>(null);

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

	/** The bytes of one row, from the device or else the server, cached once fetched. */
	async #bytes(space: string | null, id: string, key: ByteKey): Promise<Blob | null> {
		const local = await readBytes(id, key).catch(() => undefined);
		if (local) return local;
		const response = await fetch(imageUrl(space, id, key), { credentials: 'include' });
		if (!response.ok) return null;
		const blob = await response.blob();
		await writeBytes(id, key, blob).catch(() => undefined);
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
		this.#urls = { ...this.#urls, [key]: URL.createObjectURL(blob) };
	}

	async attach(taskId: string, files: Iterable<File>) {
		const space = store.homeOf(taskId);
		for (const file of files) {
			this.adding = { ...this.adding, [taskId]: (this.adding[taskId] ?? 0) + 1 };
			try {
				const attachment = await this.#keep(space, file);
				const task = store.task(taskId);
				if (task) store.updateTask(taskId, { attachments: [...task.attachments, attachment] });
			} catch (error) {
				if (error instanceof Refused) toasts.show(error.message);
				else {
					reportError(error);
					toasts.show('Could not attach that file');
				}
			} finally {
				this.adding = { ...this.adding, [taskId]: (this.adding[taskId] ?? 1) - 1 };
			}
		}
	}

	/** An image becomes its two encoded sizes; anything else, an image no canvas decodes included, its own bytes. */
	async #keep(space: string | null, file: File): Promise<Attachment> {
		const id = newId();
		const encoded = encodable(file) ? await encodeImage(file).catch(() => null) : null;
		if (encoded) {
			await keepNew(space, id, [
				['full', encoded.sizes.full],
				['thumb', encoded.sizes.thumb],
			]);
			this.#show(imageKey(id, 'full'), encoded.sizes.full);
			this.#show(imageKey(id, 'thumb'), encoded.sizes.thumb);
			return { id, width: encoded.width, height: encoded.height };
		}
		const name = file.name.slice(0, 255) || 'File';
		if (!file.size) throw new Refused(`${name} is empty`);
		if (file.size > FILE_MAX_BYTES) throw new Refused(`${name} is over ${formatBytes(FILE_MAX_BYTES)}`);
		const parts = Array.from(
			{ length: filePartCount(file.size) },
			(_, index) =>
				[partKey(index), file.slice(index * FILE_PART_BYTES, (index + 1) * FILE_PART_BYTES)] as [ByteKey, Blob],
		);
		await keepNew(space, id, parts);
		return { id, name, type: file.type, bytes: file.size };
	}

	/**
	 * Opens a file in a new tab when the browser shows its kind safely, else downloads it under its name. The tab opens
	 * before the bytes load, inside the click, or the browser would block it as a popup.
	 */
	async open(taskId: string, file: FileRef) {
		const space = store.homeOf(taskId);
		const type = previewType(file);
		const tab = type ? window.open('', '_blank') : null;
		this.opening = { ...this.opening, [file.id]: true };
		try {
			const parts: Blob[] = [];
			for (let index = 0; index < filePartCount(file.bytes); index++) {
				const part = await this.#bytes(space, file.id, partKey(index));
				if (!part) throw new Refused(`${file.name} has not finished uploading`);
				parts.push(part);
			}
			const blob = new Blob(parts, { type: type ?? 'application/octet-stream' });
			if (blob.size !== file.bytes) throw new Refused(`${file.name} has not finished uploading`);
			const url = URL.createObjectURL(blob);
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
			if (tab) tab.location.href = url;
			else {
				const link = Object.assign(document.createElement('a'), { href: url, download: file.name });
				link.click();
			}
		} catch (error) {
			tab?.close();
			if (error instanceof Refused) toasts.show(error.message);
			else {
				reportError(error);
				toasts.show(`Could not open ${file.name}`);
			}
		} finally {
			this.opening = { ...this.opening, [file.id]: false };
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
