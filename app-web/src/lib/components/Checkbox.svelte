<script lang="ts">
	import Check from 'phosphor-svelte/lib/Check';

	let { checked, tone, label, onclick, class: className = '' }: { checked: boolean; tone: string; label: string; onclick: () => void; class?: string } = $props();
</script>

<button
	type="button"
	role="checkbox"
	aria-checked={checked}
	aria-label={label}
	class="checkbox hit-area relative grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px] touch:size-5 {className}"
	class:checked
	style={`--tone: ${tone}`}
	{onclick}
>
	<Check size={10} weight="bold" class="check-icon" />
</button>

<style>
	.checkbox {
		border-color: var(--tone);
		background: color-mix(in srgb, var(--tone) 8%, transparent);
		color: white;
		transition:
			background 180ms var(--ease-spring),
			transform 180ms var(--ease-spring);
	}

	@media (hover: hover) {
		.checkbox:hover {
			background: color-mix(in srgb, var(--tone) 18%, transparent);
		}

		.checkbox:hover :global(.check-icon) {
			opacity: 0.6;
			transform: scale(1);
			color: var(--tone);
		}
	}

	.checkbox:active {
		transform: scale(0.88);
	}

	.checkbox :global(.check-icon) {
		opacity: 0;
		transform: scale(0.4);
		transition:
			opacity 160ms var(--ease-spring),
			transform 220ms var(--ease-spring);
	}

	.checkbox.checked {
		background: var(--tone);
		animation: pop 260ms var(--ease-spring);
	}

	.checkbox.checked :global(.check-icon) {
		opacity: 1;
		transform: scale(1);
		color: white;
	}

	@keyframes pop {
		50% {
			transform: scale(1.18);
		}
	}
</style>
