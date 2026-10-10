<script lang="ts">
	import Tray from 'phosphor-svelte/lib/Tray';
	import Hash from 'phosphor-svelte/lib/Hash';
	import Check from 'phosphor-svelte/lib/Check';
	import Popover from './Popover.svelte';
	import KeepAsText from './KeepAsText.svelte';
	import { store } from '../store.svelte.ts';

	let {
		projectId,
		onchange,
		onkeepastext,
		align = 'start',
	}: {
		projectId: string | null;
		onchange: (projectId: string | null) => void;
		onkeepastext?: () => void;
		align?: 'start' | 'end';
	} = $props();

	const project = $derived(store.project(projectId));
	const options = $derived([{ id: null, name: 'Inbox' }, ...store.projects]);
</script>

<div class="flex items-center">
	<Popover label="Project" {align}>
		{#snippet trigger({ toggle })}
			<button type="button" class="chip" data-active={!!project} aria-label={`Project ${project?.name ?? 'Inbox'}`} onclick={toggle}>
				{#if project}<Hash size={15} />{:else}<Tray size={15} />{/if}
				{project?.name ?? 'Inbox'}
			</button>
		{/snippet}
		{#snippet children({ close })}
			{#each options as option (option.id)}
				<button
					type="button"
					class="menu-item"
					onclick={() => {
						onchange(option.id);
						close();
					}}
				>
					{#if option.id}<Hash size={15} class="text-muted" />{:else}<Tray size={15} class="text-muted" />{/if}
					<span class="flex-1">{option.name}</span>
					{#if option.id === projectId}<Check size={14} class="text-accent" />{/if}
				</button>
			{/each}
		{/snippet}
	</Popover>
	{#if onkeepastext}<KeepAsText onclick={onkeepastext} />{/if}
</div>
