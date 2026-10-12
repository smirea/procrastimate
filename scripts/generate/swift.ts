/**
 * Swift `Codable` types for every schema the OpenAPI document names or uses, plus one descriptor per operation.
 * It covers the JSON Schema the contract produces: objects, arrays, `$ref`, nullable `anyOf`, unions told apart by a
 * constant tag or tried in order, `allOf` over a union, string enums, and constants. Anything else fails the run,
 * so a new kind of schema cannot slip through as an untyped value.
 *
 * JSON tells a missing field from a `null` one, and a sync patch depends on it, so a property that is both optional
 * and nullable becomes `Nullable<T>?`: `nil` is missing, `.null` is `null`.
 */

type Schema = {
	$ref?: string;
	type?: string;
	properties?: Record<string, Schema>;
	required?: string[];
	additionalProperties?: Schema | boolean;
	items?: Schema;
	anyOf?: Schema[];
	oneOf?: Schema[];
	allOf?: Schema[];
	enum?: unknown[];
	const?: unknown;
	description?: string;
};

type Operation = {
	operationId: string;
	requestBody?: { content: { 'application/json': { schema: Schema } } };
	responses: Record<string, { content?: { 'application/json': { schema: Schema } } }>;
};

export type Document = {
	paths: Record<string, Record<string, Operation>>;
	components?: { schemas?: Record<string, Schema> };
};

type Prop = { json: string; swift: string; type: string; required: boolean; nullable: boolean };

type Decl =
	| { kind: 'struct'; name: string; props: Prop[] }
	| { kind: 'strings'; name: string; values: string[] }
	| { kind: 'tagged'; name: string; tag: string; variants: { value: string; type: string }[] }
	| { kind: 'untagged'; name: string; variants: { name: string; type: string }[] };

const KEYWORDS = new Set(['default', 'in', 'is', 'as', 'case', 'class', 'enum', 'func', 'let', 'var', 'self', 'Type']);
const pascal = (value: string) =>
	value
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean)
		.map(part => part[0]!.toUpperCase() + part.slice(1))
		.join('');
const camel = (value: string) => {
	const name = pascal(value);
	return name[0]!.toLowerCase() + name.slice(1);
};
const identifier = (name: string) => (KEYWORDS.has(name) ? `\`${name}\`` : name);

class Generator {
	private readonly decls = new Map<string, Decl>();
	private readonly named = new Map<Schema, string>();

	constructor(private readonly document: Document) {}

	private resolve(schema: Schema): Schema {
		if (!schema.$ref) return schema;
		const name = schema.$ref.replace('#/components/schemas/', '');
		const target = this.document.components?.schemas?.[name];
		if (!target) throw new Error(`Unknown $ref ${schema.$ref}`);
		return target;
	}

	/** The schema without its `null` branch, and whether it had one. */
	private nullable(schema: Schema): { schema: Schema; nullable: boolean } {
		const branches = schema.anyOf ?? schema.oneOf;
		if (!branches?.some(branch => branch.type === 'null')) return { schema, nullable: false };
		const rest = branches.filter(branch => branch.type !== 'null');
		if (rest.length === 1) return { schema: rest[0]!, nullable: true };
		return { schema: { ...schema, anyOf: rest, oneOf: undefined }, nullable: true };
	}

	/** `allOf` over one union becomes a union of each branch merged with the rest. */
	private flatten(schema: Schema): Schema {
		if (!schema.allOf) return schema;
		const parts = schema.allOf.map(part => this.flatten(this.resolve(part)));
		const union = parts.find(part => part.anyOf ?? part.oneOf);
		const objects = parts.filter(part => part !== union);
		const merge = (members: Schema[]): Schema => ({
			type: 'object',
			properties: Object.assign({}, ...members.map(member => this.resolve(member).properties ?? {})),
			required: members.flatMap(member => this.resolve(member).required ?? []),
		});
		if (!union) return merge(objects);
		return { anyOf: (union.anyOf ?? union.oneOf)!.map(branch => merge([branch, ...objects])) };
	}

	/** The Swift type for `schema`, declaring it as `hint` when it needs a declaration of its own. */
	type(input: Schema, hint: string): string {
		if (input.$ref) return this.component(input.$ref.replace('#/components/schemas/', ''));
		const existing = this.named.get(input);
		if (existing) return existing;
		const schema = this.flatten(input);
		const branches = schema.anyOf ?? schema.oneOf;
		if (branches) return this.union(input, branches, hint);
		if (schema.enum) return this.enumeration(input, schema.enum, hint);
		if (schema.const !== undefined) return this.constant(input, schema.const, hint);
		switch (schema.type) {
			case 'string':
				return 'String';
			case 'integer':
				return 'Int';
			case 'number':
				return 'Double';
			case 'boolean':
				return 'Bool';
			case 'array':
				return `[${this.type(schema.items ?? {}, `${hint}Item`)}]`;
			case 'object':
				if (schema.properties) return this.struct(input, schema, hint);
				if (typeof schema.additionalProperties === 'object') {
					return `[String: ${this.type(schema.additionalProperties, `${hint}Value`)}]`;
				}
				return 'JSONValue';
			case undefined:
				if (Object.keys(schema).every(key => key === 'description')) return 'JSONValue';
		}
		throw new Error(`Unsupported schema for ${hint}: ${JSON.stringify(schema).slice(0, 200)}`);
	}

