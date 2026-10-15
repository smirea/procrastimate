export const KINDS = ['project', 'section', 'label', 'task', 'settings'] as const;
export type Kind = (typeof KINDS)[number];
