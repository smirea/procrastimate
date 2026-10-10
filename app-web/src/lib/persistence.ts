import { emptySnapshot, parseSnapshot, type Snapshot } from 'shared/snapshot.ts';

const STORAGE_KEY = 'procrastimate';

export function loadSnapshot(now: number): Snapshot {
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return emptySnapshot(now);
	try {
		return parseSnapshot(JSON.parse(raw), now);
	} catch {
		return emptySnapshot(now);
	}
}

export function saveSnapshot(snapshot: Snapshot) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}
