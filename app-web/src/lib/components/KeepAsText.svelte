<script lang="ts">
	import X from 'phosphor-svelte/lib/X';
	import { scale } from 'svelte/transition';
	import { motion } from '../ui.svelte.ts';

	let { onclick }: { onclick: () => void } = $props();
</script>

<button
	type="button"
	class="icon-btn hit-area -ml-0.5 size-8 touch:-ml-1 touch:size-11"
	aria-label="Keep as text"
	{onclick}
	transition:scale={motion({ start: 0.6, duration: 160 })}
>
	<X size={14} weight="bold" />
</button>
