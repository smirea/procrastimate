import type { FeedbackProject } from 'shared/api/contract.ts';
import { titleSuggestionSchema, type TitleSuggestion } from 'shared/sharing.ts';
import { FILE_MAX_BYTES, FILE_PART_BYTES, FILE_TYPE, filePartCount, IMAGES_PATH } from 'shared/images.ts';
import { newId } from 'shared/id.ts';
import { api } from './api.ts';
import { DEVICE_KEYS } from './device.ts';

/**
 * The popup handoff from `@stefan.inc/feedback-engine` (`window.open` + `postMessage`) to `/feedback`. The popup runs
 * on ProcrastiMate's own origin, so every upload and task creation uses the signed-in browser session cookie with no
 * token ever leaving ProcrastiMate.
 */

export type FeedbackDraft = {
	/** The name the package generated. */
	title: string;
	/** What the server names the task from while it keeps `title`. Packages before 1.11 send none. */
	titleSuggestion?: TitleSuggestion;
	app?: string;
	project?: string;
	projects: string[];
	space?: string;
	image: { full: Blob; thumb: Blob; width: number; height: number };
	report: string;
	/** The app's own files, such as its saved state, attached beside `feedback.json`. Packages before 1.12 send none. */
	files: File[];
};

export type FeedbackPlace = { projectId?: string; sectionId?: string };

export const FEEDBACK_READY = 'feedback:ready';
export const FEEDBACK_DRAFT = 'feedback:draft';
export const FEEDBACK_POSTED = 'feedback:posted';
export const FEEDBACK_CANCELLED = 'feedback:cancelled';

const nonEmptyString = (value: unknown): string | undefined =>
	typeof value === 'string' && value.trim() ? value : undefined;

const positiveInt = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;

/** Validates the `feedback:draft` payload sent by the opener for this popup's `nonce`. */
export function parseDraftMessage(data: unknown, expectedNonce: string): FeedbackDraft | null {
	if (!expectedNonce || !data || typeof data !== 'object') return null;
	const record = data as Record<string, unknown>;
	if (record.type !== FEEDBACK_DRAFT || record.nonce !== expectedNonce) return null;
	if (typeof record.title !== 'string' || typeof record.report !== 'string') return null;
	const image = record.image;
	if (!image || typeof image !== 'object') return null;
	const img = image as Record<string, unknown>;
	const width = positiveInt(img.width);
	const height = positiveInt(img.height);
	if (!(img.full instanceof Blob) || !(img.thumb instanceof Blob) || !width || !height) return null;
	if (!Array.isArray(record.projects) || !record.projects.every(item => typeof item === 'string')) return null;
	const projects = record.projects.map(item => item.trim()).filter(Boolean);
	if (!projects.length) return null;
	const files = record.files ?? [];
	if (!Array.isArray(files) || !files.every(file => file instanceof File && file.name)) return null;
	const suggestion = titleSuggestionSchema.safeParse(record.titleSuggestion);
	return {
		title: record.title,
		...(suggestion.success && { titleSuggestion: suggestion.data }),
		app: nonEmptyString(record.app),
		project: nonEmptyString(record.project),
		projects,
		space: nonEmptyString(record.space),
		image: { full: img.full, thumb: img.thumb, width, height },
		report: record.report,
		files,
	};
}

/** Matches a project by id or by name ignoring case. Own projects precede shared ones in `projects`. */
export function namedFeedbackProject(projects: readonly FeedbackProject[], name: string): FeedbackProject | undefined {
	const lower = name.toLowerCase();
	return (
		projects.find(project => project.id === name) ?? projects.find(project => project.name.toLowerCase() === lower)
	);
}

/**
 * The projects the popup picker offers: scoped to `space` when named, then narrowed to the host app's required
 * `projects` whitelist in its order. The Inbox is never offered.
 */
export function pickFeedbackProjects(
	all: readonly FeedbackProject[],
	userId: string,
	options: { space?: string; projects: readonly string[] },
): { projects: FeedbackProject[]; missing: string[] } {
	const inSpace = options.space ? all.filter(project => (project.owner?.id ?? userId) === options.space) : [...all];
	const projects: FeedbackProject[] = [];
	const missing: string[] = [];
	for (const name of options.projects) {
		const match = namedFeedbackProject(inSpace, name);
		if (!match) missing.push(name);
		else if (!projects.includes(match)) projects.push(match);
	}
	return { projects, missing };
}

