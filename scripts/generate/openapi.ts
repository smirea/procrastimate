import { OpenAPIGenerator } from '@orpc/openapi';
import { ZodToJsonSchemaConverter } from '@orpc/zod';
import { z } from 'zod';
import { agentContract, contract } from '../../shared/api/contract';
// Register the shared model's schemas that no endpoint uses.
import '../../shared/dictation';
import '../../shared/format';
import '../../shared/links';
import '../../shared/markdown';
import '../../shared/name-search';
import '../../shared/quick-add';
import '../../shared/ramble/protocol';
import '../../shared/search';
import '../../shared/snapshot';
import '../../shared/store';
import '../../shared/subtasks';
import '../../shared/theme';
import '../../shared/todoist';
import '../../shared/triggers';
import '../../shared/views';
import type { Schema } from './swift';

/**
 * The contract as OpenAPI. Every shared schema with an `id` in zod's registry becomes a named component, through
 * the `$defs` zod writes for it, which oRPC hoists.
 */
export function openApiDocument() {
	const generator = new OpenAPIGenerator({ converters: [new ZodToJsonSchemaConverter()] });
	return generator.generate(contract, { version: '3.1.1', base: { info: { title: 'ProcrastiMate', version: '1' } } });
}

/** What an AI account may call, as `/api/docs/openapi` serves it with the caller's origin as its server. */
export function agentOpenApiDocument() {
	const generator = new OpenAPIGenerator({ converters: [new ZodToJsonSchemaConverter()] });
	return generator.generate(agentContract, {
		version: '3.1.1',
		base: {
			info: {
				title: 'ProcrastiMate agent API',
				version: '1',
				description: 'The routes an AI account may call with its `pm.<ownerId>.<secret>` token.',
			},
			components: { securitySchemes: { token: { type: 'http', scheme: 'bearer' } } },
			security: [{ token: [] }],
		},
	});
}

/**
 * Every named schema, including the ones no endpoint uses, as JSON Schema with `$ref`s between them. The Swift
 * generator types the whole shared model from this, not only what crosses the network.
 */
export function namedSchemas(): Record<string, Schema> {
	const { schemas } = z.toJSONSchema(z.globalRegistry, {
		target: 'draft-2020-12',
		io: 'input',
		unrepresentable: 'any',
		uri: id => `#/components/schemas/${id}`,
	});
	// zod's JSON Schema type is wider than the subset `Schema` reads, and the Swift generator rejects the rest.
	return Object.fromEntries(
		Object.entries(schemas).map(([id, schema]) => {
			const { $schema: _, $id: __, ...rest } = schema as Record<string, unknown>;
			return [id, rest as Schema];
		}),
	);
}
