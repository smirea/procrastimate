<script lang="ts">
	import Plus from 'phosphor-svelte/lib/Plus';
	import type { Screen } from 'shared/screens.ts';
	import { quickAddDefaults } from '../screen.ts';
	import { sheets } from '../ui.svelte.ts';

	/** A group's row, such as a section or an Inbox day, adds to `to` and is named for `group`; any other row adds to the screen it sits on. */
	let { to, group }: { to?: Screen; group?: string } = $props();
</script>

<button
	type="button"
	class="press group mt-1 flex h-10 w-full items-center gap-3 rounded-full px-2 text-[14px] text-muted transition-colors hover:text-accent touch:h-12 touch:text-[15px]"
	aria-label={group ? `Add task to ${group}` : undefined}
	onclick={() => sheets.openQuickAdd(quickAddDefaults(to))}
>
	<span class="grid size-[18px] place-items-center rounded-full text-accent transition-colors group-hover:bg-accent group-hover:text-on-accent">
		<Plus size={13} weight="bold" />
	</span>
	Add task
</button>
