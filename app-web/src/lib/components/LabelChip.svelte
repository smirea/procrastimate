<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { scale } from 'svelte/transition';
	import Tag from 'phosphor-svelte/lib/Tag';
	import type { LabelColor } from 'shared/label-colors.ts';
	import { labelStyle } from '../label-colors.ts';
	import { motion } from '../ui.svelte.ts';

	let { name, color, children }: { name: string; color: LabelColor; children?: Snippet } = $props();
</script>

<span class="label-chip" data-label={name} data-color={color} style={labelStyle(color)} transition:scale={motion({ start: 0.6, duration: 180, easing: cubicOut })}>
	<Tag size={10} weight="fill" class="shrink-0" />
	{#if children}{@render children()}{:else}<span class="truncate">{name}</span>{/if}
</span>
