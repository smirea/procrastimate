<script lang="ts">
	import { feedback } from '@stefan.inc/feedback-engine/svelte';
	import type { ShareTarget } from 'shared/sharing.ts';
	import SharePanel from './SharePanel.svelte';
	import Sheet from './Sheet.svelte';

	let { target, name }: { target: ShareTarget; name: string } = $props();
</script>

<!-- Reopened for another list during its outro, the sheet slides back instead of remounting, so only the panel starts over. -->
<Sheet {@attach feedback()} label="Share" desktop="fly" class="flex-col gap-4 overflow-y-auto overscroll-contain p-3 md:top-[14vh] md:left-1/2 md:w-96 md:-translate-x-1/2 md:rounded-panel">
	{#key `${target.kind}:${target.id}`}
		<SharePanel {target} {name} />
	{/key}
</Sheet>