	/**
	 * Components a component refers to are declared first, so a nested schema they share, such as a patch's
	 * `fields`, is named after the component that defines it rather than the first one that merges it in.
	 */
	component(name: string, visiting = new Set<string>()): string {
		const target = this.document.components?.schemas?.[name];
		if (!target) throw new Error(`Unknown component ${name}`);
		visiting.add(name);
		for (const dependency of references(target)) {
			if (!visiting.has(dependency)) this.component(dependency, visiting);
		}
		return this.type(target, pascal(name));
	}

	private declare(schema: Schema, decl: Decl): string {
		if (this.decls.has(decl.name)) throw new Error(`Two schemas want the Swift name ${decl.name}`);
		this.named.set(schema, decl.name);
		this.decls.set(decl.name, decl);
		return decl.name;
	}

	private struct(input: Schema, schema: Schema, name: string, omit?: string): string {
		const decl: Decl = { kind: 'struct', name, props: [] };
		this.declare(input, decl);
		const required = new Set(schema.required ?? []);
		for (const [json, property] of Object.entries(schema.properties ?? {})) {
			if (json === omit) continue;
			const { schema: inner, nullable } = this.nullable(property);
			decl.props.push({
				json,
				swift: identifier(camel(json)),
				type: this.type(inner, `${name}${pascal(json)}`),
				required: required.has(json),
				nullable,
			});
		}
		return name;
	}

	private union(input: Schema, branches: Schema[], name: string): string {
		const { nullable } = this.nullable(input);
		if (nullable) throw new Error(`${name}: a nullable union belongs on a property`);
		const resolved = branches.map(branch => this.flatten(this.resolve(branch)));
		const constants = resolved.filter(branch => branch.const !== undefined);
		if (constants.length === resolved.length) {
			const values = constants.map(branch => branch.const);
			return this.enumeration(input, values, name);
		}
		const tag = this.tag(resolved);
		if (tag) {
			const decl: Decl = { kind: 'tagged', name, tag, variants: [] };
			this.declare(input, decl);
			resolved.forEach((branch, index) => {
				const value = String(branch.properties![tag]!.const);
				const type = this.struct(branches[index]!, branch, `${name}${pascal(value)}`, tag);
				decl.variants.push({ value, type });
			});
			return name;
		}
		const decl: Decl = { kind: 'untagged', name, variants: [] };
		this.declare(input, decl);
		const caseNames = this.caseNames(resolved);
		resolved.forEach((branch, index) => {
			const caseName = caseNames[index]!;
			decl.variants.push({ name: caseName, type: this.type(branches[index]!, `${name}${pascal(caseName)}`) });
		});
		return name;
	}

	/** A property every branch requires as a distinct string constant. */
	private tag(branches: Schema[]): string | null {
		const first = branches[0];
		if (!first?.properties) return null;
		for (const key of Object.keys(first.properties)) {
			const values = branches.map(branch =>
				branch.required?.includes(key) ? branch.properties?.[key]?.const : undefined,
			);
			if (values.every(value => typeof value === 'string') && new Set(values).size === values.length) return key;
		}
		return null;
	}

	/** Each branch's case: its first string value of a property they all share, or its first property no other has. */
	private caseNames(branches: Schema[]): string[] {
		const shared = Object.keys(branches[0]?.properties ?? {}).find(key =>
			branches.every(branch => {
				const property = branch.properties?.[key];
				return typeof property?.const === 'string' || typeof property?.enum?.[0] === 'string';
			}),
		);
		if (shared)
			return branches.map(branch =>
				camel(String(branch.properties![shared]!.const ?? branch.properties![shared]!.enum![0])),
			);
		return branches.map((branch, index) => {
			const own = (branch.required ?? []).find(key =>
				branches.every((other, at) => at === index || !other.properties?.[key]),
			);
			if (!own) throw new Error(`Cannot name branch ${index} of a union`);
			return camel(own);
		});
	}

	private enumeration(input: Schema, values: unknown[], name: string): string {
		if (values.every(value => typeof value === 'string')) {
			return this.declare(input, { kind: 'strings', name, values: values as string[] });
		}
		if (values.every(value => Number.isInteger(value))) return 'Int';
		if (values.every(value => typeof value === 'number')) return 'Double';
		throw new Error(`${name}: mixed enum ${JSON.stringify(values)}`);
	}

