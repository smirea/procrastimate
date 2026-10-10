<script lang="ts">
	import { goto } from '$app/navigation';
	import { fade, fly, scale } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { cubicOut } from 'svelte/easing';
	import MagnifyingGlass from 'phosphor-svelte/lib/MagnifyingGlass';
	import Hash from 'phosphor-svelte/lib/Hash';
	import Tray from 'phosphor-svelte/lib/Tray';
	import Tag from 'phosphor-svelte/lib/Tag';
	import Check from 'phosphor-svelte/lib/Check';
	import X from 'phosphor-svelte/lib/X';
	import CalendarBlank from 'phosphor-svelte/lib/CalendarBlank';
	import ArrowElbowDownRight from 'phosphor-svelte/lib/ArrowElbowDownRight';
	import { excerpt, search, type NameHit, type TaskHit } from 'shared/search.ts';
	import { toDateKey, type Label, type Project } from 'shared/task.ts';
	import Highlighted from './Highlighted.svelte';
	import { store } from '../store.svelte.ts';
	import { clock, mobile, sheets, motion } from '../ui.svelte.ts';
	import { PRIORITIES, dueTone, formatDate, formatDue } from '../format.ts';

	/** Rendering is the cost that grows with matches, so each section shows only its best rows. */
	const LIMIT = { projects: 5, labels: 5, open: 30, completed: 15 };

	type Row = { key: string } & (
		| { kind: 'project'; hit: NameHit<Project> }
		| { kind: 'label'; hit: NameHit<Label> }
		| { kind: 'task'; hit: TaskHit }
	);

	const uid = $props.id();
	let query = $state('');
	let active = $state(0);
	let input: HTMLInputElement;
	let list = $state<HTMLDivElement>();

	const results = $derived(search(query, store.tasks, { projects: store.projects, labels: store.labels }));
	const sections = $derived(
		[
			{
				label: 'Projects',
				total: results.projects.length,
				rows: results.projects.slice(0, LIMIT.projects).map((hit): Row => ({ key: `p-${hit.item.id}`, kind: 'project', hit })),
			},
			{
				label: 'Labels',
				total: results.labels.length,
				rows: results.labels.slice(0, LIMIT.labels).map((hit): Row => ({ key: `l-${hit.item.id}`, kind: 'label', hit })),
			},
			{
				label: 'Tasks',
				total: results.open.length,
				rows: results.open.slice(0, LIMIT.open).map((hit): Row => ({ key: `t-${hit.task.id}`, kind: 'task', hit })),
			},
			{
				label: 'Completed',
				total: results.completed.length,
				rows: results.completed.slice(0, LIMIT.completed).map((hit): Row => ({ key: `t-${hit.task.id}`, kind: 'task', hit })),
			},
		].filter((section) => section.rows.length),
	);
	const rows = $derived(sections.flatMap((section) => section.rows));
	const index = $derived(new Map(rows.map((row, i) => [row.key, i])));
	const optionId = (row: Row) => `${uid}-${row.key}`;

	$effect(() => input.focus());

	$effect(() => {
		void query;
		active = 0;
	});

	$effect(() => {
		const row = rows[active];
		if (row) list?.querySelector(`#${CSS.escape(optionId(row))}`)?.scrollIntoView({ block: 'nearest' });
	});

	function open(row: Row | undefined) {
		if (!row) return;
		switch (row.kind) {
			case 'project':
				sheets.close();
				void goto(`/projects/${row.hit.item.id}`);
				return;
			case 'label':
				sheets.close();
				void goto(`/labels/${row.hit.item.id}`);
				return;
			case 'task':
				sheets.openTask(row.hit.task.id);
				return;
			default: {
				const never: never = row;
				return never;
			}
		}
	}

	function onkeydown(event: KeyboardEvent) {
		const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
		if (step && rows.length) {
			event.preventDefault();
			active = (active + step + rows.length) % rows.length;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			open(rows[active]);
		} else if (event.key === 'Escape' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) {
			event.preventDefault();
			sheets.close();
		}
	}

	const enter = (node: Element) =>
		mobile.current
			? fly(node, motion({ y: '100%', duration: 300, easing: cubicOut, opacity: 1 }))
			: scale(node, motion({ start: 0.96, duration: 200, easing: cubicOut, opacity: 0 }));

	const projectOf = (hit: TaskHit) => store.project(hit.task.projectId);
