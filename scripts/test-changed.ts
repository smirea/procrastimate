/**
 * Runs the unit tests related to the files lefthook passes in.
 * Web end-to-end specs are skipped. `swift test` runs only when `app-ios` changed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const root = join(import.meta.dir, '..');
const skipImportNames = new Set(['index', 'testing', 'types', 'mod', 'app', 'env']);

const files = process.argv
	.slice(2)
	.flatMap(arg => arg.split(/\s+/))
	.map(file => file.trim().replaceAll('\\', '/').replace(/^\.\//, ''))
	.filter(Boolean);

function walkTests(dir: string, out: string[]) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === 'e2e' || entry.name.startsWith('.')) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) walkTests(path, out);
		else if (entry.name.endsWith('.test.ts')) out.push(path);
	}
}

const allTests: string[] = [];
for (const dir of ['shared', 'server', 'app-web', 'scripts']) {
	const abs = join(root, dir);
	if (existsSync(abs)) walkTests(abs, allTests);
}

const selected = new Set<string>();
let ios = false;

function add(path: string) {
	const rel = relative(root, path);
	if (rel.includes('/e2e/') || rel.endsWith('.e2e.ts')) return;
	if (existsSync(path)) selected.add(path);
}

for (const file of files) {
	if (file.startsWith('app-ios/') && !file.endsWith('.md')) ios = true;
	if (file.includes('/e2e/') || file.endsWith('.e2e.ts')) continue;
	if (file.endsWith('.test.ts')) {
		add(join(root, file));
		continue;
	}
	if (!file.endsWith('.ts') && !file.endsWith('.svelte')) continue;
	if (file.endsWith('.ts')) add(join(root, file.replace(/\.ts$/, '.test.ts')));
	const name = basename(file)
		.replace(/\.tsx?$/, '')
		.replace(/\.svelte$/, '');
	if (name.length < 3 || skipImportNames.has(name)) continue;
	const imported = new RegExp(`['"\`][^'"\`]*${RegExp.escape(name)}(?:\\.ts)?['"\`]`);
	for (const testFile of allTests) {
		if (imported.test(readFileSync(testFile, 'utf8'))) add(testFile);
	}
}

if (selected.size > 0) {
	const result = spawnSync('bun', ['test', ...selected], { cwd: root, stdio: 'inherit' });
	if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

if (ios) {
	const result = spawnSync('swift', ['test'], { cwd: join(root, 'app-ios'), stdio: 'inherit' });
	if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
		console.error('swift is not installed; skipping app-ios tests. CI core-linux still runs them.');
	} else if ((result.status ?? 1) !== 0) {
		process.exit(result.status ?? 1);
	}
}
