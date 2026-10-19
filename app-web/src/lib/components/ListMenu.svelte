<script lang="ts">
	import type { Snippet } from 'svelte';
	import ArrowDown from 'phosphor-svelte/lib/ArrowDown';
	import ArrowUp from 'phosphor-svelte/lib/ArrowUp';
	import BookmarkSimple from 'phosphor-svelte/lib/BookmarkSimple';
	import Check from 'phosphor-svelte/lib/Check';
	import CheckCircle from 'phosphor-svelte/lib/CheckCircle';
	import Copy from 'phosphor-svelte/lib/Copy';
	import DotsThree from 'phosphor-svelte/lib/DotsThree';
	import PencilSimple from 'phosphor-svelte/lib/PencilSimple';
	import RowsPlusBottom from 'phosphor-svelte/lib/RowsPlusBottom';
	import ShareNetwork from 'phosphor-svelte/lib/ShareNetwork';
	import Trash from 'phosphor-svelte/lib/Trash';
	import type { HeaderItem, ListHeader } from 'shared/list-header.ts';
	import type { MarkdownDocument } from 'shared/markdown.ts';
	import { LABEL_COLORS, type LabelColor } from 'shared/label-colors.ts';
	import Popover from './Popover.svelte';
	import { completed, type ShownList } from '../completed.svelte.ts';
	import { copyMarkdown } from '../copy.ts';
	import { labelColorName, labelStyle } from '../label-colors.ts';
	import { PROJECT_ICONS, type ProjectIcon } from 'shared/project-icons.ts';
	import { projectIconGlyph, projectIconName } from '../project-icon.ts';

	/**
	 * A list's `…` menu, laid out by `header`: the entries every list shares, a separator, then the list's own. Each
	 * entry needs its handler; the web has none for `edit-place`, since places are edited on iPhone.
	 */
	let {
		header,
		label,
		markdown,
		share,
		showCompleted,
		sort,
		addSection,
		rename,
		color,
		icon,
		savePlace,
		remove,
	}: {
		header: ListHeader;
		/** The trigger's and the menu's name, such as `Project actions`. */
		label: string;
		markdown: () => MarkdownDocument;
		share?: () => void;
		showCompleted?: ShownList;
		sort?: { newestFirst: boolean; flip: () => void };
		addSection?: () => void;
		rename?: () => void;
		color?: { value: LabelColor; set: (color: LabelColor) => void; label: string };
		icon?: { value: ProjectIcon | null; set: (icon: ProjectIcon | null) => void };
		/** The form that names the place, shown in the menu's place. */
		savePlace?: Snippet<[{ close: () => void }]>;
		remove?: { label: string; confirm: Snippet; run: () => void };
	} = $props();

	let mode = $state<'menu' | 'delete' | 'save-place'>('menu');
</script>

