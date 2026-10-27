<script lang="ts">
	import Check from 'phosphor-svelte/lib/Check';
	import { ACCENTS, accentBase, accentChoices, deriveAccent, isCustomAccent, type Accent, type CustomAccent } from 'shared/accents.ts';
	import { theme } from '../theme.svelte.ts';

	const COLUMNS = 5;
	const rgb = (c: readonly number[]) => `rgb(${c.join(' ')})`;
	const swatches = accentChoices.map(key => ({ key, name: ACCENTS[key].name, derived: deriveAccent(ACCENTS[key].base) }));

	let buttons: HTMLButtonElement[] = $state([]);
	const custom = $derived(isCustomAccent(theme.accent) ? deriveAccent(theme.accent)[theme.resolved] : undefined);
	const checkedIndex = $derived(isCustomAccent(theme.accent) ? -1 : accentChoices.indexOf(theme.accent));

	function onkeydown(event: KeyboardEvent) {
		const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS }[event.key];
		if (!step) return;
		event.preventDefault();
		const next = (checkedIndex + step + accentChoices.length) % accentChoices.length;
		choose(accentChoices[next]!);
		buttons[next]?.focus();
	}

	const choose = (accent: Accent) => theme.chooseAccent(accent);
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
			tabindex={checked || (checkedIndex < 0 && i === 0) ? 0 : -1}
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

<!-- The native color well, transparent over the whole row, so a click anywhere on it opens the system picker. -->
<label class="custom press">
	<span
		class="swatch"
		aria-hidden="true"
		style:--swatch={custom ? rgb(custom.accent) : undefined}
		style:color={custom ? rgb(custom.onAccent) : undefined}
		data-checked={custom ? 'true' : undefined}
	>
		{#if custom}<Check size={14} weight="bold" />{/if}
	</span>
	<span class="text-sm text-ink">Custom</span>
	{#if custom}<span class="ml-auto font-mono text-xs text-muted uppercase">{theme.accent}</span>{/if}
	<input
		type="color"
		aria-label="Custom theme color"
		value={accentBase(theme.accent)}
		oninput={event => choose(event.currentTarget.value.toLowerCase() as CustomAccent)}
	/>
</label>

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

	.swatch[aria-checked='true'],
	.swatch[data-checked] {
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

	.custom {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.625rem;
		margin-top: 0.25rem;
		padding: 0.25rem 0.375rem;
		border-radius: 0.75rem;
		cursor: pointer;
	}

	.custom:hover {
		background: color-mix(in srgb, var(--color-ink) 5%, transparent);
	}

	.custom:has(input:focus-visible) {
		box-shadow: 0 0 0 2px var(--color-ink);
	}

	.custom .swatch:not([data-checked]) {
		background: conic-gradient(from 90deg, #ff4d4d, #ffb84d, #e6ff4d, #4dff88, #4dd2ff, #6b4dff, #ff4dd8, #ff4d4d);
	}

	.custom input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}

	@media (max-width: 767px), (pointer: coarse) {
		.swatch {
			width: 2.75rem;
			height: 2.75rem;
		}
	}
</style>
