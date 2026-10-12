import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Swift types that are Codable but not generated, each with why it stays hand-written. Any other is a model the
 * shared schemas should define, so the run fails until it moves there or joins this list.
 */
const HAND_WRITTEN: Record<string, string> = {
	JSONValue: 'Any JSON value, which no schema names.',
	SyncOp: "An outbox op, whose fields Core's diff handles as JSON values.",
	NameHit: 'Generic over the matched item, which JSON Schema cannot express.',
	Lenient: 'A decoding helper that drops one bad array element.',
	StoredTask: "The stored document's loading rules in front of the generated task.",
};

const DECLARATION =
	/^\s*(?:public |private |fileprivate |internal )?(?:struct|enum) (\w+)(?:<[^>]*>)?:[^{]*\b(?:Codable|Decodable|Encodable)\b/gm;

/** Codable declarations under `folders` that are neither generated nor on the list above. */
export function handWrittenModels(root: string, folders: string[]): string[] {
	const found: string[] = [];
	for (const folder of folders) {
		for (const file of readdirSync(join(root, folder), { recursive: true }).map(String)) {
			if (!file.endsWith('.swift') || file.split('/').includes('Generated')) continue;
			const text = readFileSync(join(root, folder, file), 'utf8');
			for (const match of text.matchAll(DECLARATION)) {
				if (!HAND_WRITTEN[match[1]!]) found.push(`${relative(root, join(root, folder, file))}: ${match[1]}`);
			}
		}
	}
	return found;
}
