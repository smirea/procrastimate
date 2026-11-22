<script lang="ts">
	import { feedback } from '@stefan.inc/feedback-engine/svelte';
	import { REACTIONS, type ReactionEmoji } from 'shared/reactions.ts';

	/** `mine` is the user's current reaction, which picking again takes back. */
	let { mine, onpick, menu = false }: { mine: ReactionEmoji | undefined; onpick: (emoji: ReactionEmoji) => void; menu?: boolean } = $props();
</script>

<div {@attach feedback()} class="flex items-center gap-0.5" role="group" aria-label="React">
	{#each REACTIONS as emoji (emoji)}
		<button
			type="button"
			role={menu ? 'menuitemcheckbox' : undefined}
			aria-checked={menu ? mine === emoji : undefined}
			aria-pressed={menu ? undefined : mine === emoji}
			aria-label={`React ${emoji}`}
			class="press grid size-8 place-items-center rounded-full text-[17px] transition-[background-color,scale] hover:scale-115 hover:bg-ink/[0.06] touch:size-10"
			class:picked={mine === emoji}
			onclick={() => onpick(emoji)}
		>
			{emoji}
		</button>
	{/each}
</div>

<style>
	.picked {
		background: color-mix(in srgb, var(--color-accent) 16%, transparent);
	}
</style>
