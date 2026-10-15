<script lang="ts">
	import Plus from 'phosphor-svelte/lib/Plus';
	import { sheets, type QuickAddDefaults } from '../ui.svelte.ts';

	let { quickAdd, label = 'Add task' }: { quickAdd: QuickAddDefaults; label?: string } = $props();
</script>

<button
	type="button"
	class="press group mt-1 flex h-10 w-full items-center gap-3 rounded-full px-2 text-[14px] text-muted transition-colors hover:text-accent touch:h-12 touch:text-[15px]"
	onclick={() => sheets.openQuickAdd(quickAdd)}
>
	<span class="grid size-[18px] place-items-center rounded-full text-accent transition-colors group-hover:bg-accent group-hover:text-on-accent">
		<Plus size={13} weight="bold" />
	</span>
	{label}
</button>