	private constant(input: Schema, value: unknown, name: string): string {
		if (typeof value === 'string') return this.declare(input, { kind: 'strings', name, values: [value] });
		if (typeof value === 'boolean') return 'Bool';
		if (Number.isInteger(value)) return 'Int';
		throw new Error(`${name}: unsupported constant ${JSON.stringify(value)}`);
	}

	/** Names a declared type through `API`, since an endpoint can share its name. */
	qualify(type: string): string {
		return type.replace(/\b[A-Z]\w*\b/g, name => (this.decls.has(name) ? `API.${name}` : name));
	}

	render(endpoints: string[]): string {
		const decls = [...this.decls.values()].sort((a, b) => a.name.localeCompare(b.name)).map(render);
		return [
			HEADER,
			'extension API {',
			decls.join('\n\n'),
			'}',
			'',
			'/// One descriptor per operation, named after its `operationId`.',
			'extension API.Endpoints {',
			endpoints.join('\n\n'),
			'}',
			'',
		].join('\n');
	}
}

const PROTOCOLS = 'Codable, Equatable, Sendable';

function propertyType(prop: Prop): string {
	if (prop.nullable && !prop.required) return `Nullable<${prop.type}>?`;
	return prop.nullable || !prop.required ? `${prop.type}?` : prop.type;
}

function render(decl: Decl): string {
	switch (decl.kind) {
		case 'strings':
			return [
				`    public enum ${decl.name}: String, ${PROTOCOLS}, CaseIterable {`,
				...decl.values.map(value => `        case ${identifier(camel(value))} = ${JSON.stringify(value)}`),
				'    }',
			].join('\n');
		case 'struct': {
			const { name, props } = decl;
			const keys = props.length
				? [
						'        enum CodingKeys: String, CodingKey {',
						...props.map(prop => `            case ${prop.swift} = ${JSON.stringify(prop.json)}`),
						'        }',
					]
				: [];
			const decode = props.map(prop => {
				if (prop.nullable && !prop.required) {
					return `            ${prop.swift} = try container.decodeNullable(${prop.type}.self, forKey: .${unescape(prop.swift)})`;
				}
				const method = prop.required && !prop.nullable ? 'decode' : 'decodeIfPresent';
				return `            ${prop.swift} = try container.${method}(${prop.type}.self, forKey: .${unescape(prop.swift)})`;
			});
			const encode = props.map(prop => {
				const key = `.${unescape(prop.swift)}`;
				if (prop.nullable && !prop.required)
					return `            try container.encodeNullable(${prop.swift}, forKey: ${key})`;
				if (prop.nullable) return `            try container.encode(${prop.swift}, forKey: ${key})`;
				return `            try container.${prop.required ? 'encode' : 'encodeIfPresent'}(${prop.swift}, forKey: ${key})`;
			});
			const container = (kind: 'decoder' | 'encoder') =>
				props.length
					? kind === 'decoder'
						? '        let container = try decoder.container(keyedBy: CodingKeys.self)'
						: '        var container = encoder.container(keyedBy: CodingKeys.self)'
					: kind === 'decoder'
						? '        _ = try decoder.container(keyedBy: AnyKey.self)'
						: '        _ = encoder.container(keyedBy: AnyKey.self)';
			return [
				`    public struct ${name}: ${PROTOCOLS} {`,
				...props.map(prop => `        public var ${prop.swift}: ${propertyType(prop)}`),
				'',
				`        public init(${props.map(prop => `${prop.swift}: ${propertyType(prop)}${prop.required && !prop.nullable ? '' : ' = nil'}`).join(', ')}) {`,
				...props.map(prop => `            self.${unescape(prop.swift)} = ${prop.swift}`),
				'        }',
				...(keys.length ? ['', ...keys] : []),
				'',
				'        public init(from decoder: Decoder) throws {',
				container('decoder'),
				...decode,
				'        }',
				'',
				'        public func encode(to encoder: Encoder) throws {',
				container('encoder'),
				...encode,
				'        }',
				'    }',
			].join('\n');
		}
		case 'tagged':
			return [
				`    public enum ${decl.name}: ${PROTOCOLS} {`,
				...decl.variants.map(variant => `        case ${identifier(camel(variant.value))}(${variant.type})`),
				'',
				'        private enum TagKey: String, CodingKey {',
				`            case tag = ${JSON.stringify(decl.tag)}`,
				'        }',
				'',
				'        public init(from decoder: Decoder) throws {',
				'            let tag = try decoder.container(keyedBy: TagKey.self).decode(String.self, forKey: .tag)',
				'            switch tag {',
				...decl.variants.map(
					variant =>
						`            case ${JSON.stringify(variant.value)}: self = .${identifier(camel(variant.value))}(try ${variant.type}(from: decoder))`,
				),
				'            default:',
				`                throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown ${decl.tag} \\(tag)"))`,
				'            }',
				'        }',
				'',
				'        public func encode(to encoder: Encoder) throws {',
				'            var container = encoder.container(keyedBy: TagKey.self)',
				'            switch self {',
				...decl.variants.map(
					variant =>
						`            case let .${identifier(camel(variant.value))}(value):\n                try container.encode(${JSON.stringify(variant.value)}, forKey: .tag)\n                try value.encode(to: encoder)`,
				),
				'            }',
				'        }',
				'    }',
			].join('\n');
		case 'untagged':
			return [
				`    public enum ${decl.name}: ${PROTOCOLS} {`,
				...decl.variants.map(variant => `        case ${identifier(variant.name)}(${variant.type})`),
				'',
				'        public init(from decoder: Decoder) throws {',
				...decl.variants.map(
					variant =>
						`            if let value = try? ${variant.type}(from: decoder) {\n                self = .${identifier(variant.name)}(value)\n                return\n            }`,
				),
				`            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "No ${decl.name} case matched"))`,
				'        }',
				'',
				'        public func encode(to encoder: Encoder) throws {',
				'            switch self {',
				...decl.variants.map(
					variant => `            case let .${identifier(variant.name)}(value): try value.encode(to: encoder)`,
				),
				'            }',
				'        }',
				'    }',
			].join('\n');
	}
}

