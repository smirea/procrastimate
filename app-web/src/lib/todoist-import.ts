import { strFromU8, unzipSync } from 'fflate';
import { readTodoistBackup, type TodoistBackup } from 'shared/todoist.ts';

/** Unzips a Todoist backup in the browser. Nothing is uploaded. */
export async function readBackupZip(file: Blob, now: Date): Promise<TodoistBackup> {
	const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: entry => /\.csv$/i.test(entry.name) });
	const files = Object.entries(entries).map(([name, bytes]) => ({ name, text: strFromU8(bytes) }));
	return readTodoistBackup(files, now);
}
