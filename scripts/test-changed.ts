/**
 * Runs the unit tests related to the files lefthook passes in: every `*.test.ts` whose imports reach a changed file,
 * followed through the import graph, plus the colocated test of a changed file. Web end-to-end specs are skipped.
 * `swift test` runs when the iOS app's inputs changed: `app-ios`, `shared`, or the Swift generator.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = join(import.meta.dir, '..');
const SOURCE_DIRS = ['shared', 'server', 'app-web/src', 'scripts'];
const IOS_INPUTS = ['app-ios/', 'shared/', 'scripts/generate/'];

const files = process.argv
	.slice(2)
	.flatMap(arg => arg.split(/\s+/))
	.map(file => file.trim().replaceAll('\\', '/').replace(/^\.\//, ''))
	.filter(Boolean);

const isE2E = (file: string) => file.includes('/e2e/') || file.endsWith('.e2e.ts');

function walk(dir: string, out: string[]) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === 'generated' || entry.name.startsWith('.')) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) walk(path, out);
		else if (/\.(ts|mts|svelte)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(path);
	}
}

const sources: string[] = [];
for (const dir of SOURCE_DIRS) if (existsSync(join(root, dir))) walk(join(root, dir), sources);

function resolveImport(from: string, specifier: string): string | null {
	let base: string;
	if (specifier.startsWith('.')) base = resolve(dirname(from), specifier);
	else if (specifier.startsWith('shared/')) base = join(root, specifier);
	else if (specifier.startsWith('#lib/') || specifier.startsWith('$lib/')) {
		base = join(root, 'app-web/src/lib', specifier.slice(5));
	} else return null;
	for (const candidate of [base, `${base}.ts`, `${base}.mts`, join(base, 'index.ts')]) {
		if (existsSync(candidate) && /\.(ts|mts|svelte)$/.test(candidate)) return candidate;
	}
	return null;
}

/** A Svelte file's imports are in its script blocks; the transpiler reads TypeScript. */
function source(file: string): string {
	const text = readFileSync(file, 'utf8');
	if (!file.endsWith('.svelte')) return text;
	return [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n');
}

const transpiler = new Bun.Transpiler({ loader: 'ts' });
const importers = new Map<string, Set<string>>();
for (const file of sources) {
	for (const { path } of transpiler.scanImports(source(file))) {
		const target = resolveImport(file, path);
		if (!target) continue;
		importers.set(target, (importers.get(target) ?? new Set()).add(file));
	}
}

/** Every source that reaches one of `changed` through its imports, `changed` included. */
function dependents(changed: readonly string[]): Set<string> {
	const seen = new Set(changed);
	const queue = [...changed];
	for (let i = 0; i < queue.length; i++) {
		for (const importer of importers.get(queue[i]!) ?? []) {
			if (!seen.has(importer)) {
				seen.add(importer);
				queue.push(importer);
			}
		}
	}
	return seen;
}

const changed = files.filter(file => !isE2E(file) && /\.(ts|mts|svelte)$/.test(file)).map(file => join(root, file));
const selected = [...dependents(changed)].filter(file => file.endsWith('.test.ts') && !isE2E(relative(root, file)));
const ios = files.some(file => IOS_INPUTS.some(prefix => file.startsWith(prefix)) && !file.endsWith('.md'));

if (selected.length > 0) {
	const result = spawnSync('bun', ['test', ...selected.toSorted()], { cwd: root, stdio: 'inherit' });
	if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

if (ios) {
	const generated = spawnSync('bun', ['scripts/generate/index.ts'], { cwd: root, stdio: 'inherit' });
	if ((generated.status ?? 1) !== 0) process.exit(generated.status ?? 1);
	const result = spawnSync('swift', ['test'], { cwd: join(root, 'app-ios'), stdio: 'inherit' });
	if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
		console.error('swift is not installed; skipping app-ios tests. CI core-linux still runs them.');
	} else if ((result.status ?? 1) !== 0) {
		process.exit(result.status ?? 1);
	}
}
