/**
 * Swift types for every named shared schema, plus one descriptor per operation, from JSON Schema. It covers what the
 * shared Zod produces: objects, arrays, `$ref`, nullable branches, unions told apart by a constant tag or tried in
 * order, `allOf` over a union, string and integer enums, and constants. Anything else fails the run, so a new kind
 * of schema cannot slip through as an untyped value.
 *
 * The generated types replace hand-written models, so they follow the rules the Zod schemas check: a decoder made
 * with `JSONDecoder.validating()` enforces bounds, patterns, sizes, enum members, and named validators, and fails
 * like `safeParse` does. Others only decode the shape, as shared functions accept values the wire would not.
 *
 * JSON tells a missing field from a `null` one, and a sync patch depends on it, so a property that is both optional
 * and nullable becomes `T??`, as Core writes it: `nil` is missing, `.some(nil)` is `null`.
 *
 * Schema keys that shape the Swift:
 * - `x-enum-names`: the case names of an integer enum, which otherwise becomes an `Int` typealias.
 * - `x-flatten: { <tag>: <enum> }`: one struct for a union whose branches differ by `<tag>`, typed as `<enum>`.
 * - `x-inline`: a tagged union whose cases carry their fields as associated values.
 * - `x-table`: the Drizzle table whose column defaults become the initializer's defaults.
 * - `x-validate`: a Core function `(T) -> Bool` the decoded value must pass, for a Zod `refine`.
 * - `x-swift-type`: a Core type to use as is, where Core keeps its own representation on purpose.
 * - `x-decode: custom`: no `init(from:)`, because Core decodes the type with rules of its own.
 * - `x-epoch-ms`: epoch milliseconds in JSON, a `Date` in Swift.
 */

export type Schema = {
	$ref?: string;
	type?: string | string[];
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
	default?: unknown;
	minimum?: number;
	maximum?: number;
	exclusiveMinimum?: number;
	exclusiveMaximum?: number;
	minItems?: number;
	pattern?: string;
	'x-enum-names'?: string[];
	'x-flatten'?: Record<string, string>;
	'x-inline'?: boolean;
	'x-table'?: string;
	'x-validate'?: string;
	'x-swift-type'?: string;
	'x-decode'?: 'custom';
	'x-epoch-ms'?: boolean;
};

type Operation = {
	operationId: string;
	requestBody?: { content: { 'application/json': { schema: Schema } } };
	responses: Record<string, { content?: { 'application/json': { schema: Schema } } }>;
};

export type Input = {
	components: Record<string, Schema>;
	paths: Record<string, Record<string, Operation>>;
	tableDefaults: Record<string, Record<string, unknown>>;
};

type Check =
	| { kind: 'min' | 'max'; value: number; exclusive: boolean }
	| { kind: 'minItems'; value: number }
	| { kind: 'pattern'; value: string }
	| { kind: 'member'; values: number[] }
	| { kind: 'validate'; fn: string };

type Prop = {
	json: string;
	swift: string;
	type: string;
	required: boolean;
	nullable: boolean;
	defaultValue?: unknown;
	checks: Check[];
	itemChecks: Check[];
	doc?: string;
	epochMs?: boolean;
	/** In a flattened union, the tag values whose branches have this property. Others ignore it, as Zod does. */
	onlyWhen?: { tag: string; values: string[] };
};

type Decl =
	| { kind: 'alias'; name: string; target: string; doc?: string }
	| { kind: 'ints'; name: string; cases: { name: string; value: number }[]; defaultCase?: string; doc?: string }
	| { kind: 'strings'; name: string; values: string[]; names?: string[]; doc?: string }
	| { kind: 'struct'; name: string; props: Prop[]; customDecode: boolean; doc?: string }
	| { kind: 'tagged'; name: string; tag: string; variants: { value: string; type: string }[]; doc?: string }
	| { kind: 'inline'; name: string; tag: string; variants: { value: string; props: Prop[] }[]; doc?: string }
	| { kind: 'untagged'; name: string; variants: { name: string; type: string }[]; doc?: string };

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
const bare = (name: string) => name.replaceAll('`', '');
/** Zod's integer bounds, which every Swift `Int` already meets. */
const SAFE = 9_007_199_254_740_991;
const PRIMITIVES: Record<string, string> = { string: 'String', integer: 'Int', number: 'Double', boolean: 'Bool' };