</script>

<div class="fixed inset-0 z-40 bg-scrim backdrop-blur-[2px]" transition:fade={motion({ duration: 160 })} onclick={() => sheets.close()} aria-hidden="true"></div>
<div
	role="dialog"
	aria-label="Search"
	class="glass-strong sheet fixed z-50 flex flex-col-reverse overflow-hidden md:top-[14vh] md:left-1/2 md:max-h-[min(560px,72vh)] md:w-[min(640px,calc(100vw-2rem))] md:-translate-x-1/2 md:flex-col md:rounded-panel"
	transition:enter
>
	<div class="flex shrink-0 items-center gap-2.5 px-4 py-3 touch:py-2">
		<MagnifyingGlass size={18} class="shrink-0 text-muted" />
		<input
			bind:this={input}
			bind:value={query}
			type="search"
			role="combobox"
			aria-label="Search"
			aria-expanded={rows.length > 0}
			aria-controls="{uid}-results"
			aria-autocomplete="list"
			aria-activedescendant={rows[active] ? optionId(rows[active]) : undefined}
			placeholder="Search tasks, notes, projects, and labels"
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			enterkeyhint="search"
			class="h-10 min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-faint touch:h-11"
			{onkeydown}
		/>
		{#if query}
			<button
				type="button"
				class="icon-btn hit-area size-7 bg-ink/10 touch:size-8"
				aria-label="Clear search"
				onmousedown={(e) => e.preventDefault()}
				onclick={() => {
					query = '';
					input.focus();
				}}
				transition:scale={motion({ start: 0.6, duration: 140, easing: cubicOut })}
			>
				<X size={12} weight="bold" />
			</button>
		{/if}
		<kbd class="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[11px] text-faint touch:hidden">Esc</kbd>
	</div>
	{#if query.trim()}
		<div
			bind:this={list}
			id="{uid}-results"
			role="listbox"
			tabindex="-1"
			aria-label="Search results"
			class="min-h-0 overflow-y-auto overscroll-contain border-ink/5 p-1.5 max-md:border-b md:border-t"
			ontouchmove={() => input.blur()}
		>
			{#each sections as section (section.label)}
				<div role="group" aria-labelledby="{uid}-{section.label}" class="pb-1">
					<div id="{uid}-{section.label}" class="flex items-center justify-between px-2.5 pt-2 pb-1 text-[12px] font-medium tracking-wide text-faint uppercase">
						{section.label}
						<span class="font-normal normal-case tabular-nums">{section.total}</span>
					</div>
					{#each section.rows as row (row.key)}
						{@const i = index.get(row.key)!}
						<!-- Arrow keys and Enter drive the options from the search field, which keeps focus. -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div
							id={optionId(row)}
							role="option"
							tabindex="-1"
							aria-selected={i === active}
							data-active={i === active}
							class="result flex w-full cursor-pointer items-start gap-3 rounded-2xl px-2.5 py-2 text-left touch:min-h-11 touch:py-2.5"
							animate:flip={motion({ duration: 180, easing: cubicOut })}
							in:fade={motion({ duration: 120 })}
							onmousedown={(e) => e.preventDefault()}
							onpointermove={(e) => e.pointerType === 'mouse' && (active = i)}
							onclick={() => open(row)}
						>
							{#if row.kind === 'project'}
								<Hash size={18} class="mt-px shrink-0 text-muted" />
								<span class="min-w-0 flex-1 truncate text-[14px] leading-5 touch:text-[15px]">
									<Highlighted highlight={row.hit.name} />
								</span>
							{:else if row.kind === 'label'}
								<Tag size={18} class="mt-px shrink-0 text-[var(--tone-label)]" />
								<span class="min-w-0 flex-1 truncate text-[14px] leading-5 touch:text-[15px]">
									<Highlighted highlight={row.hit.name} />
								</span>
							{:else}
								{@const task = row.hit.task}
								{@const project = projectOf(row.hit)}
								{@const notes = row.hit.matches.notes?.[0]}
								{@const done = task.completedAt !== null}
								{@const parent = task.parentId ? store.task(task.parentId) : undefined}
								<span
									class="status mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px]"
									class:done
									style={`--tone: ${PRIORITIES[task.priority].tone}`}
									aria-hidden="true"
								>
									{#if done}<Check size={10} weight="bold" />{/if}
								</span>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-[14px] leading-5 touch:text-[15px]" class:title-done={done}>
										<Highlighted highlight={row.hit.matches.title?.[0] ?? { text: task.title, ranges: [] }} />
									</span>
									{#if notes}
										<span class="block truncate text-[12px] leading-4 text-muted"><Highlighted highlight={excerpt(notes)} /></span>
									{/if}
									{#if parent}
										<span class="flex min-w-0 items-center gap-1 text-[12px] leading-4 text-muted" aria-label={`Subtask of ${parent.title}`}>
											<ArrowElbowDownRight size={12} class="shrink-0" /><span class="truncate">{parent.title}</span>
										</span>
									{/if}
									{#if row.hit.matches.labels}
										<span class="mt-0.5 flex flex-wrap gap-1">
											{#each row.hit.matches.labels as label (label.text)}
												<span class="label-chip"><Tag size={10} weight="fill" class="shrink-0 text-[var(--tone-label)]" /><Highlighted highlight={label} /></span>
											{/each}
										</span>
									{/if}
									{#if done}
										<span class="mt-0.5 block text-[12px] leading-4 text-muted">
											Completed {formatDate(toDateKey(new Date(task.completedAt!)), clock.today)}
										</span>
									{:else if task.due}
										<span
											class="mt-0.5 flex items-center gap-1 text-[12px] leading-4"
											style={`color: var(--tone-${dueTone(task.due, clock.today)})`}
										>
											<CalendarBlank size={12} />{formatDue(task.due, clock.today)}
										</span>
									{/if}
								</span>
								<span class="mt-0.5 flex max-w-[40%] shrink-0 items-center gap-1 text-[12px] leading-4 text-muted">
									{#if project}
										<Hash size={12} class="shrink-0" />
										<span class="truncate"><Highlighted highlight={row.hit.matches.project?.[0] ?? { text: project.name, ranges: [] }} /></span>
									{:else}
										<Tray size={12} class="shrink-0" />Inbox
									{/if}
								</span>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<p class="px-3 py-6 text-center text-[14px] text-muted" in:fade={motion({ duration: 120 })}>No results for “{query.trim()}”</p>
			{/each}
		</div>
	{/if}
</div>

<style>
	.result {
		transition:
			background 120ms var(--ease-spring),
			scale 220ms var(--ease-spring);
	}

	.result[data-active='true'] {
		background: color-mix(in srgb, var(--color-ink) 7%, transparent);
	}

	.result:active {
		background: color-mix(in srgb, var(--color-ink) 10%, transparent);
		scale: 0.98;
	}

	.status {
		border-color: var(--tone);
		background: color-mix(in srgb, var(--tone) 8%, transparent);
	}

	.status.done {
		border-color: var(--color-faint);
		background: var(--color-faint);
		color: var(--color-surface);
	}

	.title-done {
		color: var(--color-faint);
		text-decoration: line-through;
	}

	input::-webkit-search-cancel-button {
		display: none;
	}
</style>
