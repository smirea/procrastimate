<script lang="ts">
	import { fly, slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import ArrowSquareIn from 'phosphor-svelte/lib/ArrowSquareIn';
	import Warning from 'phosphor-svelte/lib/Warning';
	import type { ImportSummary } from 'shared/todoist.ts';
	import { toggleButton } from 'shared/quick-add-buttons.ts';
	import { BUTTON_INFO, WEB_BUTTONS } from '../quick-add-buttons.ts';
	import AiAccounts from './AiAccounts.svelte';
	import DictationSwitcher from './DictationSwitcher.svelte';
	import ThemeSwitcher from './ThemeSwitcher.svelte';
	import { push } from '../push.svelte.ts';
	import { session } from '../session.svelte.ts';
	import { store } from '../store.svelte.ts';
	import { sync } from '../sync.svelte.ts';
	import { motion } from '../ui.svelte.ts';
	import { readBackupZip } from '../todoist-import.ts';

	type Status =
		| { kind: 'idle' }
		| { kind: 'reading' }
		| { kind: 'done'; summary: ImportSummary }
		| { kind: 'failed'; message: string };

	let status = $state<Status>({ kind: 'idle' });
	let confirmingDelete = $state(false);
	let confirmingAccount = $state(false);
	let deletingAccount = $state(false);
	let input: HTMLInputElement;

	const notificationLine = $derived(
		push.line === 'needs-permission' ? 'Notifications need permission' : `Notifications: ${push.line === 'on' ? 'On' : 'Off'}`,
	);

	function deleteAll() {
		store.deleteAll();
		void sync.syncNow();
		confirmingDelete = false;
	}

	async function deleteAccount() {
		deletingAccount = true;
		if (!(await session.deleteAccount())) deletingAccount = false;
	}

	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

	async function onchange() {
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		status = { kind: 'reading' };
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

	<section class="flex flex-col gap-2">
		<h3 class="heading">Dictation</h3>
		<DictationSwitcher />
	</section>

	<section class="flex flex-col gap-2">
		<h3 class="heading">Quick add buttons</h3>
		<div class="flex flex-wrap gap-1.5" role="group" aria-label="Quick add buttons">
			{#each WEB_BUTTONS as button (button)}
				{@const { name, icon: Icon } = BUTTON_INFO[button]}
				{@const shown = store.quickAddButtons.includes(button)}
				<button
					type="button"
					class="chip h-8 px-2.5 touch:h-11"
					data-active={shown}
					aria-pressed={shown}
					onclick={() => store.setQuickAddButtons(toggleButton(store.quickAddButtons, button))}
				>
					<Icon size={14} weight={shown ? 'fill' : 'regular'} class={shown ? 'text-accent' : ''} />
					{name}
				</button>
			{/each}
		</div>
		<p class="px-1.5 text-[12px] text-muted">The rest stay in quick add's + menu.</p>
	</section>

	{#if push.line === 'needs-permission'}
		<button type="button" class="menu-item -mx-1.5 w-auto touch:h-11 touch:text-[15px]" onclick={() => push.request()}>
			{notificationLine}
		</button>
	{:else}
		<p class="px-1.5 text-[13px] text-ink">{notificationLine}</p>
	{/if}

	<AiAccounts />

	<section class="flex flex-col gap-1.5">
		<h3 class="heading">Data</h3>
		<button type="button" class="menu-item -mx-1.5 w-auto touch:h-11 touch:text-[15px]" onclick={() => input.click()}>
			<ArrowSquareIn size={18} class="text-muted" />
			Import from Todoist
		</button>
		<input bind:this={input} type="file" accept=".zip,application/zip" class="sr-only" tabindex="-1" aria-label="Todoist backup file" {onchange} />

		{#if status.kind === 'reading'}
			<p role="status" class="px-1.5 text-[13px] text-muted" in:fly={motion({ y: 6, duration: 220, easing: cubicOut })}>Importing…</p>
		{:else if status.kind === 'done'}
			{@const { summary } = status}
			{#key summary}
				<div role="status" aria-label="Import summary" class="flex flex-col gap-2" in:fly={motion({ y: 6, duration: 220, easing: cubicOut })}>
					<div class="grid grid-cols-3 gap-1.5">
						{#each [plural(summary.projects, 'project'), plural(summary.tasks, 'task'), `${summary.skipped} skipped`] as stat (stat)}
							{@const [count, ...words] = stat.split(' ')}
							<p class="stat"><span class="text-[17px] font-semibold text-ink">{count}</span> <span>{words.join(' ')}</span></p>
						{/each}
					</div>
					{#if summary.sections || summary.labels}
						{@const added = [summary.sections && plural(summary.sections, 'section'), summary.labels && plural(summary.labels, 'label')]}
						<p class="text-[12px] text-muted">{added.filter(Boolean).join(' and ')} added</p>
					{/if}
					{#if summary.warnings.length}
						<div class="flex flex-col gap-1" transition:slide={motion({ duration: 200, easing: cubicOut })}>
							<p class="flex items-center gap-1.5 text-[12px] font-medium text-muted">
								<Warning size={14} />
								{plural(summary.warnings.length, 'warning')}
							</p>
							<ul class="max-h-36 space-y-1 overflow-y-auto overscroll-contain text-[12px] text-muted" aria-label="Import warnings">
								{#each summary.warnings as warning, i (i)}
									<li class="rounded-lg bg-ink/4 px-2 py-1">{warning}</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			{/key}
		{:else if status.kind === 'failed'}
			<p role="alert" class="text-[13px] text-[var(--tone-overdue)]" in:fly={motion({ y: 6, duration: 220, easing: cubicOut })}>{status.message}</p>
		{/if}

		{#if confirmingDelete}
			<p class="px-1.5 text-[13px] text-ink">Delete every task, project, and label on this device and the server?</p>
			<div class="flex gap-2">
				<button type="button" class="btn press bg-[var(--tone-overdue)] text-on-accent" onclick={deleteAll}>Delete all data</button>
				<button type="button" class="btn press" onclick={() => (confirmingDelete = false)}>Cancel</button>
			</div>
		{:else}
			<button type="button" class="menu-item -mx-1.5 w-auto text-[var(--tone-overdue)] touch:h-11 touch:text-[15px]" onclick={() => (confirmingDelete = true)}>
				Delete all data
			</button>
		{/if}
	</section>

	<section class="flex flex-col gap-1.5">
		<h3 class="heading">Account</h3>
		<button type="button" class="menu-item -mx-1.5 w-auto touch:h-11 touch:text-[15px]" onclick={() => session.signOut()}>
			Sign out
		</button>
		{#if confirmingAccount}
			<p class="px-1.5 text-[13px] text-ink">Delete this account and every task, project, and label?</p>
			<div class="flex gap-2">
				<button type="button" class="btn press bg-[var(--tone-overdue)] text-on-accent" disabled={deletingAccount} onclick={deleteAccount}>
					{deletingAccount ? 'Deleting…' : 'Delete account'}
				</button>
				<button type="button" class="btn press" disabled={deletingAccount} onclick={() => (confirmingAccount = false)}>Cancel</button>
			</div>
		{:else}
			<button type="button" class="menu-item -mx-1.5 w-auto text-[var(--tone-overdue)] touch:h-11 touch:text-[15px]" onclick={() => (confirmingAccount = true)}>
				Delete account
			</button>
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
