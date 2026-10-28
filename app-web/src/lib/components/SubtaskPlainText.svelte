<script lang="ts">
	import TextT from 'phosphor-svelte/lib/TextT';

	/** A subtask line's own plain text toggle, apart from its task's. A row passes `disabled` where parsing would leave no title. */
	let { on, disabled = false, toggle }: { on: boolean; disabled?: boolean; toggle: () => void } = $props();
</script>

<button
	type="button"
	class="grid size-8 shrink-0 place-items-center rounded-full transition-colors touch:size-11 {on ? 'text-accent' : 'text-faint hover:text-ink'} disabled:opacity-40"
	aria-label="Plain text subtask"
	aria-pressed={on}
	title="Plain text: keep this subtask's dates, times, and tags in its title"
	{disabled}
	onmousedown={(e) => e.preventDefault()}
	onclick={toggle}
>
	<TextT size={14} weight={on ? 'bold' : 'regular'} />
</button>