class Generator {
	readonly decls = new Map<string, Decl>();
	private readonly named = new Map<Schema, string>();
	private readonly aliasChecks = new Map<string, Check[]>();
	private readonly visiting = new Set<string>();

	constructor(private readonly input: Input) {}

	private refName(ref: string): string {
		const name = ref.replace('#/components/schemas/', '');
		if (this.input.components[name]) return name;
		// oRPC names an output schema `<Name>Output` when only `additionalProperties` differs from the input's.
		const base = name.replace(/Output$/, '');
		if (this.input.components[base]) return base;
		throw new Error(`Unknown $ref ${ref}`);
	}

	private resolve(schema: Schema): Schema {
		return schema.$ref ? this.input.components[this.refName(schema.$ref)]! : schema;
	}

	/** The schema without its `null` branch, and whether it had one. */
	private nullable(schema: Schema): { schema: Schema; nullable: boolean } {
		if (Array.isArray(schema.type)) {
			const rest = schema.type.filter(type => type !== 'null');
			if (rest.length !== 1) throw new Error(`Unsupported type list ${JSON.stringify(schema.type)}`);
			return { schema: { ...schema, type: rest[0] }, nullable: rest.length < schema.type.length };
		}
		const branches = schema.anyOf ?? schema.oneOf;
		if (!branches?.some(branch => branch.type === 'null')) return { schema, nullable: false };
		const rest = branches.filter(branch => branch.type !== 'null');
		if (rest.length === 1) return { schema: rest[0]!, nullable: true };
		return { schema: { ...schema, anyOf: rest, oneOf: undefined }, nullable: true };
	}

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
		const branches = (union.anyOf ?? union.oneOf)!.map(branch => merge([branch, ...objects]));
		return { ...schema, allOf: undefined, anyOf: branches };
	}

	component(name: string): string {
		if (this.decls.has(name) || this.visiting.has(name)) return name;
		const schema = this.input.components[name];
		if (!schema) throw new Error(`Unknown component ${name}`);
		this.visiting.add(name);
		try {
			const doc = schema.description;
			const type = typeof schema.type === 'string' ? schema.type : undefined;
			if (schema.enum?.every(value => typeof value === 'number') && schema['x-enum-names']) {
				const names = schema['x-enum-names'];
				const cases = (schema.enum as number[]).map((value, index) => ({ name: names[index]!, value }));
				const defaultCase = cases.find(entry => entry.value === schema.default)?.name;
				return this.declare(schema, { kind: 'ints', name, cases, defaultCase, doc });
			}
			const strings = schema.enum?.every(value => typeof value === 'string');
			if (type && PRIMITIVES[type] && !strings && schema.const === undefined) {
				this.aliasChecks.set(name, this.ownChecks(schema));
				const integers = schema.enum?.every(value => Number.isInteger(value));
				return this.declare(schema, { kind: 'alias', name, target: integers ? 'Int' : PRIMITIVES[type]!, doc });
			}
			// A component another one merges in names its nested types first, so a patch's `fields` is
			// `TaskPatchFields`, not named after the first union that merges the patch.
			for (const dependency of references(schema)) if (dependency !== name) this.component(dependency);
			return this.type(schema, name);
		} finally {
			this.visiting.delete(name);
		}
	}

	type(input: Schema, hint: string): string {
		if (input['x-swift-type']) return input['x-swift-type'];
		if (input.$ref) return this.component(this.refName(input.$ref));
		const existing = this.named.get(input);
		if (existing) return existing;
		const schema = this.flatten(input);
		const branches = schema.anyOf ?? schema.oneOf;
		if (branches) return this.union(input, schema, branches, hint);
		if (schema.enum) return this.enumeration(input, schema.enum, hint);
		if (schema.const !== undefined) return this.constant(input, schema.const, hint);
		const type = typeof schema.type === 'string' ? schema.type : undefined;
		if (type && PRIMITIVES[type]) return PRIMITIVES[type]!;
		if (type === 'array') return `[${this.type(this.nullable(schema.items ?? {}).schema, `${hint}Item`)}]`;
		if (type === 'object' && schema.properties) return this.struct(input, schema, hint);
		if (type === 'object' && typeof schema.additionalProperties === 'object') {
			return `[String: ${this.type(schema.additionalProperties, `${hint}Value`)}]`;
		}
		if (type === 'object' || Object.keys(schema).every(key => key === 'description')) return 'JSONValue';
		throw new Error(`Unsupported schema for ${hint}: ${JSON.stringify(schema).slice(0, 200)}`);
	}

	private declare(schema: Schema, decl: Decl): string {
		if (this.decls.has(decl.name)) throw new Error(`Two schemas want the Swift name ${decl.name}`);
		this.named.set(schema, decl.name);
		this.decls.set(decl.name, decl);
		return decl.name;
	}

	/** The checks `schema` itself states, without following a reference. */
	private ownChecks(schema: Schema): Check[] {
		const checks: Check[] = [];
		if (schema.minimum !== undefined && schema.minimum > -SAFE) {
			checks.push({ kind: 'min', value: schema.minimum, exclusive: false });
		}
		if (schema.exclusiveMinimum !== undefined) {
			checks.push({ kind: 'min', value: schema.exclusiveMinimum, exclusive: true });
		}
		if (schema.maximum !== undefined && schema.maximum < SAFE) {
			checks.push({ kind: 'max', value: schema.maximum, exclusive: false });
		}
		if (schema.exclusiveMaximum !== undefined) {
			checks.push({ kind: 'max', value: schema.exclusiveMaximum, exclusive: true });
		}
		if (schema.minItems !== undefined && schema.minItems > 0) checks.push({ kind: 'minItems', value: schema.minItems });
		if (schema.pattern) checks.push({ kind: 'pattern', value: schema.pattern });
		if (schema.enum?.every(value => typeof value === 'number') && !schema['x-enum-names']) {
			checks.push({ kind: 'member', values: schema.enum as number[] });
		}
		if (schema['x-validate']) checks.push({ kind: 'validate', fn: schema['x-validate'] });
		return checks;
	}

	private valueChecks(schema: Schema): Check[] {
		if (!schema.$ref) return this.ownChecks(schema);
		const name = this.refName(schema.$ref);
		this.component(name);
		return [...(this.aliasChecks.get(name) ?? []), ...this.ownChecks(schema)];
	}

	private props(schema: Schema, owner: string, omit?: string, table?: string): Prop[] {
		const required = new Set(schema.required ?? []);
		const defaults = table ? this.input.tableDefaults[table] : undefined;
		if (table && !defaults) throw new Error(`${owner}: x-table names a table that does not exist: ${table}`);
		return Object.entries(schema.properties ?? {})
			.filter(([json]) => json !== omit)
			.map(([json, property]) => {
				const { schema: inner, nullable } = this.nullable(property);
				const resolved = this.resolve(inner);
				if (inner['x-epoch-ms']) {
					if (nullable || !required.has(json)) throw new Error(`${owner}.${json}: x-epoch-ms needs a required value`);
					return {
						json,
						swift: identifier(camel(json)),
						type: 'Date',
						required: true,
						nullable: false,
						checks: [],
						itemChecks: [],
						doc: property.description,
						epochMs: true,
					};
				}
				const items = resolved.type === 'array' && resolved.items ? this.nullable(resolved.items).schema : null;
				return {
					json,
					swift: identifier(camel(json)),
					type: this.type(inner, `${owner}${pascal(json)}`),
					required: required.has(json),
					nullable,
					defaultValue:
						'default' in property ? property.default : 'default' in inner ? inner.default : defaults?.[json],
					checks: this.valueChecks(inner),
					// A Core type picked by x-swift-type is not the JSON array, so its items are not checked.
					itemChecks: items && !property['x-swift-type'] && !inner['x-swift-type'] ? this.valueChecks(items) : [],
					doc: property.description,
				};
			});
	}

	private struct(input: Schema, schema: Schema, name: string, omit?: string): string {
		const decl: Decl = {
			kind: 'struct',
			name,
			props: [],
			customDecode: input['x-decode'] === 'custom',
			doc: input.description,
		};
		this.declare(input, decl);
		decl.props = this.props(schema, name, omit, input['x-table']);
		return name;
	}

	private union(input: Schema, schema: Schema, branches: Schema[], name: string): string {
		if (this.nullable(schema).nullable) throw new Error(`${name}: a nullable union belongs on a property`);
		const resolved = branches.map(branch => this.flatten(this.resolve(branch)));
		if (resolved.every(branch => branch.const !== undefined)) {
			return this.enumeration(
				input,
				resolved.map(branch => branch.const),
				name,
			);
		}
		const flatten = input['x-flatten'];
		if (flatten) return this.flattened(input, resolved, name, flatten);
		const tag = this.tag(resolved);
		const tagOf = (branch: Schema) => String(branch.properties![tag!]!.const);
		if (tag && input['x-inline']) {
			const decl: Decl = { kind: 'inline', name, tag, variants: [], doc: input.description };
			this.declare(input, decl);
			decl.variants = resolved.map(branch => ({
				value: tagOf(branch),
				props: this.props(branch, `${name}${pascal(tagOf(branch))}`, tag),
			}));
			return name;
		}
		if (tag) {
			const decl: Decl = { kind: 'tagged', name, tag, variants: [], doc: input.description };
			this.declare(input, decl);
			resolved.forEach((branch, index) => {
				const type = this.struct(branches[index]!, branch, `${name}${pascal(tagOf(branch))}`, tag);
				decl.variants.push({ value: tagOf(branch), type });
			});
			return name;
		}
		const decl: Decl = { kind: 'untagged', name, variants: [], doc: input.description };
		this.declare(input, decl);
		const caseNames = this.caseNames(resolved);
		resolved.forEach((branch, index) => {
			const caseName = caseNames[index]!;
			decl.variants.push({ name: caseName, type: this.type(branches[index]!, `${name}${pascal(caseName)}`) });
		});
		return name;
	}

	private flattened(input: Schema, branches: Schema[], name: string, tags: Record<string, string>): string {
		const properties: Record<string, Schema> = {};
		for (const branch of branches) Object.assign(properties, branch.properties);
		for (const [tag, enumName] of Object.entries(tags)) {
			properties[tag] = { $ref: `#/components/schemas/${enumName}` };
		}
		const required = Object.keys(properties).filter(key => branches.every(branch => branch.required?.includes(key)));
		this.struct(input, { type: 'object', properties, required }, name);
		const decl = this.decls.get(name) as Extract<Decl, { kind: 'struct' }>;
		const [tag] = Object.keys(tags);
		const valuesOf = (branch: Schema) => {
			const property = branch.properties?.[tag!];
			return property?.const !== undefined ? [String(property.const)] : (property?.enum ?? []).map(String);
		};
		for (const prop of decl.props) {
			const owners = branches.filter(branch => branch.properties?.[prop.json]);
			if (prop.json === tag || owners.length === branches.length) continue;
			if (decl.props.findIndex(entry => entry.json === tag) > decl.props.indexOf(prop)) {
				throw new Error(`${name}: ${tag} must come before ${prop.json}`);
			}
			prop.onlyWhen = { tag: identifier(camel(tag!)), values: owners.flatMap(valuesOf) };
		}
		return name;
	}

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

	private caseNames(branches: Schema[]): string[] {
		const shared = Object.keys(branches[0]?.properties ?? {}).find(key =>
			branches.every(branch => {
				const property = branch.properties?.[key];
				return typeof property?.const === 'string' || typeof property?.enum?.[0] === 'string';
			}),
		);
		if (shared) {
			return branches.map(branch =>
				camel(String(branch.properties![shared]!.const ?? branch.properties![shared]!.enum![0])),
			);
		}
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
			const names = input['x-enum-names'];
			return this.declare(input, { kind: 'strings', name, values: values as string[], names, doc: input.description });
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

	literal(value: unknown, type: string): string {
		if (value === null) return 'nil';
		const decl = this.decls.get(type);
		if (decl?.kind === 'ints') {
			const match = decl.cases.find(entry => entry.value === value);
			if (!match) throw new Error(`${type} has no case for default ${JSON.stringify(value)}`);
			return `.${identifier(match.name)}`;
		}
		if (decl?.kind === 'strings') return `.${caseName(decl, String(value))}`;
		if (Array.isArray(value)) {
			if (value.length) throw new Error(`Only empty array defaults are supported, not ${JSON.stringify(value)}`);
			return '[]';
		}
		if (typeof value === 'object') {
			if (Object.keys(value).length)
				throw new Error(`Only empty object defaults are supported, not ${JSON.stringify(value)}`);
			return '[:]';
		}
		if (typeof value === 'string') return JSON.stringify(value);
		if (typeof value === 'number' || typeof value === 'boolean') return String(value);
		throw new Error(`Unsupported default ${JSON.stringify(value)} for ${type}`);
	}

	/** Names a declared type through `API`, since an endpoint can share its name. */
	qualify(type: string): string {
		return type.replace(/\b[A-Z]\w*\b/g, name => (this.decls.has(name) ? `API.${name}` : name));
	}
}

