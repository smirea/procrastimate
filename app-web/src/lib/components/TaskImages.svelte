<script lang="ts">
	import { flip } from 'svelte/animate';
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import ImageSquare from 'phosphor-svelte/lib/ImageSquare';
	import Plus from 'phosphor-svelte/lib/Plus';
	import type { Task } from 'shared/task.ts';
	import { images } from '../images/images.svelte.ts';
	import { motion } from '../ui.svelte.ts';

	let { task, home, editable }: { task: Task; home: string | null; editable: boolean } = $props();

	let picker = $state<HTMLInputElement>();
	const adding = $derived(images.adding[task.id] ?? 0);

	$effect(() => {
		for (const image of task.images) void images.load(home, image.id, 'thumb');
	});

	function picked(event: Event & { currentTarget: HTMLInputElement }) {
		const files = [...(event.currentTarget.files ?? [])];
		event.currentTarget.value = '';
		void images.attach(task.id, files);
	}
</script>

{#if task.images.length || adding || editable}
	<section aria-label="Images">
		<ul class="flex flex-wrap gap-2" aria-label={`Images of ${task.title}`}>
			{#each task.images as image, index (image.id)}
				{@const url = images.url(image.id, 'thumb')}
				<li animate:flip={motion({ duration: 220, easing: cubicOut })} in:scale={motion({ start: 0.85, duration: 220, easing: cubicOut })}>
					<button
						type="button"
						class="tile press"
						aria-label={`Open image ${index + 1} of ${task.images.length}`}
						onclick={() => (images.viewing = { taskId: task.id, id: image.id })}
					>
						{#if url}
							<img src={url} alt="" class="size-full object-cover" draggable="false" />
						{:else}
							<span class="grid size-full place-items-center text-faint/60"><ImageSquare size={20} /></span>
						{/if}
					</button>
				</li>
			{/each}
			{#each { length: adding }, index (index)}
				<li class="tile animate-pulse" aria-label="Adding image" in:scale={motion({ start: 0.85, duration: 220, easing: cubicOut })}></li>
			{/each}
			{#if editable}
				<li>
					<button type="button" class="tile add press" aria-label="Add image" title="Add images, or paste or drop them here" onclick={() => picker?.click()}>
						<ImageSquare size={20} />
						<Plus size={11} weight="bold" class="absolute right-2.5 bottom-2.5" />
					</button>
					<input bind:this={picker} type="file" accept="image/*" multiple class="hidden" aria-hidden="true" tabindex="-1" onchange={picked} />
				</li>
			{/if}
		</ul>
	</section>
{/if}

<style>
	.tile {
		position: relative;
		display: grid;
		place-items: center;
		width: 4.5rem;
		height: 4.5rem;
		overflow: hidden;
		border-radius: 1rem;
		background: color-mix(in srgb, var(--color-ink) 5%, transparent);
		box-shadow: inset 0 0 0 1px var(--glass-edge);
	}

	.add {
		color: var(--color-muted);
		box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--color-ink) 14%, transparent);
		background: transparent;
	}

	@media (hover: hover) {
		.add:hover {
			color: var(--color-ink);
			background: color-mix(in srgb, var(--color-ink) 6%, transparent);
		}
	}
</style>
