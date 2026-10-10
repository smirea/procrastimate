#!/usr/bin/env bun
// Renames the screenshots `xcresulttool export attachments` wrote to `<parity-id>.png`, the name `snap` gave them.
// Usage: bun scripts/parity-attachments.ts <exported-dir> <out-dir>
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

type Manifest = {
	testIdentifier: string;
	attachments: { exportedFileName: string; suggestedHumanReadableName: string }[];
}[];

const [exported, out] = process.argv.slice(2);
if (!exported || !out) throw new Error('Usage: bun scripts/parity-attachments.ts <exported-dir> <out-dir>');

const manifest: Manifest = JSON.parse(readFileSync(join(exported, 'manifest.json'), 'utf8'));
mkdirSync(out, { recursive: true });
const seen = new Set<string>();
for (const test of manifest) {
	for (const attachment of test.attachments) {
		const extension = extname(attachment.exportedFileName);
		if (extension !== '.png') continue;
		// Xcode suggests `<name>_<index>_<UUID>.png` for a named attachment.
		const id = attachment.suggestedHumanReadableName.replace(/(_\d+_[0-9A-F-]{36})?\.\w+$/i, '');
		if (seen.has(id)) throw new Error(`Two screenshots are named ${id}; each parity id snaps once.`);
		seen.add(id);
		copyFileSync(join(exported, attachment.exportedFileName), join(out, `${id}${extension}`));
		console.log(`${test.testIdentifier}: ${id}${extension}`);
	}
}
if (!seen.size) throw new Error(`No screenshots in ${exported}/manifest.json.`);