/**
 * The project the picker opens on: the one the host app names, else the user's last posted project if offered, else
 * the first offered project. `undefined` only when none of the whitelisted projects exist for this user.
 */
export function startingFeedbackProject(
	listed: readonly FeedbackProject[],
	options: { project?: string },
	lastId: string | undefined,
): string | undefined {
	if (options.project) return namedFeedbackProject(listed, options.project)?.id;
	if (lastId && listed.some(project => project.id === lastId)) return lastId;
	return listed[0]?.id;
}

type StoredLast = Record<string, string | null>;

function readStoredLast(): StoredLast {
	try {
		const raw = localStorage.getItem(DEVICE_KEYS.feedbackLastProject);
		const parsed = raw ? (JSON.parse(raw) as unknown) : null;
		return parsed && typeof parsed === 'object' ? (parsed as StoredLast) : {};
	} catch {
		return {};
	}
}

export function loadLastFeedbackProject(userId: string): string | undefined {
	const value = readStoredLast()[userId];
	return typeof value === 'string' && value ? value : undefined;
}

export function saveLastFeedbackProject(userId: string, projectId: string | undefined): void {
	try {
		const next = { ...readStoredLast(), [userId]: projectId ?? null };
		localStorage.setItem(DEVICE_KEYS.feedbackLastProject, JSON.stringify(next));
	} catch {
		// Private browsing may refuse storage; picking still works without remembering.
	}
}

/** The server's answer as an error, with its `message` when it has one. */
async function failure(response: Response): Promise<Error> {
	const text = await response.text().catch(() => '');
	let message: string | undefined;
	try {
		message = (JSON.parse(text) as { message?: string }).message;
	} catch {
		// Plain-text or proxy error body.
	}
	return new Error(message ? `ProcrastiMate: ${message}` : `ProcrastiMate answered ${response.status}.`);
}

async function request(url: string, init: RequestInit): Promise<Response> {
	const response = await fetch(url, { ...init, credentials: 'include' });
	if (!response.ok) throw await failure(response);
	return response;
}

/**
 * Uploads one file of the draft under `id`: whole when it fits one request, else as a multipart upload, as the
 * attachment queue does, so an app's saved state of any size reaches the task.
 */
async function uploadFile(space: string | undefined, id: string, file: Blob, name: string, type: string) {
	const url = (extra: Record<string, string> = {}) =>
		`${IMAGES_PATH}?${new URLSearchParams({ ...(space ? { space } : {}), id, size: 'file', name, type, ...extra })}`;
	const octets = { 'Content-Type': FILE_TYPE };
	if (file.size <= FILE_PART_BYTES) {
		await request(url(), { method: 'PUT', headers: octets, body: file });
		return;
	}
	const begun = (await (await request(url(), { method: 'POST' })).json()) as { upload: string | null };
	if (begun.upload === null) return;
	const etags: string[] = [];
	for (let index = 0; index < filePartCount(file.size); index++) {
		const part = await request(url({ upload: begun.upload, part: String(index + 1) }), {
			method: 'PUT',
			headers: octets,
			body: file.slice(index * FILE_PART_BYTES, (index + 1) * FILE_PART_BYTES),
		});
		etags.push(((await part.json()) as { etag: string }).etag);
	}
	await request(url({ upload: begun.upload }), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ parts: etags }),
	});
}

/**
 * Uploads the image, thumbnail, `feedback.json`, and the app's own files to ProcrastiMate's own origin with the session
 * cookie, then creates the task with all attachments in one write. Uses the chosen project's space so posting to a
 * shared project credits the signed-in human guest. A `title` still equal to the generated one carries the draft's
 * suggestion, so the server names the task once it exists; an edited one is posted as typed.
 */
