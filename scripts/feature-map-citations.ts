import { Glob } from 'bun';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const MAPS = '.cursor/skills/verify-procrastimate/features';

export type Citation = {
	map: string;
	line: number;
	kind: 'file' | 'test' | 'swift' | 'project' | 'artifact';
	cited: string;
	/** The repo path of the spec a test title is cited `in`; the title must live there. */
	spec?: string;
};

const files = (pattern: string) =>
	[...new Glob(pattern).scanSync({ cwd: ROOT })].filter(path => !path.includes('node_modules'));

function testTitles(paths: string[]) {
	const titles = new Map<string, Set<string>>();
	for (const path of paths) {
		const source = readFileSync(join(ROOT, path), 'utf8');
		const found = new Set<string>();
		for (const match of source.matchAll(/\b(?:test|it|describe)(?:\.\w+)*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g))
			found.add(match[2]!.replace(/\\(.)/g, '$1'));
		titles.set(path, found);
	}
	return titles;
}

/** What the maps may cite: test files, their test titles, Swift test classes and methods, and Playwright projects. */
function inventory() {
	const e2e = files('app-web/e2e/**/*.e2e.ts');
	const unit = files('{shared,server,app-web,scripts}/**/*.test.ts');
	const swift = files('app-ios/Tests/**/*.swift').map(path => readFileSync(join(ROOT, path), 'utf8'));
	const config = readFileSync(join(ROOT, 'app-web/playwright.config.ts'), 'utf8');
	const specs = e2e.map(path => readFileSync(join(ROOT, path), 'utf8')).join('\n');
	return {
		paths: new Set([...e2e.map(path => path.replace(/^app-web\//, '')), ...unit]),
		titles: testTitles([...e2e, ...unit]),
		swift: new Set(swift.flatMap(source => [...source.matchAll(/\b(?:class|struct|func) (\w+)/g)].map(m => m[1]!))),
		projects: new Set([...config.matchAll(/name: '(\w+)'/g)].map(m => m[1]!)),
		specs,
	};
}

const SPEC = /(?:e2e\/[\w/.-]+\.e2e\.ts|[\w/.-]+\.test\.ts)/;
const SWIFT_TEST = /^(?:[A-Z]\w*Tests(?:\.\w+)?|test_\w+)$/;

/** Every backticked test file, test name after `Test:` or `covered by` (a bare camelCase name is a Swift test), Swift test, Playwright project, and saved screenshot in the maps. */
export function citations(): Citation[] {
	const found: Citation[] = [];
	for (const map of files(`${MAPS}/*.md`).sort()) {
		readFileSync(join(ROOT, map), 'utf8')
			.split('\n')
			.forEach((text, index) => {
				const line = index + 1;
				const add = (kind: Citation['kind'], cited: string) => found.push({ map, line, kind, cited });
				for (const [, code] of text.matchAll(/`([^`]+)`/g)) {
					for (const path of code!.match(new RegExp(SPEC, 'g')) ?? []) add('file', path);
					for (const project of code!.matchAll(/--project[= ](\w+)/g)) add('project', project[1]!);
					if (SWIFT_TEST.test(code!)) add('swift', code!);
					for (const artifact of code!.match(/[\w/.-]+\.png/g) ?? []) add('artifact', artifact);
				}
				for (const [, run] of text.matchAll(/\b(?:[Tt]ests?(?: [\w ]+)?:|covered by) ([^]*?)(?:\.(?: |$)|$)/g)) {
					// A title binds to the next spec named after it, as in "`title` in `e2e/x.e2e.ts`".
					const unbound: Citation[] = [];
					for (const [, code] of run!.matchAll(/`([^`]+)`/g)) {
						const spec = code!.match(SPEC)?.[0];
						if (spec) {
							for (const title of unbound.splice(0)) title.spec = spec.startsWith('e2e/') ? `app-web/${spec}` : spec;
							continue;
						}
						if (SWIFT_TEST.test(code!) || /^(?:bun|swift|xcodebuild) |\.png$/.test(code!)) continue;
						if (/^[a-z]\w*$/.test(code!)) add('swift', code!);
						else unbound.push(found[found.push({ map, line, kind: 'test', cited: code! }) - 1]!);
					}
				}
			});
	}
	return found;
}

/** Citations that name nothing real, each with the reason. */
export function staleCitations() {
	const have = inventory();
	const allTitles = new Set([...have.titles.values()].flatMap(set => [...set]));
	const stale: (Citation & { reason: string })[] = [];
	for (const citation of citations()) {
		const { kind, cited } = citation;
		const missing =
			kind === 'test' && citation.spec
				? !have.titles.get(citation.spec)?.has(cited) && `no test with this exact title in ${citation.spec}`
				: kind === 'file'
					? !have.paths.has(cited) && `no file ${cited.startsWith('e2e/') ? `app-web/${cited}` : cited}`
					: kind === 'test'
						? !allTitles.has(cited) && 'no test with this exact title in app-web/e2e or any *.test.ts'
						: kind === 'swift'
							? !cited.split('.').every(part => have.swift.has(part)) && 'no such test class or method in app-ios/Tests'
							: kind === 'project'
								? !have.projects.has(cited) && 'no such project in app-web/playwright.config.ts'
								: !have.specs.includes(basename(cited, '.png')) && 'no e2e spec saves this screenshot';
		if (missing) stale.push({ ...citation, reason: missing });
	}
	return stale;
}

if (import.meta.main) {
	const stale = staleCitations();
	for (const { map, line, cited, reason } of stale) console.log(`${map}:${line}  \`${cited}\`  ${reason}`);
	console.log(`${stale.length} stale of ${citations().length} citations`);
}
