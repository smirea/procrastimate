<script lang="ts">
	import Plus from 'phosphor-svelte/lib/Plus';
	import type { Section } from 'shared/task.ts';
	import { quickAddDefaults } from '../screen.ts';
	import { sheets } from '../ui.svelte.ts';

	/** A section's row adds to that section, and any other row to the screen it sits on. */
	let { section, label = 'Add task' }: { section?: Section; label?: string } = $props();
</script>

<button
	type="button"
	class="press group mt-1 flex h-10 w-full items-center gap-3 rounded-full px-2 text-[14px] text-muted transition-colors hover:text-accent touch:h-12 touch:text-[15px]"
	onclick={() => sheets.openQuickAdd(quickAddDefaults(section ? { kind: 'project', id: section.projectId, sectionId: section.id } : undefined))}
>
	<span class="grid size-[18px] place-items-center rounded-full text-accent transition-colors group-hover:bg-accent group-hover:text-on-accent">
		<Plus size={13} weight="bold" />
	</span>
	{label}
</button>