export async function postFeedbackTask(
	draft: FeedbackDraft,
	title: string,
	place: FeedbackPlace,
	project: FeedbackProject | undefined,
	step: (text: string) => void,
): Promise<{ id: string; url: string; destination: string }> {
	if (!project || !place.projectId) {
		throw new Error('Choose one of the listed projects to post feedback into.');
	}
	const space = project.owner?.id;
	const imageId = newId();
	const taskId = newId();
	// A task's file attachment has bytes, so an empty file of the app's has nothing to attach.
	const files = [new File([draft.report], 'feedback.json', { type: 'application/json' }), ...draft.files]
		.filter(file => file.size > 0)
		.map(file => ({ id: newId(), file, type: file.type || FILE_TYPE }));
	const tooLarge = files.find(({ file }) => file.size > FILE_MAX_BYTES);
	if (tooLarge) {
		throw new Error(
			`${tooLarge.file.name} is over the ${FILE_MAX_BYTES / 1e9} GB ProcrastiMate keeps as one attachment.`,
		);
	}

	const putImage = async (size: 'full' | 'thumb', blob: Blob) => {
		const query = new URLSearchParams({ ...(space ? { space } : {}), id: imageId, size });
		await request(`${IMAGES_PATH}?${query}`, {
			method: 'PUT',
			headers: { 'Content-Type': blob.type || 'image/jpeg' },
			body: blob,
		});
	};

	step('Uploading the image');
	await putImage('full', draft.image.full);
	step('Uploading the thumbnail');
	await putImage('thumb', draft.image.thumb);
	for (const { id, file, type } of files) {
		step(`Uploading ${file.name}`);
		await uploadFile(space, id, file, file.name, type);
	}
	step('Creating the task');
	await api.tasks.create({
		query: space ? { space } : {},
		body: {
			id: taskId,
			title,
			...(title === draft.title && draft.titleSuggestion && { titleSuggestion: draft.titleSuggestion }),
			projectId: place.projectId ?? null,
			sectionId: place.sectionId ?? null,
			attachments: [
				{ id: imageId, width: draft.image.width, height: draft.image.height },
				...files.map(({ id, file, type }) => ({ id, name: file.name, type, bytes: file.size })),
			],
		},
	});
	const section = project?.sections.find(candidate => candidate.id === place.sectionId);
	const destination = [project?.name ?? 'Inbox', section?.name].filter(Boolean).join(' / ');
	const url = `${location.origin}/inbox?task=${encodeURIComponent(taskId)}`;
	return { id: taskId, url, destination };
}

/**
 * Stashes a received draft in IndexedDB when the signed-out user chooses Google or Apple sign-in, which navigates away
 * from `/feedback` and back. Stashed drafts expire after 15 minutes so nothing lingers.
 */
const STASH_DB = 'procrastimate-feedback-drafts';
const STASH_STORE = 'drafts';
const STASH_TTL_MS = 15 * 60_000;

type StashedEntry = { nonce: string; draft: FeedbackDraft; openerOrigin: string | null; at: number };

function openStash(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(STASH_DB, 1);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(STASH_STORE)) {
				request.result.createObjectStore(STASH_STORE, { keyPath: 'nonce' });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

export async function stashDraft(nonce: string, draft: FeedbackDraft, openerOrigin: string | null): Promise<void> {
	if (typeof indexedDB === 'undefined') return;
	try {
		const db = await openStash();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STASH_STORE, 'readwrite');
			const store = tx.objectStore(STASH_STORE);
			const cutoff = Date.now() - STASH_TTL_MS;
			const cursor = store.openCursor();
			cursor.onsuccess = () => {
				const row = cursor.result;
				if (!row) return;
				if ((row.value as StashedEntry).at < cutoff) row.delete();
				row.continue();
			};
			store.put({ nonce, draft, openerOrigin, at: Date.now() } satisfies StashedEntry);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
		db.close();
	} catch {
		// IndexedDB may be disabled in private browsing; email sign-in stays in-place without it.
	}
}

export async function takeStashedDraft(
	nonce: string,
): Promise<{ draft: FeedbackDraft; openerOrigin: string | null } | null> {
	if (typeof indexedDB === 'undefined' || !nonce) return null;
	try {
		const db = await openStash();
		const entry = await new Promise<StashedEntry | undefined>((resolve, reject) => {
			const tx = db.transaction(STASH_STORE, 'readwrite');
			const store = tx.objectStore(STASH_STORE);
			const get = store.get(nonce);
			get.onsuccess = () => {
				const found = get.result as StashedEntry | undefined;
				if (found) store.delete(nonce);
				resolve(found);
			};
			get.onerror = () => reject(get.error);
		});
		db.close();
		if (!entry || Date.now() - entry.at > STASH_TTL_MS) return null;
		return { draft: entry.draft, openerOrigin: entry.openerOrigin };
	} catch {
		return null;
	}
}
