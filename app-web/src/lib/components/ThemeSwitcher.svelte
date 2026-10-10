<script lang="ts">
	import type { Component } from 'svelte';
	import Desktop from 'phosphor-svelte/lib/Desktop';
	import Sun from 'phosphor-svelte/lib/Sun';
	import Moon from 'phosphor-svelte/lib/Moon';
	import { theme, themeChoices, type ThemeChoice } from '../theme.svelte.ts';

	const options: Record<ThemeChoice, { label: string; icon: Component<{ size?: number; weight?: 'regular' | 'fill' }> }> = {
		system: { label: 'System', icon: Desktop },
		light: { label: 'Light', icon: Sun },
		dark: { label: 'Dark', icon: Moon },
	};

	const selected = $derived(themeChoices.indexOf(theme.choice));
	let buttons: HTMLButtonElement[] = $state([]);

	function onkeydown(event: KeyboardEvent) {
		const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
		if (!step) return;
		event.preventDefault();
		const next = (selected + step + themeChoices.length) % themeChoices.length;
		theme.choose(themeChoices[next]!);
		buttons[next]?.focus();
	}
</script>

<div class="segmented" role="radiogroup" aria-label="Theme" tabindex="-1" style:--selected={selected} {onkeydown}>
	<span class="thumb" aria-hidden="true"></span>
	{#each themeChoices as choice, i (choice)}
		{@const option = options[choice]}
		{@const checked = theme.choice === choice}
		<button
			type="button"
			role="radio"
			aria-checked={checked}
			tabindex={checked ? 0 : -1}
			class="segment"
			bind:this={buttons[i]}
			onclick={() => theme.choose(choice)}
		>
			<option.icon size={14} weight={checked ? 'fill' : 'regular'} />
			{option.label}
		</button>
	{/each}
</div>

<style>
	.segmented {
		position: relative;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		padding: 0.125rem;
		border-radius: 0.625rem;
		background: color-mix(in srgb, var(--color-ink) 6%, transparent);
	}

	.thumb {
		position: absolute;
		inset: 0.125rem auto 0.125rem 0.125rem;
		width: calc((100% - 0.25rem) / 3);
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
		gap: 0.3125rem;
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