const PROTOCOLS = 'Codable, Hashable, Sendable';

function caseName(decl: { values: string[]; names?: string[] }, value: string): string {
	const name = decl.names?.[decl.values.indexOf(value)] ?? camel(value);
	if (!name) throw new Error(`Add x-enum-names for the string enum value ${JSON.stringify(value)}`);
	return identifier(name);
}

function references(schema: unknown): string[] {
	if (!schema || typeof schema !== 'object') return [];
	if (Array.isArray(schema)) return schema.flatMap(references);
	const ref = (schema as Schema).$ref;
	if (ref) return [ref.replace('#/components/schemas/', '').replace(/Output$/, '')];
	return Object.values(schema).flatMap(references);
}

const docLines = (doc: string | undefined, indent: string) =>
	doc ? doc.split('\n').map(line => `${indent}/// ${line}`) : [];

const defaulted = (prop: Prop) => !prop.required && !prop.nullable && prop.defaultValue !== undefined;

/** Absent and `null` mean different things only when absent has no default of its own. */
const tristate = (prop: Prop) => prop.nullable && !prop.required && prop.defaultValue !== null;

/** The stored type: `T??` for optional and nullable, `T?` when it may be absent or null. */
function storedType(prop: Prop): string {
	if (tristate(prop)) return `${prop.type}??`;
	if (defaulted(prop)) return prop.type;
	return prop.nullable || !prop.required ? `${prop.type}?` : prop.type;
}

