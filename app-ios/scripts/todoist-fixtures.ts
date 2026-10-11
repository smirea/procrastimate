#!/usr/bin/env bun
// Writes the files the import XCUITests pick in the document picker: the synthetic Todoist backup zipped with DEFLATE
// like Todoist zips one, a `.zip` that is not a zip, and a text file the picker must not offer.
// Usage: bun scripts/todoist-fixtures.ts <app Documents folder>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { todoistBackupFiles } from '../../shared/fixtures/todoist-backup.mts';

const [out] = process.argv.slice(2);
if (!out) throw new Error('Usage: bun scripts/todoist-fixtures.ts <dir>');

/** A plain zip: one local header and DEFLATE data per file, then the central directory. No ZIP64, no descriptors. */
function zip(files: { name: string; text: string }[]): Uint8Array {
	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	let offset = 0;
	for (const file of files) {
		const name = new TextEncoder().encode(file.name);
		const data = new TextEncoder().encode(file.text);
		const compressed = deflateRawSync(data);
		const crc = Bun.hash.crc32(data);
		const local = new DataView(new ArrayBuffer(30));
		local.setUint32(0, 0x04034b50, true);
		local.setUint16(4, 20, true);
		local.setUint16(8, 8, true);
		local.setUint32(14, crc, true);
		local.setUint32(18, compressed.length, true);
		local.setUint32(22, data.length, true);
		local.setUint16(26, name.length, true);
		locals.push(new Uint8Array(local.buffer), name, compressed);

		const central = new DataView(new ArrayBuffer(46));
		central.setUint32(0, 0x02014b50, true);
		central.setUint16(4, 20, true);
		central.setUint16(6, 20, true);
		central.setUint16(10, 8, true);
		central.setUint32(16, crc, true);
		central.setUint32(20, compressed.length, true);
		central.setUint32(24, data.length, true);
		central.setUint16(28, name.length, true);
		central.setUint32(42, offset, true);
		centrals.push(new Uint8Array(central.buffer), name);
		offset += 30 + name.length + compressed.length;
	}
	const size = centrals.reduce((sum, part) => sum + part.length, 0);
	const end = new DataView(new ArrayBuffer(22));
	end.setUint32(0, 0x06054b50, true);
	end.setUint16(8, files.length, true);
	end.setUint16(10, files.length, true);
	end.setUint32(12, size, true);
	end.setUint32(16, offset, true);
	return Buffer.concat([...locals, ...centrals, new Uint8Array(end.buffer)]);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'todoist-backup.zip'), zip(todoistBackupFiles));
writeFileSync(join(out, 'not-a-backup.zip'), 'not a zip');
writeFileSync(join(out, 'notes.txt'), 'Not a Todoist backup.');
console.log(`Wrote the Todoist import fixtures to ${out}`);
