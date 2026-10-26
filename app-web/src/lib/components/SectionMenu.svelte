<script lang="ts">
	import type { Snippet } from 'svelte';
	import PencilSimple from 'phosphor-svelte/lib/PencilSimple';
	import Trash from 'phosphor-svelte/lib/Trash';
	import Popover from './Popover.svelte';

	/**
	 * A section's menu, opened by tapping its title: rename, delete behind a confirmation, and its own items, under the
	 * section's name so the menu says what it acts on.
	 */
	let {
		name,
		confirm,
		ondelete,
		onrename,
		after,
	}: {
		name: string;
		/** The question the delete asks, with what goes along. */
		confirm: Snippet;
		ondelete: () => void;
		onrename: () => void;
		after?: Snippet<[{ close: () => void }]>;
	} = $props();

	let confirmingDelete = $state(false);
</script>

<Popover label="Section actions">
	{#snippet trigger({ open, toggle })}
		<h2 class="min-w-0">
			<button
				type="button"
				class="press block max-w-full truncate rounded-md text-left text-[15px] font-semibold"
				aria-haspopup="dialog"
				aria-expanded={open}
				onclick={() => {
					confirmingDelete = false;
					toggle();
				}}
			>{name}</button>
		</h2>
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
			<p class="max-w-60 truncate px-2.5 pt-1 pb-1.5 text-[13px] font-semibold text-muted">{name}</p>
			<button type="button" class="menu-item" onclick={() => {
				onrename();
				close();
			}}><PencilSimple size={15} />Rename</button>
			{@render after?.({ close })}
			<button type="button" class="menu-item text-[var(--tone-overdue)]" onclick={() => (confirmingDelete = true)}><Trash size={15} />Delete section</button>
		{/if}
	{/snippet}
</Popover>