function initParam(prop: Prop, generator: Generator): string {
	const type = storedType(prop);
	if (prop.defaultValue !== undefined && prop.defaultValue !== null && !tristate(prop)) {
		return `${prop.swift}: ${type} = ${generator.literal(prop.defaultValue, prop.type)}`;
	}
	if (type.endsWith('?')) return `${prop.swift}: ${type} = nil`;
	return type.startsWith('[') && !type.includes(':') ? `${prop.swift}: ${type} = []` : `${prop.swift}: ${type}`;
}

/**
 * A JavaScript pattern for ICU, which Foundation uses: there `\d` also matches non-ASCII digits and `$` also
 * matches before a final newline, and neither does in JavaScript.
 */
const swiftPattern = (pattern: string) => pattern.replaceAll('\\d', '[0-9]').replace(/\$$/, '\\z');

function condition(check: Check, value: string): string {
	switch (check.kind) {
		case 'min':
			return `${value} ${check.exclusive ? '>' : '>='} ${check.value}`;
		case 'max':
			return `${value} ${check.exclusive ? '<' : '<='} ${check.value}`;
		case 'minItems':
			return `${value}.count >= ${check.value}`;
		case 'pattern':
			return `${value}.range(of: #"${swiftPattern(check.value)}"#, options: .regularExpression) != nil`;
		case 'member':
			return `${JSON.stringify(check.values)}.contains(${value})`;
		case 'validate':
			return `${check.fn}(${value})`;
	}
}

