import { z } from 'zod';

/**
 * The icons a project can take, by concept, in the order pickers show them. Each client maps a name to its own glyph
 * (Phosphor on the web in `app-web/src/lib/project-icon.ts`, SF Symbols on iOS in `ProjectIcons.swift`), so both draw
 * the same idea. A project with no icon shows the `#` it always had. See `docs/decisions/domain.md`.
 */
export const PROJECT_ICONS = [
	'home',
	'work',
	'errands',
	'shopping',
	'groceries',
	'money',
	'bills',
	'health',
	'fitness',
	'food',
	'travel',
	'car',
	'learning',
	'reading',
	'ideas',
	'writing',
	'code',
	'calendar',
	'family',
	'pets',
	'garden',
	'cleaning',
	'repairs',
	'documents',
	'email',
	'calls',
	'music',
	'movies',
	'games',
	'gifts',
	'art',
	'photos',
	'outdoors',
	'goals',
	'favorites',
	'love',
	'someday',
] as const;
export const projectIconSchema = z.enum(PROJECT_ICONS).meta({ id: 'ProjectIcon' });
export type ProjectIcon = z.infer<typeof projectIconSchema>;
