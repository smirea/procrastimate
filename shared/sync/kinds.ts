/** Projects and labels come before the tasks that point at them, and tasks before their comments. */
export const KINDS = ['project', 'section', 'label', 'task', 'comment', 'read', 'settings'] as const;
export type Kind = (typeof KINDS)[number];