function rule(check: Check): string {
	switch (check.kind) {
		case 'min':
			return `${check.exclusive ? 'above' : 'at least'} ${check.value}`;
		case 'max':
			return `${check.exclusive ? 'below' : 'at most'} ${check.value}`;
		case 'minItems':
			return `at least ${check.value} items`;
		case 'pattern':
			return `matching ${check.value.replaceAll('\\', '\\\\')}`;
		case 'member':
			return `one of ${check.values.join(', ')}`;
		case 'validate':
			return `passing ${check.fn}`;
	}
}

function checkLines(prop: Prop, source: string, indent: string): string[] {
	const key = `.${bare(prop.swift)}`;
	const lines = [
		...prop.checks.map(
			check => `try check(${condition(check, 'value')}, ${key}, in: container, "${prop.json} ${rule(check)}")`,
		),
		...prop.itemChecks.map(
			check =>
				`try check(value.allSatisfy { ${condition(check, '$0')} }, ${key}, in: container, "each ${prop.json} ${rule(check)}")`,
		),
	];
	if (!lines.length) return [];
	const body = lines.map(line => `${indent}    ${line}`);
	if (tristate(prop)) return [`${indent}if case let value?? = ${source} {`, ...body, `${indent}}`];
	if (storedType(prop).endsWith('?')) return [`${indent}if let value = ${source} {`, ...body, `${indent}}`];
	return [`${indent}do {`, `${indent}    let value = ${source}`, ...body, `${indent}}`];
}

