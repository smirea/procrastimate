<script lang="ts">
	import { feedback } from '@stefan.inc/feedback-engine/svelte';
	import { flip } from 'svelte/animate';
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import ImageSquare from 'phosphor-svelte/lib/ImageSquare';
	import Paperclip from 'phosphor-svelte/lib/Paperclip';
	import Plus from 'phosphor-svelte/lib/Plus';
	import X from 'phosphor-svelte/lib/X';
	import { formatBytes } from 'shared/format.ts';
	import type { Task } from 'shared/task.ts';
	import { isImage } from 'shared/values.ts';
	import { attachments } from '../attachments/attachments.svelte.ts';
	import { motion } from '../motion.ts';
	import FileIcon from './FileIcon.svelte';

	let { task, home, editable }: { task: Task; home: string | null; editable: boolean } = $props();

	let picker = $state<HTMLInputElement>();
	const imageIds = $derived(task.attachments.filter(isImage).map(image => image.id));
	/** The task's attachments, then the ones still being kept on the device, which show before the task lists them. */
	const tiles = $derived.by(() => {
		const listed = new Set(task.attachments.map(attachment => attachment.id));
		const adding = (attachments.adding[task.id] ?? []).filter(attachment => !listed.has(attachment.id));
		return [
			...task.attachments.map(attachment => ({ attachment, adding: false })),
			...adding.map(attachment => ({ attachment, adding: true })),
		];
	});

	$effect(() => {
		for (const id of imageIds) void attachments.load(home, id, 'thumb');
	});

	function picked(event: Event & { currentTarget: HTMLInputElement }) {
		const files = [...(event.currentTarget.files ?? [])];
		event.currentTarget.value = '';
		void attachments.attach(task.id, files);
	}
</script>

{#if tiles.length || editable}
	<section {@attach feedback()} aria-label="Attachments">
		<ul class="flex flex-wrap gap-2" aria-label={`Attachments of ${task.title}`}>
			{#each tiles as { attachment, adding } (attachment.id)}
				<li class="relative" animate:flip={motion({ duration: 220, easing: cubicOut })} in:scale={motion({ start: 0.85, duration: 220, easing: cubicOut })}>
					{#if isImage(attachment)}
						{@const url = attachments.url(attachment.id, 'thumb')}
						<button
							type="button"
							class="tile press"
							aria-label={adding ? 'Adding image' : `Open image ${imageIds.indexOf(attachment.id) + 1} of ${imageIds.length}`}
							aria-busy={adding || undefined}
							onclick={() => !adding && (attachments.viewing = { taskId: task.id, id: attachment.id })}
						>
							{#if url}
								<img src={url} alt="" class="size-full object-cover" draggable="false" />
							{:else}
								<span class="grid size-full place-items-center text-faint/60"><ImageSquare size={20} /></span>
							{/if}
						</button>
					{:else}
						{@const progress = attachments.progress(attachment)}
						<button
							type="button"
							class="tile file press"
							aria-label={`Open ${attachment.name}, ${formatBytes(attachment.bytes)}`}
							data-tooltip={attachment.name}
							aria-busy={attachments.opening[attachment.id] || adding || undefined}
							onclick={() => !adding && void attachments.open(task.id, attachment)}
						>
							<FileIcon name={attachment.name} type={attachment.type} size={26} />
							<span class="flex min-w-0 flex-col items-start text-left">
								<span class="line-clamp-2 text-[12.5px] leading-tight font-medium [overflow-wrap:anywhere] text-ink">{attachment.name}</span>
								<span class="mt-0.5 text-[11px] text-faint tabular-nums">
									{#if progress !== undefined}{Math.floor(progress * 100)}% of {/if}{formatBytes(attachment.bytes)}
								</span>
							</span>
							{#if progress !== undefined}
								<span class="progress" style:scale={`${progress} 1`} role="progressbar" aria-label={`Uploading ${attachment.name}`} aria-valuenow={Math.floor(progress * 100)}></span>
							{/if}
							{#if attachments.opening[attachment.id]}
								<span class="absolute inset-0 grid place-items-center rounded-2xl bg-surface/70"><span class="spinner"></span></span>
							{/if}
						</button>
						{#if editable && !adding}
							<button
								type="button"
								class="remove hit-area absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-ink text-surface shadow-sm"
								aria-label={`Delete ${attachment.name}`}
								onclick={() => attachments.remove(task.id, attachment.id)}
							>
								<X size={10} weight="bold" />
							</button>
						{/if}
					{/if}
				</li>
			{/each}
			{#if editable}
				<li>
					<button type="button" class="tile add press" aria-label="Add attachment" data-tooltip="Add images or files, or paste or drop them here" onclick={() => picker?.click()}>
						<Paperclip size={20} />
						<Plus size={11} weight="bold" class="absolute right-2.5 bottom-2.5" />
					</button>
					<input bind:this={picker} type="file" multiple class="hidden" aria-hidden="true" tabindex="-1" onchange={picked} />
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

	.file {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 10.5rem;
		padding: 0 0.75rem 0 0.625rem;
	}

	.progress {
		position: absolute;
		inset: auto 0 0 0;
		height: 2px;
		background: var(--color-accent);
		transform-origin: left;
		transition: scale 300ms ease;
	}

	.add {
		color: var(--color-muted);
		box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--color-ink) 14%, transparent);
		background: transparent;
	}

	.spinner {
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 9999px;
		border: 2px solid color-mix(in srgb, var(--color-ink) 18%, transparent);
		border-top-color: var(--color-ink);
		animation: spin 700ms linear infinite;
	}

	@keyframes spin {
		to {
			rotate: 1turn;
		}
	}

	@media (hover: hover) {
		.add:hover {
			color: var(--color-ink);
			background: color-mix(in srgb, var(--color-ink) 6%, transparent);
		}

		.remove {
			opacity: 0;
			scale: 0.8;
			transition:
				opacity 140ms ease,
				scale 220ms var(--ease-spring);
		}

		li:hover > .remove,
		.remove:focus-visible {
			opacity: 1;
			scale: 1;
		}
	}
</style>
