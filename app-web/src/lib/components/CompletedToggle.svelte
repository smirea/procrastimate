<script lang="ts">
	import CheckCircle from 'phosphor-svelte/lib/CheckCircle';
	import { completed, type ShownList } from '../completed.svelte.ts';

	let { list }: { list: ShownList } = $props();
	const shown = $derived(completed.shown(list));
</script>

<button
	type="button"
	class="icon-btn touch:size-11 {shown ? 'text-accent!' : ''}"
	aria-label="Show completed"
	aria-pressed={shown}
	onclick={() => completed.toggle(list)}
>
	<CheckCircle size={19} weight={shown ? 'fill' : 'regular'} />
</button>
