<script lang="ts">
	import CheckCircle from 'phosphor-svelte/lib/CheckCircle';
	import { completed } from '../completed.svelte.ts';
</script>

<button
	type="button"
	class="icon-btn touch:size-11 {completed.shown ? 'text-accent!' : ''}"
	aria-label="Show completed"
	aria-pressed={completed.shown}
	onclick={() => completed.toggle()}
>
	<CheckCircle size={19} weight={completed.shown ? 'fill' : 'regular'} />
</button>
