import { goto } from '$app/navigation';

type Named = { id: string; name: string };

/**
 * Sync merges a project or label into the oldest one with the same name, ignoring case. A page whose record
 * vanished follows its last-seen name to the survivor, or leaves for Inbox when there is none.
 */
export function followMerged(base: string, id: () => string | undefined, items: () => readonly Named[]) {
	let last: Named | undefined;
	$effect(() => {
		const current = id();
		const item = items().find(i => i.id === current);
		if (item) {
			last = { id: item.id, name: item.name };
			return;
		}
		if (!last || last.id !== current) return;
		const name = last.name.toLowerCase();
		const survivor = items().find(i => i.name.toLowerCase() === name);
		void goto(survivor ? `${base}/${survivor.id}` : '/inbox', { replace: true });
	});
}
