<script lang="ts">
	import { feedback } from '@stefan.inc/feedback-engine/svelte';
	import X from 'phosphor-svelte/lib/X';
	import Settings from './Settings.svelte';
	import Sheet from './Sheet.svelte';
	import { sheets } from '../sheets.svelte.ts';
</script>

<Sheet {@attach feedback()} label="Settings" desktop="fly" class="flex-col overflow-y-auto overscroll-contain p-3 md:top-[14vh] md:left-1/2 md:w-80 md:-translate-x-1/2 md:rounded-panel">
	<div class="flex items-center justify-between pb-1 pl-1.5">
		<h2 class="text-[17px] font-semibold">Settings</h2>
		<button
			type="button"
			class="icon-btn"
			aria-label="Close settings"
			onclick={() => sheets.close()}
		>
			<X size={18} weight="bold" />
		</button>
	</div>
	<Settings onclose={() => sheets.close()} />
</Sheet>
