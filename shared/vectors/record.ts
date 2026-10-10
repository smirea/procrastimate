import { afterAll, describe as bunDescribe, test as bunTest } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Records shared functions' real inputs and outputs as test vectors for the Swift port. With `VECTORS=record`,
 * every call to a `recorded` function during the tests appends `{ fn, test, input, output }` to
 * `shared/vectors/<module>.json`. Outside record mode `recorded` returns the function itself.
 */
const RECORDING = process.env.VECTORS === 'record';

type Case = { fn: string; test: string; input: unknown[]; output: unknown };

const cases = new Map<string, Case[]>();
let current = '';

/** Dates become epoch milliseconds, maps become objects, and object keys sort, so files diff by behavior only. */
function plain(value: unknown): unknown {
	if (value instanceof Date) return value.getTime();
	if (value instanceof Map) return plain(Object.fromEntries(value));
	if (Array.isArray(value)) return value.map(item => (item === undefined ? null : plain(item)));
	if (value && typeof value === 'object') {
		const entries = Object.entries(value).filter(([, v]) => v !== undefined);
		return Object.fromEntries(
			entries.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, plain(v)]),
		);
	}
	return value === undefined ? null : value;
}

const written = new Map<string, number>();

function write(module: string) {
	const list = cases.get(module) ?? [];
	if (!list.length || written.get(module) === list.length) return;
	written.set(module, list.length);
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const file = { module, timeZone, cases: list };
	writeFileSync(join(import.meta.dir, `${module}.json`), `${JSON.stringify(file, null, '\t')}\n`);
}

/** Call at a test file's top level: the file's `afterAll` writes the module's vectors, since `bun test` skips exit hooks. */
export function recorded<F extends (...args: never[]) => unknown>(module: string, fn: F): F {
	if (!RECORDING) return fn;
	const list = cases.get(module) ?? [];
	cases.set(module, list);
	afterAll(() => write(module));
	return ((...args: Parameters<F>) => {
		const input = plain(args) as unknown[];
		const output = fn(...args);
		list.push({ fn: fn.name, test: current, input, output: plain(output) });
		return output;
	}) as F;
}

const path: string[] = [];

/** Formats a `test.each` title the way Bun does for the specifiers the tests use. */
function title(template: string, args: readonly unknown[]): string {
	let i = 0;
	return template.replace(/%[psdijo%]/g, spec => {
		if (spec === '%%') return '%';
		const arg = args[i++];
		return spec === '%s' || spec === '%d' || spec === '%i' ? String(arg) : JSON.stringify(arg);
	});
}

type Body = () => void | Promise<unknown>;

/** `describe` from `bun:test` that also names the vectors recorded inside it. */
export function describe(name: string, body: () => void) {
	bunDescribe(name, () => {
		path.push(name);
		try {
			body();
		} finally {
			path.pop();
		}
	});
}

function named(name: string, body: Body): Body {
	const full = [...path, name].join(' › ');
	return () => {
		current = full;
		return body();
	};
}

/** `test` and `test.each` from `bun:test` that also name the vectors recorded inside them. */
export const test = Object.assign((name: string, body: Body) => bunTest(name, named(name, body)), {
	each:
		<const T extends readonly unknown[]>(table: readonly T[]) =>
		(template: string, body: (...args: [...T]) => void | Promise<unknown>) => {
			table.forEach((row, index) => {
				const args = (Array.isArray(row) ? row : [row]) as unknown as [...T];
				const formatted = title(template, args);
				const name = formatted === template && table.length > 1 ? `${formatted} #${index}` : formatted;
				bunTest(
					name,
					named(name, () => body(...args)),
				);
			});
		},
});
