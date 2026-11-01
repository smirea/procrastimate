<script lang="ts">
	import { fly, slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Check from 'phosphor-svelte/lib/Check';
	import Copy from 'phosphor-svelte/lib/Copy';
	import Robot from 'phosphor-svelte/lib/Robot';
	import { motion } from '../ui.svelte.ts';

	/** Null while the server makes it. */
	let { made }: { made: { value: string; prompt: string } | null } = $props();
	/** Tied to the token it copied, so a newly made one starts uncopied. */
	let last = $state.raw<{ of: typeof made; what: 'token' | 'prompt' } | null>(null);
	const copied = $derived(last && last.of === made ? last.what : null);

	async function copy(what: 'token' | 'prompt') {
		const of = made;
		if (!of) return;
		await navigator.clipboard?.writeText(what === 'token' ? of.value : of.prompt).catch(() => undefined);
		last = { of, what };
	}
</script>

<div class="token mx-1.5 mb-1 flex flex-col gap-1.5 rounded-xl p-2" transition:slide={motion({ duration: 200, easing: cubicOut })}>
	<p class="text-[12px] text-muted">Copy it now. It will not be shown again.</p>
	<div class="flex items-center gap-1.5">
		{#if made === null}
			<span class="pending-value h-4 min-w-0 flex-1" role="status" aria-label="Making a token"></span>
		{:else}
			<code class="min-w-0 flex-1 truncate text-[12px] select-all" aria-label="Token" in:fly={motion({ y: 3, duration: 140 })}>{made.value}</code>
		{/if}
		<button type="button" class="btn btn-quiet h-8 px-3 text-[12px] touch:h-11" disabled={made === null} onclick={() => copy('token')}>
			{#if copied === 'token'}<span class="flex items-center gap-1" in:fly={motion({ y: 3, duration: 140 })}><Check size={13} weight="bold" />Copied</span>{:else}<Copy size={13} />Copy{/if}
		</button>
	</div>
	<button type="button" class="btn btn-quiet h-8 self-start px-3 text-[12px] touch:h-11" title="Copies the token with where to find the API docs" disabled={made === null} onclick={() => copy('prompt')}>
		{#if copied === 'prompt'}<span class="flex items-center gap-1" in:fly={motion({ y: 3, duration: 140 })}><Check size={13} weight="bold" />Copied</span>{:else}<Robot size={13} />Copy prompt for your AI{/if}
	</button>
</div>

<style>
	.token {
		background: color-mix(in srgb, var(--color-accent) 8%, transparent);
	}
</style>
