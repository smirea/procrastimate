<script lang="ts">
	import { fly, slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import ArrowSquareIn from 'phosphor-svelte/lib/ArrowSquareIn';
	import Warning from 'phosphor-svelte/lib/Warning';
	import type { ImportSummary } from 'shared/todoist.ts';
	import ThemeSwitcher from './ThemeSwitcher.svelte';
	import { store } from '../store.svelte.ts';
	import { readBackupZip } from '../todoist-import.ts';

	type Status = { kind: 'idle' } | { kind: 'done'; summary: ImportSummary } | { kind: 'failed'; message: string };

	let status = $state<Status>({ kind: 'idle' });
	let input: HTMLInputElement;

	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

	async function onchange() {
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const backup = await readBackupZip(file, new Date());
			status =
				backup.projects.length === 0
					? { kind: 'failed', message: 'No Todoist projects in this file.' }
					: { kind: 'done', summary: store.importBackup(backup) };
		} catch {
			status = { kind: 'failed', message: 'This is not a Todoist backup zip.' };
		}
	}
</script>

<div class="flex flex-col gap-4 p-1.5 md:w-72">
	<section class="flex flex-col gap-2">
		<h3 class="heading">Theme</h3>
		<ThemeSwitcher />
	</section>

	<section class="flex flex-col gap-1.5">
		<h3 class="heading">Data</h3>
		<button type="button" class="menu-item -mx-1.5 w-auto touch:h-11 touch:text-[15px]" onclick={() => input.click()}>
			<ArrowSquareIn size={18} class="text-muted" />
			Import from Todoist
		</button>
		<input bind:this={input} type="file" accept=".zip,application/zip" class="sr-only" tabindex="-1" aria-label="Todoist backup file" {onchange} />

		{#if status.kind === 'done'}
			{@const { summary } = status}
			{#key summary}
				<div role="status" aria-label="Import summary" class="flex flex-col gap-2" in:fly={{ y: 6, duration: 220, easing: cubicOut }}>
					<div class="grid grid-cols-3 gap-1.5">
						{#each [plural(summary.projects, 'project'), plural(summary.tasks, 'task'), `${summary.skipped} skipped`] as stat (stat)}
							{@const [count, ...words] = stat.split(' ')}
							<p class="stat"><span class="text-[17px] font-semibold text-ink">{count}</span> <span>{words.join(' ')}</span></p>
						{/each}
					</div>
					{#if summary.labels}
						<p class="text-[12px] text-muted">{plural(summary.labels, 'label')} added</p>
					{/if}
					{#if summary.warnings.length}
						<div class="flex flex-col gap-1" transition:slide={{ duration: 200, easing: cubicOut }}>
							<p class="flex items-center gap-1.5 text-[12px] font-medium text-muted">
								<Warning size={14} />
								{plural(summary.warnings.length, 'warning')}
							</p>
							<ul class="max-h-36 space-y-1 overflow-y-auto overscroll-contain text-[12px] text-muted" aria-label="Import warnings">
								{#each summary.warnings as warning, i (i)}
									<li class="rounded-md bg-ink/4 px-2 py-1">{warning}</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			{/key}
		{:else if status.kind === 'failed'}
			<p role="alert" class="text-[13px] text-[var(--tone-overdue)]" in:fly={{ y: 6, duration: 220, easing: cubicOut }}>{status.message}</p>
		{/if}
	</section>
</div>

<style>
	.heading {
		font-size: 0.75rem;
		font-weight: 500;
		letter-spacing: 0.025em;
		text-transform: uppercase;
		color: var(--color-faint);
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.375rem 0.25rem;
		border-radius: 0.625rem;
		background: color-mix(in srgb, var(--color-ink) 5%, transparent);
		font-size: 0.75rem;
		color: var(--color-muted);
	}
</style>
