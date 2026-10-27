import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
// Imported rather than read so `bun --watch` regenerates when it changes. Read generator inputs the same way.
import indexCss from '../../app-web/src/index.css' with { type: 'text' };
import { generate } from 'sync-engine/schema';
import { syncSchema } from '../../shared/db/sync';
import { handWrittenModels } from './models';
import { tokenFiles } from './tokens';
import { swiftRowsModule, type SwiftModel } from './tables';
import { tableDefaults, zodModule } from './zod';

/**
 * A file is rewritten only when its content changes, so watchers do not loop. The outputs are git-ignored: every
 * start, build, check, and test entry point runs this first.
 */

const root = join(import.meta.dir, '../..');

const json = (value: unknown) => `${JSON.stringify(value, null, '\t')}\n`;

const read = (path: string) => {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return null;
	}
};

const written: string[] = [];
function write(path: string, next: string) {
	const file = join(root, path);
	if (read(file) === next) return;
	written.push(relative(root, file));
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, next);
}

write('shared/db/generated/zod.ts', zodModule());
write('app-ios/Sources/App/Generated/SyncSchema.swift', generate({ schema: syncSchema }).swift);

// The contract imports the row schemas just written, so it loads only now.
const { minifyContractRouter } = await import('@orpc/contract');
const { contract } = await import('../../shared/api/contract');
const { agentOpenApiDocument, namedSchemas, openApiDocument } = await import('./openapi');
const { swiftModule } = await import('./swift');
const openApi = json(await openApiDocument());
const components = namedSchemas();
write('shared/api/generated/openapi.json', openApi);
write('shared/api/generated/agent-openapi.json', json(await agentOpenApiDocument()));
write('app-web/src/lib/generated/contract.json', json(minifyContractRouter(contract)));
write(
	'app-ios/Sources/Core/Generated/API.swift',
	swiftModule({ components, paths: JSON.parse(openApi).paths, tableDefaults: tableDefaults() }),
);
write(
	'app-ios/Sources/App/Generated/SyncedTables.swift',
	swiftRowsModule(
		Object.fromEntries(
			Object.entries(components)
				.filter(([, schema]) => typeof schema['x-table'] === 'string')
				.map(([name, schema]) => [
					schema['x-table'] as string,
					{
						name,
						properties: Object.keys(schema.properties ?? {}),
						required: schema.required ?? [],
					} satisfies SwiftModel,
				]),
		),
	),
);

for (const [path, contents] of Object.entries(tokenFiles(indexCss))) write(path, contents);

const models = handWrittenModels(root, ['app-ios/Sources']);
if (models.length) {
	console.error(
		`Swift declares models the shared schemas should define. Give the Zod schema an id instead, or list the type in scripts/generate/models.ts with why it stays:\n${models.join('\n')}`,
	);
	process.exit(1);
}

if (written.length) console.log(`generate: wrote ${written.join(', ')}`);
