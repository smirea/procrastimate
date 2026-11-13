<script lang="ts">
	import { feedback } from '@stefan.inc/feedback-engine/svelte';
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import GithubLogo from 'phosphor-svelte/lib/GithubLogo';
	import X from 'phosphor-svelte/lib/X';
	import { githubLabel, githubUrl, parseGithubRef, sameGithubRef, withGithubRef, type GithubRef } from 'shared/github.ts';
	import type { Task } from 'shared/task.ts';
	import Popover from './Popover.svelte';
	import GithubIcon from './GithubIcon.svelte';
	import { githubItem } from '../github.svelte.ts';
	import { motion } from '../motion.ts';

	let { task, editable, onchange }: { task: Task; editable: boolean; onchange: (github: GithubRef[]) => void } = $props();

	let open = $state(false);
	let pasted = $state('');
	const ref = $derived(parseGithubRef(pasted));

	$effect(() => {
		if (open) pasted = '';
	});

	function attach(close: () => void) {
		if (!ref) return;
		onchange(withGithubRef(task.github, ref));
		close();
	}

	const STATES = { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' } as const;
</script>

{#if task.github.length || editable}
	<div {@attach feedback()} class="flex flex-wrap gap-1.5 px-4 pt-3" data-github>
		{#each task.github as attached (githubUrl(attached))}
			{@const item = githubItem(attached)}
			{@const kind = item?.kind ?? attached.kind}
			<span class="chip max-w-full gap-0 !px-0" data-active="true" in:scale={motion({ start: 0.9, duration: 160, easing: cubicOut })}>
				<a
					href={githubUrl({ ...attached, kind })}
					target="_blank"
					rel="noopener noreferrer"
					class="flex h-full min-w-0 items-center gap-1.5 pl-3 {editable ? 'pr-1' : 'pr-3'}"
					title={`${attached.repo}#${attached.number}${item?.state ? ` · ${STATES[item.state]}` : ''}`}
					aria-label={`${kind === 'pull' ? 'Pull request' : 'Issue'} ${githubLabel(attached)}${item?.title ? `, ${item.title}` : ''}${item?.state ? `, ${STATES[item.state]}` : ''}`}
				>
					<GithubIcon {kind} state={item?.state} size={15} />
					{#if item?.title}<span class="truncate">{item.title}</span>{/if}
					<span class="shrink-0 text-muted">{item?.title ? `#${attached.number}` : githubLabel(attached)}</span>
				</a>
				{#if editable}
					<button
						type="button"
						class="hit-area relative grid h-full place-items-center pr-2.5 pl-1 text-faint hover:text-ink"
						aria-label={`Remove ${githubLabel(attached)}`}
						onclick={() => onchange(task.github.filter((r) => !sameGithubRef(r, attached)))}
					>
						<X size={12} weight="bold" />
					</button>
				{/if}
			</span>
		{/each}
		{#if editable}
			<Popover label="GitHub" bind:open>
				{#snippet trigger({ toggle })}
					<button type="button" class="chip" aria-label="Add a GitHub issue or pull request" onclick={toggle}>
						<GithubLogo size={15} class="shrink-0" />
						{#if !task.github.length}GitHub{/if}
					</button>
				{/snippet}
				{#snippet children({ close })}
					<form
						class="w-72 px-1 pt-0.5 pb-1"
						onsubmit={(event) => {
							event.preventDefault();
							attach(close);
						}}
					>
						<input
							data-autofocus=""
							class="field w-full"
							aria-label="GitHub issue or pull request link"
							placeholder="Paste an issue or pull request link"
							autocomplete="off"
							autocapitalize="off"
							spellcheck="false"
							bind:value={pasted}
						/>
						<p class="px-1 pt-1.5 text-[12px] text-muted" role="status">
							{#if ref}
								Enter attaches {githubLabel(ref)}
							{:else if pasted.trim()}
								Not an issue or pull request link
							{:else}
								A github.com link, or owner/repo#123
							{/if}
						</p>
					</form>
				{/snippet}
			</Popover>
		{/if}
	</div>
{/if}