function references(schema: unknown): string[] {
	if (!schema || typeof schema !== 'object') return [];
	if (Array.isArray(schema)) return schema.flatMap(references);
	const ref = (schema as Schema).$ref;
	if (ref) return [ref.replace('#/components/schemas/', '')];
	return Object.values(schema).flatMap(references);
}

const unescape = (name: string) => name.replaceAll('`', '');

const HEADER = `// Generated by scripts/generate from shared/api/contract.ts. Do not edit.

import Foundation

/// The HTTP contract with the server.
public enum API {
    public enum Endpoints {}
}

/// A JSON property that can be missing, \`null\`, or a value. An optional of this type is missing when \`nil\`.
public enum Nullable<Wrapped: Codable & Equatable & Sendable>: Codable, Equatable, Sendable {
    case null
    case value(Wrapped)

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self = container.decodeNil() ? .null : .value(try container.decode(Wrapped.self))
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case let .value(value): try container.encode(value)
        }
    }
}

/// One operation of the contract.
public protocol APIEndpoint {
    associatedtype Input: Encodable & Sendable
    associatedtype Output: Decodable & Sendable
    static var method: String { get }
    static var path: String { get }
}

/// The body of an operation that takes none.
public struct NoInput: Codable, Equatable, Sendable {
    public init() {}
}

/// The body of every error response.
public struct APIError: Codable, Equatable, Sendable, Error {
    public var code: String
    public var status: Int
    public var message: String
}

private struct AnyKey: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
}

extension KeyedDecodingContainer {
    func decodeNullable<T>(_: T.Type, forKey key: Key) throws -> Nullable<T>? {
        guard contains(key) else { return nil }
        return try decodeNil(forKey: key) ? .null : .value(decode(T.self, forKey: key))
    }
}

extension KeyedEncodingContainer {
    mutating func encodeNullable<T>(_ value: Nullable<T>?, forKey key: Key) throws {
        guard let value else { return }
        try encode(value, forKey: key)
    }
}
`;

export function swiftModule(document: Document): string {
	const generator = new Generator(document);
	for (const name of Object.keys(document.components?.schemas ?? {}).sort()) generator.component(name);
	const endpoints: string[] = [];
	for (const [path, methods] of Object.entries(document.paths).sort(([a], [b]) => a.localeCompare(b))) {
		for (const [method, operation] of Object.entries(methods)) {
			const name = pascal(operation.operationId);
			const body = operation.requestBody?.content['application/json'].schema;
			const success = Object.entries(operation.responses).find(([status]) => status.startsWith('2'))?.[1];
			const output = success?.content?.['application/json'].schema;
			const input = body ? generator.type(body, `${name}Input`) : 'NoInput';
			const result = output ? generator.type(output, `${name}Output`) : 'NoInput';
			endpoints.push(
				[
					`    public enum ${name}: APIEndpoint {`,
					`        public typealias Input = ${generator.qualify(input)}`,
					`        public typealias Output = ${generator.qualify(result)}`,
					`        public static let method = ${JSON.stringify(method.toUpperCase())}`,
					`        public static let path = ${JSON.stringify(path)}`,
					'    }',
				].join('\n'),
			);
		}
	}
	return generator.render(endpoints);
}