{#snippet item(entry: HeaderItem, close: () => void)}
	{#if entry === 'share' && share}
		<button type="button" class="menu-item" onclick={() => {
			close();
			share();
		}}><ShareNetwork size={15} />Share</button>
	{:else if entry === 'copy'}
		<button type="button" class="menu-item" onclick={() => {
			close();
			void copyMarkdown(markdown());
		}}><Copy size={15} />Copy as Markdown</button>
	{:else if entry === 'show-completed' && showCompleted}
		{@const shown = completed.shown(showCompleted)}
		<button type="button" role="menuitemcheckbox" aria-checked={shown} class="menu-item" onclick={() => completed.toggle(showCompleted)}>
			<CheckCircle size={15} weight={shown ? 'fill' : 'regular'} class={shown ? 'text-accent' : ''} />
			<span class="flex-1">Show completed</span>
			{#if shown}<Check size={14} weight="bold" class="text-accent" />{/if}
		</button>
	{:else if entry === 'sort' && sort}
		{#each [true, false] as newest (newest)}
			<button type="button" role="menuitemradio" aria-checked={sort.newestFirst === newest} class="menu-item" onclick={() => {
				if (sort.newestFirst !== newest) sort.flip();
			}}>
				{#if newest}<ArrowDown size={15} />{:else}<ArrowUp size={15} />{/if}
				<span class="flex-1">{newest ? 'Newest first' : 'Oldest first'}</span>
				{#if sort.newestFirst === newest}<Check size={14} weight="bold" class="text-accent" />{/if}
			</button>
		{/each}
	{:else if entry === 'add-section' && addSection}
		<button type="button" class="menu-item" onclick={() => {
			close();
			addSection();
		}}><RowsPlusBottom size={15} />Add section</button>
	{:else if entry === 'rename' && rename}
		<button type="button" class="menu-item" onclick={() => {
			close();
			rename();
		}}><PencilSimple size={15} />Rename</button>
	{:else if entry === 'color' && color}
		<div role="radiogroup" aria-label={color.label} class="grid w-max grid-cols-6 gap-0.5 p-1">
			{#each LABEL_COLORS as option (option)}
				{@const checked = color.value === option}
				<button
					type="button"
					role="radio"
					aria-checked={checked}
					aria-label={labelColorName(option)}
					class="swatch press"
					style={labelStyle(option)}
					onclick={() => color.set(option)}
				>
					<span class="grid size-6 place-items-center rounded-full bg-[var(--label-tone)] text-[var(--canvas)] touch:size-7">
						{#if checked}<Check size={13} weight="bold" />{/if}
					</span>
				</button>
			{/each}
		</div>
	{:else if entry === 'icon' && icon}
		<div role="radiogroup" aria-label="Project icon" class="grid w-max grid-cols-7 gap-0.5 p-1">
			{#each [null, ...PROJECT_ICONS] as option (option)}
				{@const Icon = projectIconGlyph(option)}
				{@const checked = icon.value === option}
				<button
					type="button"
					role="radio"
					aria-checked={checked}
					aria-label={option ? projectIconName(option) : 'No icon'}
					title={option ? projectIconName(option) : 'No icon'}
					class="glyph press"
					onclick={() => icon.set(option)}
				>
					<Icon size={18} weight={checked ? 'fill' : 'regular'} />
				</button>
			{/each}
		</div>
	{:else if entry === 'save-place' && savePlace}
		<button type="button" class="menu-item" onclick={() => (mode = 'save-place')}><BookmarkSimple size={15} />Save place</button>
	{:else if entry === 'delete' && remove}
		<button type="button" class="menu-item text-[var(--tone-overdue)]!" onclick={() => (mode = 'delete')}><Trash size={15} />{remove.label}</button>
	{/if}
{/snippet}

<Popover {label} align="end">
	{#snippet trigger({ toggle })}
		<button
			type="button"
			class="icon-btn touch:size-11"
			aria-label={label}
			onclick={() => {
				mode = 'menu';
				toggle();
			}}
		>
			<DotsThree size={20} weight="bold" />
		</button>
	{/snippet}
	{#snippet children({ close })}
		{#if mode === 'delete' && remove}
			<div class="w-60 p-1.5 text-[13px]">
				<p>{@render remove.confirm()}</p>
				<div class="mt-2 flex justify-end gap-1.5">
					<button type="button" class="btn btn-quiet" onclick={close}>Cancel</button>
					<button
						type="button"
						class="btn press bg-[var(--tone-overdue)] text-on-accent"
						onclick={() => {
							close();
							remove.run();
						}}>Delete</button
					>
				</div>
			</div>
		{:else if mode === 'save-place' && savePlace}
			{@render savePlace({ close })}
		{:else}
			<div class="min-w-52">
				{#each header.common as entry (entry)}{@render item(entry, close)}{/each}
				{#if header.specific.length}
					<div class="my-1 border-t border-ink/5" role="separator"></div>
					{#each header.specific as entry (entry)}{@render item(entry, close)}{/each}
				{/if}
			</div>
		{/if}
	{/snippet}
</Popover>

<style>
	.swatch {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 9999px;
	}

	.swatch[aria-checked='true'] {
		box-shadow: inset 0 0 0 2px var(--label-tone);
	}

	.glyph {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 9999px;
		color: var(--color-muted);
		transition: background-color 120ms, color 120ms;
	}

	.glyph:hover {
		background: color-mix(in srgb, var(--color-ink) 6%, transparent);
	}

	.glyph[aria-checked='true'] {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
	}

	@media (max-width: 767px), (pointer: coarse) {
		.swatch,
		.glyph {
			width: 2.75rem;
			height: 2.75rem;
		}
	}
</style>
