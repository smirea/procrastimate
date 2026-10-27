/** The handle `app-web/src/lib/sync.svelte.ts` puts on the page for these specs. */
declare global {
	interface Window {
		procrastimate: {
			pending(): Promise<number>;
			reads(): { reloads: number; rows: number; ms: number };
			taskId(title: string): string | undefined;
			entity(kind: string, id: string): Record<string, unknown> | undefined;
		};
	}
}

export {};
