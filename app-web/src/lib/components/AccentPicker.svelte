<script lang="ts">
	import Check from 'phosphor-svelte/lib/Check';
	import { ACCENTS, accentChoices, deriveAccent, type AccentChoice } from 'shared/accents.ts';
	import { theme } from '../theme.svelte.ts';

	const COLUMNS = 5;
	const rgb = (c: readonly number[]) => `rgb(${c.join(' ')})`;
	const swatches = accentChoices.map(key => ({ key, name: ACCENTS[key].name, derived: deriveAccent(ACCENTS[key].base) }));

	let buttons: HTMLButtonElement[] = $state([]);

	function onkeydown(event: KeyboardEvent) {
		const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS }[event.key];
		if (!step) return;
		event.preventDefault();
		const next = (accentChoices.indexOf(theme.accent) + step + accentChoices.length) % accentChoices.length;
		choose(accentChoices[next]!);
		buttons[next]?.focus();
	}

	const choose = (accent: AccentChoice) => theme.chooseAccent(accent);
</script>

<div class="grid grid-cols-5 justify-items-center gap-1.5 px-1.5" role="radiogroup" aria-label="Theme color" tabindex="-1" {onkeydown}>
	{#each swatches as swatch, i (swatch.key)}
		{@const checked = theme.accent === swatch.key}
		{@const tokens = swatch.derived[theme.resolved]}
		<button
			type="button"
			role="radio"
			aria-checked={checked}
			aria-label={swatch.name}
			title={swatch.name}
			tabindex={checked ? 0 : -1}
			class="swatch"
			style:--swatch={rgb(tokens.accent)}
			style:color={rgb(tokens.onAccent)}
			bind:this={buttons[i]}
			onclick={() => choose(swatch.key)}
		>
			{#if checked}<Check size={14} weight="bold" />{/if}
		</button>
	{/each}
</div>

<style>
	.swatch {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 9999px;
		background: var(--swatch);
		outline: none;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-ink) 10%, transparent);
		transition:
			transform 160ms var(--ease-spring),
			box-shadow 200ms var(--ease-spring);
	}

	.swatch[aria-checked='true'] {
		box-shadow:
			0 0 0 2px var(--glass-solid),
			0 0 0 4px var(--swatch);
	}

	.swatch:focus-visible {
		box-shadow:
			0 0 0 2px var(--glass-solid),
			0 0 0 4px var(--color-ink);
	}

	.swatch:active {
		transform: scale(0.9);
	}

	@media (max-width: 767px), (pointer: coarse) {
		.swatch {
			width: 2.75rem;
			height: 2.75rem;
		}
	}
</style>
