export const KINDS = ['project', 'label', 'task', 'settings'] as const;
export type Kind = (typeof KINDS)[number];
