<script lang="ts">
	import type { Person } from 'shared/sharing.ts';
	import { session } from '../session.svelte.ts';

	/** `you` names the signed-in user as "You" instead of their own name. */
	let { person, you = false, class: className = '' }: { person: Person | undefined; you?: boolean; class?: string } = $props();

	const name = $derived(!person ? 'Someone' : you && person.id === session.userId ? 'You' : person.name);
</script>

<span class="inline-flex min-w-0 items-center gap-1 {className}">
	<span class="truncate">{name}</span>
	{#if person?.kind === 'ai'}
		<span class="ai-badge" title="AI account">AI</span>
	{/if}
</span>

<style>
	.ai-badge {
		flex-shrink: 0;
		padding: 0 0.3125rem;
		border-radius: 9999px;
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		color: var(--color-accent);
		font-size: 0.625rem;
		font-weight: 600;
		line-height: 1rem;
		letter-spacing: 0.04em;
	}
</style>
