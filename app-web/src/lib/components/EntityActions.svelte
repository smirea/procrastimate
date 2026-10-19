<script lang="ts">
	import type { Snippet } from 'svelte';
	import DotsThree from 'phosphor-svelte/lib/DotsThree';
	import PencilSimple from 'phosphor-svelte/lib/PencilSimple';
	import Trash from 'phosphor-svelte/lib/Trash';
	import Popover from './Popover.svelte';

	/** The actions popover of a project, label, or section heading: rename, delete behind a confirmation, and its own items. */
	let {
		label,
		triggerLabel,
		triggerClass = 'icon-btn touch:size-11',
		iconSize = 20,
		deleteLabel,
		confirm,
		ondelete,
		onrename,
		before,
		after,
	}: {
		label: string;
		triggerLabel: string;
		triggerClass?: string;
		iconSize?: number;
		deleteLabel: string;
		/** The question the delete asks, with what goes along. */
		confirm: Snippet;
		ondelete: () => void;
		onrename: () => void;
		before?: Snippet<[{ close: () => void }]>;
		after?: Snippet<[{ close: () => void }]>;
	} = $props();

	let confirmingDelete = $state(false);
</script>

<Popover {label} align="end">
	{#snippet trigger({ toggle })}
		<button
			type="button"
			class={triggerClass}
			aria-label={triggerLabel}
			onclick={() => {
				confirmingDelete = false;
				toggle();
			}}
		>
			<DotsThree size={iconSize} weight="bold" />
		</button>
	{/snippet}
	{#snippet children({ close })}
		{#if confirmingDelete}
			<div class="w-60 p-1.5 text-[13px]">
				<p>{@render confirm()}</p>
				<div class="mt-2 flex justify-end gap-1.5">
					<button type="button" class="btn btn-quiet" onclick={close}>Cancel</button>
					<button
						type="button"
						class="btn press bg-[var(--tone-overdue)] text-on-accent"
						onclick={() => {
							close();
							ondelete();
						}}>Delete</button
					>
				</div>
			</div>
		{:else}
			{@render before?.({ close })}
			<button type="button" class="menu-item" onclick={() => {
				onrename();
				close();
			}}><PencilSimple size={15} />Rename</button>
			{@render after?.({ close })}
			<button type="button" class="menu-item text-[var(--tone-overdue)]" onclick={() => (confirmingDelete = true)}><Trash size={15} />{deleteLabel}</button>
		{/if}
	{/snippet}
</Popover>
