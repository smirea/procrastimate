/** A Durable Object binds at most 100 parameters per statement, so an `IN` list of more ids runs in parts. */
export const IN_LIMIT = 90;

export function chunks<T>(items: readonly T[], size = IN_LIMIT): T[][] {
	const parts: T[][] = [];
	for (let i = 0; i < items.length; i += size) parts.push(items.slice(i, i + size));
	return parts;
}
