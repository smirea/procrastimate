<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import X from 'phosphor-svelte/lib/X';
	import Settings from './Settings.svelte';
	import { sheets, motion } from '../ui.svelte.ts';
</script>

<div class="fixed inset-0 z-40 bg-scrim backdrop-blur-[2px]" transition:fade={motion({ duration: 160 })} onclick={() => sheets.close()} aria-hidden="true"></div>
<div
	role="dialog"
	aria-label="Settings"
	class="glass-strong sheet fixed z-50 flex flex-col overflow-y-auto overscroll-contain p-3 md:top-[14vh] md:left-1/2 md:w-80 md:-translate-x-1/2 md:rounded-panel"
	transition:fly={motion({ y: '100%', duration: 300, easing: cubicOut, opacity: 1 })}
>
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
	<Settings />
</div>
