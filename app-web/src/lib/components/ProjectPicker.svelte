<script lang="ts">
	import Tray from 'phosphor-svelte/lib/Tray';
	import Hash from 'phosphor-svelte/lib/Hash';
	import Check from 'phosphor-svelte/lib/Check';
	import Plus from 'phosphor-svelte/lib/Plus';
	import type { Project } from 'shared/task.ts';
	import Popover from './Popover.svelte';
	import { store } from '../store.svelte.ts';

	/** A shared task passes its space's projects, and its "Inbox" is the owner's, since nothing moves between spaces. */
	let {
		projectId,
		onchange,
		align = 'start',
		projects,
		canCreate = true,
	}: {
		projectId: string | null;
		onchange: (projectId: string | null) => void;
		align?: 'start' | 'end';
		projects?: readonly Project[];
		canCreate?: boolean;
	} = $props();

	const project = $derived(store.project(projectId));
	const options = $derived([{ id: null, name: 'Inbox' }, ...(projects ?? store.projects)]);

	let creating = $state(false);
	let name = $state('');

	function create(close: () => void) {
		const trimmed = name.trim();
		creating = false;
		name = '';
		if (!trimmed) return;
		onchange(store.addProject(trimmed).id);
		close();
	}
</script>

<div class="flex min-w-0 items-center">
	<Popover label="Project" {align}>
		{#snippet trigger({ toggle })}
			<button type="button" class="chip max-w-full" data-active={!!project} aria-label={`Project ${project?.name ?? 'Inbox'}`} onclick={toggle}>
				{#if project}<Hash size={15} class="shrink-0" />{:else}<Tray size={15} class="shrink-0" />{/if}
				<span class="truncate">{project?.name ?? 'Inbox'}</span>
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
			{#if canCreate}
				<div class="mt-1 border-t border-ink/5 pt-1">
					{#if creating}
						<input
							class="field w-full"
							aria-label="New project name"
							placeholder="Project name"
							{@attach (node) => node.focus()}
							bind:value={name}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									e.stopPropagation();
									create(close);
								} else if (e.key === 'Escape') {
									e.preventDefault();
									e.stopPropagation();
									creating = false;
									name = '';
								}
							}}
							onblur={() => create(close)}
						/>
					{:else}
						<button type="button" class="menu-item text-muted" onclick={() => (creating = true)}>
							<Plus size={15} />
							<span class="flex-1">New project</span>
						</button>
					{/if}
				</div>
			{/if}
		{/snippet}
	</Popover>
</div>
