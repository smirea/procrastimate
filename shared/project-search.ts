import type { Project, Task } from './task.ts';

/** The `#query` the caret sits in. `start` is the `#`, `end` is the end of the word under the caret. */
export type HashFragment = { start: number; end: number; query: string };

export type ProjectSuggestion = { kind: 'project'; project: Project } | { kind: 'create'; name: string };

/**
 * A `#` starts a fragment at the start of the text or after whitespace. The query may contain spaces
 * only while it still prefixes a project name, so multi-word names stay searchable.
 */
export function hashFragment(value: string, caret: number, projects: readonly Project[]): HashFragment | null {
	const before = value.slice(0, caret);
	const start = before.lastIndexOf('#');
	if (start === -1 || (start > 0 && !/\s/.test(before[start - 1]!))) return null;
	const query = before.slice(start + 1);
	if (/\s/.test(query)) {
		const lower = query.toLowerCase();
		if (!projects.some(p => p.name.toLowerCase().startsWith(lower))) return null;
	}
	return { start, end: caret + /^\S*/.exec(value.slice(caret))![0].length, query };
}

/** When each project last received a task, the store's only record of use. */
export function projectLastUsed(tasks: readonly Task[]): Map<string, number> {
	const used = new Map<string, number>();
	for (const task of tasks) {
		if (task.projectId && task.createdAt > (used.get(task.projectId) ?? 0)) used.set(task.projectId, task.createdAt);
	}
	return used;
}

/** 0 exact, 1 prefix, 2 word prefix, 3 substring, null no match. */
function matchTier(name: string, query: string): number | null {
	const n = name.toLowerCase();
	if (n === query) return 0;
	if (n.startsWith(query)) return 1;
	if (n.split(/\s+/).some(word => word.startsWith(query))) return 2;
	return n.includes(query) ? 3 : null;
}

/** Best match first, then most recently used, then alphabetical. Offers to create the query when no name equals it. */
export function suggestProjects(
	projects: readonly Project[],
	tasks: readonly Task[],
	query: string,
): ProjectSuggestion[] {
	const q = query.trim().toLowerCase();
	const used = projectLastUsed(tasks);
	const ranked = projects
		.map(project => ({ project, tier: matchTier(project.name, q) }))
		.filter((r): r is { project: Project; tier: number } => r.tier !== null)
		.toSorted(
			(a, b) =>
				a.tier - b.tier ||
				(used.get(b.project.id) ?? 0) - (used.get(a.project.id) ?? 0) ||
				a.project.name.localeCompare(b.project.name, undefined, { sensitivity: 'base' }),
		);
	const suggestions: ProjectSuggestion[] = ranked.map(r => ({ kind: 'project', project: r.project }));
	if (q && ranked[0]?.tier !== 0) suggestions.push({ kind: 'create', name: query.trim() });
	return suggestions;
}
