<script lang="ts">
	import { fly, scale } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { cubicOut } from 'svelte/easing';
	import MapPin from 'phosphor-svelte/lib/MapPin';
	import type { SuggestionPill } from 'shared/task-suggestions.ts';
	import ProjectGlyph from './ProjectGlyph.svelte';
	import { store } from '../store.svelte.ts';
	import { labelStyle } from '../label-colors.ts';
	import { labelIcon } from '../label-icon.ts';
	import { motion } from '../ui.svelte.ts';

	let { pills, onpick }: { pills: SuggestionPill[]; onpick: (pill: SuggestionPill) => void } = $props();

	function describe(pill: SuggestionPill) {
		switch (pill.kind) {
			case 'project': {
				const project = store.project(pill.projectId)?.name ?? '';
				const section = store.section(pill.sectionId)?.name;
				return {
					key: `project:${pill.projectId}:${pill.sectionId}`,
					kind: 'project',
					name: section ? `${project} / ${section}` : project,
				};
			}
			case 'label':
				return { key: `label:${pill.labelId}`, kind: 'label', name: store.label(pill.labelId)?.name ?? '' };
			case 'place':
				return { key: `place:${pill.location.name}`, kind: 'place', name: pill.location.name };
		}
	}

	const shown = $derived(pills.map((pill) => ({ pill, ...describe(pill) })));
</script>

{#if shown.length}
	<div
		class="pills pointer-events-auto flex gap-1.5 overflow-x-auto px-3 py-1"
		role="group"
		aria-label="Suggestions"
		transition:fly={motion({ y: 8, duration: 180, easing: cubicOut })}
	>
		{#each shown as { pill, key, kind, name } (key)}
			{@const label = pill.kind === 'label' ? store.label(pill.labelId) : undefined}
			<button
				type="button"
				class="chip pill hit-area relative shrink-0"
				class:label-tinted={label}
				style={label ? labelStyle(label.color) : undefined}
				aria-label={`Suggest ${name} as ${kind}`}
				animate:flip={motion({ duration: 200, easing: cubicOut })}
				transition:scale={motion({ start: 0.9, duration: 160 })}
				onmousedown={(e) => e.preventDefault()}
				onclick={() => onpick(pill)}
			>
				{#if pill.kind === 'project'}
					<ProjectGlyph project={store.project(pill.projectId)} size={15} />
				{:else if label}
					{@const Icon = labelIcon(label)}
					<Icon size={15} weight="fill" />
				{:else}
					<MapPin size={15} weight="fill" />
				{/if}
				{name}
			</button>
		{/each}
	</div>
{/if}

<style>
	.pills {
		scrollbar-width: none;
	}

	/* Dashed, so an offer reads apart from the chips of what the task already holds, and glass, so it reads over the scrim. */
	.pill {
		height: 2rem;
		background: var(--glass-strong-bg);
		box-shadow: 0 4px 14px -6px var(--glass-shadow-strong);
		border: 1px dashed color-mix(in srgb, currentColor 45%, transparent);
	}

	.pill.label-tinted {
		background: linear-gradient(var(--label-fill), var(--label-fill)), var(--glass-strong-bg);
	}
</style>