function validating(lines: string[], indent: string): string[] {
	if (!lines.length) return [];
	return [`${indent}if decoder.validates {`, ...lines.map(line => `    ${line}`), `${indent}}`];
}

function decodeExpression(prop: Prop, generator: Generator): string {
	if (prop.epochMs) return `Date(epochMilliseconds: try container.decode(Int.self, forKey: .${bare(prop.swift)}))`;
	if (prop.onlyWhen) {
		const { tag, values } = prop.onlyWhen;
		return `${JSON.stringify(values)}.contains(${tag}.rawValue) ? ${decodeExpression({ ...prop, onlyWhen: undefined }, generator)} : nil`;
	}
	const key = `.${bare(prop.swift)}`;
	if (tristate(prop)) return `try container.decodeNullable(${prop.type}.self, forKey: ${key})`;
	if (prop.nullable && !prop.required) return `try container.decodeIfPresent(${prop.type}.self, forKey: ${key})`;
	if (prop.nullable) return `try container.decode(${prop.type}?.self, forKey: ${key})`;
	// An optional value that is not nullable rejects an explicit `null`, as Zod's `.optional()` does.
	if (defaulted(prop)) {
		return `try container.decodeAbsent(${prop.type}.self, forKey: ${key}) ?? ${generator.literal(prop.defaultValue, prop.type)}`;
	}
	if (!prop.required) return `try container.decodeAbsent(${prop.type}.self, forKey: ${key})`;
	return `try container.decode(${prop.type}.self, forKey: ${key})`;
}

function encodeLine(prop: Prop, value: string): string {
	const key = `.${bare(prop.swift)}`;
	if (prop.epochMs) return `try container.encode(${value}.epochMilliseconds, forKey: ${key})`;
	if (tristate(prop)) return `try container.encodeNullable(${value}, forKey: ${key})`;
	if (storedType(prop).endsWith('?') && !prop.nullable)
		return `try container.encodeIfPresent(${value}, forKey: ${key})`;
	return `try container.encode(${value}, forKey: ${key})`;
}

function codingKeys(props: Prop[], extra: string[] = []): string[] {
	const keys = [...extra, ...props.map(prop => `            case ${prop.swift} = ${JSON.stringify(prop.json)}`)];
	return keys.length ? ['        enum CodingKeys: String, CodingKey {', ...keys, '        }'] : [];
}

function renderStruct(decl: Extract<Decl, { kind: 'struct' }>, generator: Generator): string[] {
	const { name, props } = decl;
	const identifiable = props.some(
		prop => prop.json === 'id' && prop.required && !prop.nullable && prop.type === 'String',
	);
	const decode = decl.customDecode
		? []
		: [
				'',
				'        public init(from decoder: Decoder) throws {',
				props.length
					? '            let container = try decoder.container(keyedBy: CodingKeys.self)'
					: '            _ = try decoder.container(keyedBy: AnyKey.self)',
				...props.map(prop => `            ${prop.swift} = ${decodeExpression(prop, generator)}`),
				...validating(
					props.flatMap(prop => checkLines(prop, `self.${bare(prop.swift)}`, '            ')),
					'            ',
				),
				'        }',
			];
	return [
		`    public struct ${name}: ${identifiable ? `${PROTOCOLS}, Identifiable` : PROTOCOLS} {`,
		...props.flatMap(prop => [
			...docLines(prop.doc, '        '),
			`        public var ${prop.swift}: ${storedType(prop)}`,
		]),
		'',
		`        public init(${props.map(prop => initParam(prop, generator)).join(', ')}) {`,
		...props.map(prop => `            self.${bare(prop.swift)} = ${prop.swift}`),
		'        }',
		...(props.length ? ['', ...codingKeys(props)] : []),
		...decode,
		'',
		'        public func encode(to encoder: Encoder) throws {',
		props.length
			? '            var container = encoder.container(keyedBy: CodingKeys.self)'
			: '            _ = encoder.container(keyedBy: AnyKey.self)',
		...props.map(prop => `            ${encodeLine(prop, `self.${bare(prop.swift)}`)}`),
		'        }',
		'    }',
	];
}

