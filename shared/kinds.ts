/**
 * Every synced kind and its table, which is also its list in a snapshot. Projects and labels come before the tasks
 * that point at them, and tasks before their comments.
 */
export const TABLE_OF = {
	project: 'projects',
	section: 'sections',
	label: 'labels',
	task: 'tasks',
	comment: 'comments',
	read: 'reads',
	settings: 'settings',
} as const;
export type Kind = keyof typeof TABLE_OF;
export type SyncedTable = (typeof TABLE_OF)[Kind];
export const KINDS = Object.keys(TABLE_OF) as [Kind, ...Kind[]];
export const KIND_OF = Object.fromEntries(Object.entries(TABLE_OF).map(([kind, table]) => [table, kind])) as Record<
	SyncedTable,
	Kind
>;

/** The kinds a snapshot keeps as lists; settings are its one row that is not a list. */
export type ListKind = Exclude<Kind, 'settings'>;
export type ListName = (typeof TABLE_OF)[ListKind];
export const LIST_NAMES = KINDS.filter(kind => kind !== 'settings').map(kind => TABLE_OF[kind]) as ListName[];

/** The kinds a share can reach, so the kinds an `access` row names. */
export const ACCESS_KINDS = ['task', 'project', 'section', 'label'] as const satisfies readonly Kind[];
