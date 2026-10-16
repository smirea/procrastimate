<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import X from 'phosphor-svelte/lib/X';
	import Trash from 'phosphor-svelte/lib/Trash';
	import CaretLeft from 'phosphor-svelte/lib/CaretLeft';
	import CaretRight from 'phosphor-svelte/lib/CaretRight';
	import { images } from '../images/images.svelte.ts';
	import { store } from '../store.svelte.ts';
	import { motion } from '../ui.svelte.ts';

	const viewing = $derived(images.viewing);
	const task = $derived(viewing ? store.task(viewing.taskId) : undefined);
	const index = $derived(task && viewing ? task.images.findIndex(image => image.id === viewing.id) : -1);
	const image = $derived(task && index >= 0 ? task.images[index] : undefined);
	const home = $derived(task ? store.homeOf(task.id) : null);
	const editable = $derived(task ? store.canEdit(task.id) : false);
	const url = $derived(image ? (images.url(image.id, 'full') ?? images.url(image.id, 'thumb')) : undefined);

	let dialog = $state<HTMLElement>();

	$effect(() => {
		if (viewing && !image) images.viewing = null;
	});

	$effect(() => {
		if (!image) return;
		void images.load(home, image.id, 'full');
		void images.load(home, image.id, 'thumb');
	});

	$effect(() => {
		if (image) dialog?.focus();
	});

	function step(by: number) {
		if (!task || index < 0) return;
		const next = task.images[(index + by + task.images.length) % task.images.length];
		if (next) images.viewing = { taskId: task.id, id: next.id };
	}

	const close = () => (images.viewing = null);

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') close();
		else if (event.key === 'ArrowLeft') step(-1);
		else if (event.key === 'ArrowRight') step(1);
		else return;
		event.preventDefault();
		// The window's handler would close the task details behind the viewer too.
		event.stopPropagation();
	}
</script>

{#if task && image}
	<div
		bind:this={dialog}
		role="dialog"
		aria-modal="true"
		aria-label="Image"
		tabindex="-1"
		class="viewer fixed inset-0 z-[55] flex flex-col bg-black/90 text-white outline-none"
		transition:fade={motion({ duration: 160 })}
		{onkeydown}
	>
		<div class="flex items-center justify-between gap-2 px-3 pt-3">
			<span class="px-2 text-[13px] text-white/70">{task.images.length > 1 ? `${index + 1} of ${task.images.length}` : ''}</span>
			<div class="flex items-center gap-1">
				{#if editable}
					<button type="button" class="viewer-btn" aria-label="Delete image" onclick={() => images.remove(task.id, image.id)}>
						<Trash size={18} />
					</button>
				{/if}
				<button type="button" class="viewer-btn" aria-label="Close image" onclick={close}><X size={18} /></button>
			</div>
		</div>
		<!-- A click on the backdrop closes; one on the image itself does not. -->
		<div class="relative flex min-h-0 flex-1 items-center justify-center p-3" onclick={(e) => e.target === e.currentTarget && close()} role="presentation">
			{#key image.id}
				{#if url}
					<img
						src={url}
						alt={`Image ${index + 1} of ${task.title}`}
						width={image.width}
						height={image.height}
						class="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
						in:scale={motion({ start: 0.94, duration: 220, easing: cubicOut })}
					/>
				{/if}
			{/key}
			{#if task.images.length > 1}
				<button type="button" class="viewer-btn absolute left-3" aria-label="Previous image" onclick={() => step(-1)}><CaretLeft size={20} /></button>
				<button type="button" class="viewer-btn absolute right-3" aria-label="Next image" onclick={() => step(1)}><CaretRight size={20} /></button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.viewer {
		padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
	}

	.viewer-btn {
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 9999px;
		background: rgb(255 255 255 / 0.12);
		transition:
			scale 220ms var(--ease-spring),
			background 160ms var(--ease-spring);
	}

	.viewer-btn:active {
		scale: 0.9;
	}

	@media (hover: hover) {
		.viewer-btn:hover {
			background: rgb(255 255 255 / 0.22);
		}
	}
</style>