function renderInline(decl: Extract<Decl, { kind: 'inline' }>, generator: Generator): string[] {
	const all = new Map<string, Prop>();
	for (const variant of decl.variants) for (const prop of variant.props) all.set(prop.swift, prop);
	const caseOf = (value: string) => identifier(camel(value));
	const labels = (props: Prop[]) =>
		props.length ? `(${props.map(prop => `${bare(prop.swift)}: ${storedType(prop)}`).join(', ')})` : '';
	const values = (props: Prop[], each: (prop: Prop) => string) =>
		props.length ? `(${props.map(each).join(', ')})` : '';
	return [
		`    public enum ${decl.name}: ${PROTOCOLS} {`,
		...decl.variants.map(variant => `        case ${caseOf(variant.value)}${labels(variant.props)}`),
		'',
		...codingKeys([...all.values()], [`            case tag = ${JSON.stringify(decl.tag)}`]),
		'',
		'        public init(from decoder: Decoder) throws {',
		'            let container = try decoder.container(keyedBy: CodingKeys.self)',
		'            switch try container.decode(String.self, forKey: .tag) {',
		...decl.variants.flatMap(variant => [
			`            case ${JSON.stringify(variant.value)}:`,
			...variant.props.map(prop => `                let ${prop.swift} = ${decodeExpression(prop, generator)}`),
			...validating(
				variant.props.flatMap(prop => checkLines(prop, prop.swift, '                ')),
				'                ',
			),
			`                self = .${caseOf(variant.value)}${values(variant.props, prop => `${bare(prop.swift)}: ${prop.swift}`)}`,
		]),
		'            case let tag:',
		`                throw DecodingError.dataCorruptedError(forKey: .tag, in: container, debugDescription: "Unknown ${decl.tag} \\(tag)")`,
		'            }',
		'        }',
		'',
		'        public func encode(to encoder: Encoder) throws {',
		'            var container = encoder.container(keyedBy: CodingKeys.self)',
		'            switch self {',
		...decl.variants.flatMap(variant => [
			`            case ${variant.props.length ? 'let ' : ''}.${caseOf(variant.value)}${values(variant.props, prop => bare(prop.swift))}:`,
			`                try container.encode(${JSON.stringify(variant.value)}, forKey: .tag)`,
			...variant.props.map(prop => `                ${encodeLine(prop, bare(prop.swift))}`),
		]),
		'            }',
		'        }',
		'    }',
	];
}

