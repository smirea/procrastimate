<script lang="ts">
	import X from 'phosphor-svelte/lib/X';
	import { scale } from 'svelte/transition';

	let { onclick }: { onclick: () => void } = $props();
</script>

<button
	type="button"
	class="hit-area relative -ml-1 grid size-6 place-items-center rounded-full text-faint transition-colors hover:bg-black/5 hover:text-ink"
	title="Keep as text"
	aria-label="Keep as text"
	{onclick}
	transition:scale={{ start: 0.6, duration: 140 }}
>
	<X size={12} weight="bold" />
</button>
