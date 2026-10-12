<script lang="ts">
	import { DICTATION_CHOICES, type DictationChoice } from 'shared/dictation.ts';
	import { store } from '../store.svelte.ts';

	const labels: Record<DictationChoice, string> = { native: 'Native', elevenlabs: 'ElevenLabs' };

	const selected = $derived(DICTATION_CHOICES.indexOf(store.dictation));
	let buttons: HTMLButtonElement[] = $state([]);

	function onkeydown(event: KeyboardEvent) {
		const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
		if (!step) return;
		event.preventDefault();
		const next = (selected + step + DICTATION_CHOICES.length) % DICTATION_CHOICES.length;
		const choice = DICTATION_CHOICES[next];
		if (!choice) return;
		store.setDictation(choice);
		buttons[next]?.focus();
	}
</script>

<div class="segmented" role="radiogroup" aria-label="Dictation" tabindex="-1" style:--selected={selected} {onkeydown}>
	<span class="thumb" aria-hidden="true"></span>
	{#each DICTATION_CHOICES as choice, i (choice)}
		{@const checked = store.dictation === choice}
		<button
			type="button"
			role="radio"
			aria-checked={checked}
			tabindex={checked ? 0 : -1}
			class="segment"
			bind:this={buttons[i]}
			onclick={() => store.setDictation(choice)}
		>
			{labels[choice]}
		</button>
	{/each}
</div>

<style>
	.segmented {
		position: relative;
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		padding: 0.125rem;
		border-radius: 0.625rem;
		background: color-mix(in srgb, var(--color-ink) 6%, transparent);
	}

	.thumb {
		position: absolute;
		inset: 0.125rem auto 0.125rem 0.125rem;
		width: calc((100% - 0.25rem) / 2);
		border-radius: 0.5rem;
		background: var(--color-surface);
		box-shadow:
			0 1px 2px color-mix(in srgb, var(--glass-shadow) 60%, transparent),
			0 0 0 0.5px color-mix(in srgb, var(--color-ink) 8%, transparent);
		transform: translateX(calc(var(--selected) * 100%));
		transition:
			transform 240ms var(--ease-spring),
			background 200ms var(--ease-spring);
	}

	.segment {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 1.75rem;
		border-radius: 0.5rem;
		font-size: 0.75rem;
		color: var(--color-muted);
		outline: none;
		transition:
			color 160ms var(--ease-spring),
			transform 160ms var(--ease-spring);
	}

	.segment[aria-checked='true'] {
		color: var(--color-ink);
		font-weight: 500;
	}

	.segment:focus-visible {
		box-shadow: 0 0 0 2px var(--color-accent);
	}

	.segment:active {
		transform: scale(0.96);
	}

	@media (hover: hover) {
		.segment:hover {
			color: var(--color-ink);
		}
	}

	@media (max-width: 767px), (pointer: coarse) {
		.segmented {
			border-radius: 0.875rem;
		}

		.thumb {
			border-radius: 0.75rem;
		}

		.segment {
			height: 2.75rem;
			border-radius: 0.75rem;
			font-size: 0.875rem;
		}
	}
</style>