function renderDecl(decl: Decl, generator: Generator): string {
	const doc = docLines(decl.doc, '    ');
	switch (decl.kind) {
		case 'alias':
			return [...doc, `    public typealias ${decl.name} = ${decl.target}`].join('\n');
		case 'ints':
			return [
				...doc,
				`    public enum ${decl.name}: Int, ${PROTOCOLS}, CaseIterable, Comparable {`,
				...decl.cases.map(entry => `        case ${identifier(entry.name)} = ${entry.value}`),
				'',
				...(decl.defaultCase
					? [`        public static let \`default\`: Self = .${identifier(decl.defaultCase)}`, '']
					: []),
				'        public static func < (a: Self, b: Self) -> Bool { a.rawValue < b.rawValue }',
				'    }',
			].join('\n');
		case 'strings':
			return [
				...doc,
				`    public enum ${decl.name}: String, ${PROTOCOLS}, CaseIterable, Identifiable {`,
				...decl.values.map(value => `        case ${caseName(decl, value)} = ${JSON.stringify(value)}`),
				'',
				'        public var id: String { rawValue }',
				'    }',
			].join('\n');
		case 'struct':
			return [...doc, ...renderStruct(decl, generator)].join('\n');
		case 'inline':
			return [...doc, ...renderInline(decl, generator)].join('\n');
		case 'tagged':
			return [
				...doc,
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
				...doc,
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

const HEADER = `// Generated by scripts/generate from the shared Zod and Drizzle schemas. Do not edit.

import Foundation

/// The shared model and the HTTP contract with the server.
public enum API {
    public enum Endpoints {}
}

/// One operation of the contract.
public protocol APIEndpoint {
    associatedtype Input: Encodable & Sendable
    associatedtype Output: Decodable & Sendable
    static var method: String { get }
    static var path: String { get }
}

/// The body of an operation that takes none.
public struct NoInput: Codable, Hashable, Sendable {
    public init() {}
}

/// The body of every error response.
public struct APIError: Codable, Hashable, Sendable, Error {
    public var code: String
    public var message: String
}

private struct AnyKey: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
}

extension CodingUserInfoKey {
    /// Set on a decoder that reads untrusted JSON, so the generated types check every rule the Zod schemas check.
    public static let validates = CodingUserInfoKey(rawValue: "procrastimate.validates")!
}

extension JSONDecoder {
    /// A decoder whose generated types fail like Zod's \`safeParse\` on a value the schema rejects.
    public static func validating() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.userInfo[.validates] = true
        return decoder
    }
}

extension Decoder {
    var validates: Bool { userInfo[.validates] as? Bool ?? false }
}

/// Fails a decode the way a Zod check fails a parse.
func check<K: CodingKey>(_ ok: Bool, _ key: K, in container: KeyedDecodingContainer<K>, _ rule: String) throws {
    guard ok else { throw DecodingError.dataCorruptedError(forKey: key, in: container, debugDescription: rule) }
}

extension KeyedDecodingContainer {
    /// \`nil\` when the key is missing. Unlike \`decodeIfPresent\`, an explicit \`null\` fails, as Zod's \`.optional()\` does.
    func decodeAbsent<T: Decodable>(_: T.Type, forKey key: Key) throws -> T? {
        guard contains(key) else { return nil }
        return try decode(T.self, forKey: key)
    }

    /// \`nil\` when the key is missing, \`.some(nil)\` when it is \`null\`.
    func decodeNullable<T: Decodable>(_: T.Type, forKey key: Key) throws -> T?? {
        guard contains(key) else { return nil }
        return try decodeNil(forKey: key) ? .some(nil) : .some(decode(T.self, forKey: key))
    }
}

extension KeyedEncodingContainer {
    /// Writes nothing for a missing value and \`null\` for \`.some(nil)\`.
    mutating func encodeNullable<T: Encodable>(_ value: T??, forKey key: Key) throws {
        guard let value else { return }
        try encode(value, forKey: key)
    }
}
`;

export function swiftModule(input: Input): string {
	const generator = new Generator(input);
	for (const name of Object.keys(input.components).sort()) generator.component(name);
	const endpoints: string[] = [];
	for (const [path, methods] of Object.entries(input.paths).sort(([a], [b]) => a.localeCompare(b))) {
		for (const [method, operation] of Object.entries(methods)) {
			const name = pascal(operation.operationId);
			const body = operation.requestBody?.content['application/json'].schema;
			const success = Object.entries(operation.responses).find(([status]) => status.startsWith('2'))?.[1];
			const output = success?.content?.['application/json'].schema;
			const inputType = body ? generator.type(body, `${name}Input`) : 'NoInput';
			const outputType = output ? generator.type(output, `${name}Output`) : 'NoInput';
			endpoints.push(
				[
					`    public enum ${name}: APIEndpoint {`,
					`        public typealias Input = ${generator.qualify(inputType)}`,
					`        public typealias Output = ${generator.qualify(outputType)}`,
					`        public static let method = ${JSON.stringify(method.toUpperCase())}`,
					`        public static let path = ${JSON.stringify(path)}`,
					'    }',
				].join('\n'),
			);
		}
	}
	const decls = [...generator.decls.values()].sort((a, b) => a.name.localeCompare(b.name));
	return [
		HEADER,
		'extension API {',
		decls.map(decl => renderDecl(decl, generator)).join('\n\n'),
		'}',
		'',
		'/// One descriptor per operation, named after its `operationId`.',
		'extension API.Endpoints {',
		endpoints.join('\n\n'),
		'}',
		'',
	].join('\n');
}
