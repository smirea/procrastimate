<script lang="ts">
	import { tick } from 'svelte';
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Bell from 'phosphor-svelte/lib/Bell';
	import CalendarBlank from 'phosphor-svelte/lib/CalendarBlank';
	import Repeat from 'phosphor-svelte/lib/Repeat';
	import type { QuickAddToken } from 'shared/quick-add.ts';
	import { lastUsed, sigilFragment, suggest, type Named, type SigilFragment, type Suggestion } from 'shared/name-search.ts';
	import NameSuggestions from './NameSuggestions.svelte';
	import { store } from '../store.svelte.ts';
	import { NAME_SOURCES, type NameKind } from '../names.ts';
	import type { TimingSegment } from '../format.ts';

	let {
		value = $bindable(),
		tokens,
		timing = [],
		label,
		placeholder = '',
		autofocus = false,
		suggestProjects: projectSuggestions = true,
		enterkeyhint,
		class: className = '',
		onkeydown,
		onblur,
	}: {
		value: string;
		tokens: QuickAddToken[];
		/** Resolved timing shown above the input while it is focused and no suggestions are open. */
		timing?: TimingSegment[];
		label: string;
		placeholder?: string;
		autofocus?: boolean;
		suggestProjects?: boolean;
		enterkeyhint?: 'enter' | 'done' | 'send';
		class?: string;
		onkeydown?: (event: KeyboardEvent) => void;
		onblur?: () => void;
	} = $props();

	const GAP = 6;
	const MARGIN = 8;
	const uid = $props.id();

	let root: HTMLDivElement;
	let input: HTMLInputElement;
	let backdrop: HTMLDivElement;
	let overlay = $state<HTMLDivElement>();
	let placement = $state({ above: true, maxHeight: 0 });

	let focused = $state(false);
	let caret = $state(0);
	let active = $state(0);
	/** Arrow keys were used, so Enter picks even when the typed name already matches. */
	let navigated = $state(false);
	/** The sigil position the user dismissed with Escape. */
	let dismissed = $state<number | null>(null);

	type Segment = { text: string; kind: QuickAddToken['kind'] | null };

	const segments = $derived.by(() => {
		const out: Segment[] = [];
		let cursor = 0;
		for (const token of tokens) {
			if (token.start > cursor) out.push({ text: value.slice(cursor, token.start), kind: null });
			out.push({ text: value.slice(token.start, token.end), kind: token.kind });
			cursor = token.end;
		}
		out.push({ text: value.slice(cursor), kind: null });
		return out;
	});

	/** The `#` or `@` fragment closest before the caret. */
	const fragment = $derived.by(() => {
		if (!focused) return null;
		let closest: (SigilFragment & { kind: NameKind }) | null = null;
		for (const kind of ['project', 'label'] as const) {
			if (kind === 'project' && !projectSuggestions) continue;
			const found = sigilFragment(value, caret, NAME_SOURCES[kind].sigil, NAME_SOURCES[kind].items());
			if (found && (!closest || found.start > closest.start)) closest = { ...found, kind };
		}
		return closest;
	});
	const source = $derived(fragment && NAME_SOURCES[fragment.kind]);
	const suggestions = $derived(
		fragment && source && fragment.start !== dismissed
			? suggest(source.items(), lastUsed(store.tasks, source.idsOf), fragment.query)
			: [],
	);
	const named = $derived(
		!!fragment && !!source?.items().some((item) => item.name.toLowerCase() === fragment.query.trim().toLowerCase()),
	);

	const syncScroll = () => {
		if (backdrop) backdrop.scrollLeft = input.scrollLeft;
	};

	const syncCaret = () => {
		caret = input.selectionStart ?? value.length;
	};

	export function focus() {
		input.focus();
	}

	async function pick(suggestion: Suggestion<Named>) {
		if (!fragment || !source) return;
		const item = suggestion.kind === 'create' ? source.create(suggestion.name) : suggestion.item;
		const inserted = `${source.sigil}${item.name} `;
		const at = fragment.start + inserted.length;
		value = value.slice(0, fragment.start) + inserted + value.slice(fragment.end).trimStart();
		await tick();
		input.focus();
		input.setSelectionRange(at, at);
		caret = at;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (fragment && suggestions.length) {
			const count = suggestions.length;
			switch (event.key) {
				case 'ArrowDown':
				case 'ArrowUp':
					event.preventDefault();
					active = (active + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
					navigated = true;
					return;
				case 'Tab':
					event.preventDefault();
					void pick(suggestions[active]!);
					return;
				case 'Enter':
					if (navigated || !named) {
						event.preventDefault();
						void pick(suggestions[active]!);
						return;
					}
					break;
				case 'Escape':
					event.preventDefault();
					dismissed = fragment.start;
					return;
			}
		}
		onkeydown?.(event);
	}

	/** Prefers the space above the input, the only room on a phone with the keyboard open, and flips below when that is too short. */
	function place(node: HTMLDivElement) {
		const anchor = root.getBoundingClientRect();
		const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
		const above = anchor.top - GAP - MARGIN;
		const below = viewportHeight - anchor.bottom - GAP - MARGIN;
		const flip = node.scrollHeight > above && below > above;
		placement = { above: !flip, maxHeight: flip ? below : above };
	}

	$effect(() => {
		void fragment?.start;
		void fragment?.kind;
		void fragment?.query;
		active = 0;
		navigated = false;
	});

	$effect(() => {
		if (!fragment) dismissed = null;
	});

	$effect(() => {
		void suggestions.length;
		void timing;
		if (overlay) place(overlay);
	});

	$effect(() => {
		if (autofocus) input.focus();
	});

	$effect(() => {
		void value;
		requestAnimationFrame(syncScroll);
	});
</script>

<div bind:this={root} class="smart relative {className}">
	<div bind:this={backdrop} aria-hidden="true" class="smart-layer pointer-events-none absolute inset-0 overflow-hidden text-transparent">
		{#each segments as segment, i (i)}
			{#if segment.kind}
				<mark data-token={segment.kind} class="token token-{segment.kind}">{segment.text}</mark>
			{:else}{segment.text}{/if}
		{/each}
	</div>
	<input
		bind:this={input}
		bind:value
		aria-label={label}
		aria-autocomplete="list"
		aria-controls={suggestions.length ? `${uid}-names` : undefined}
		aria-activedescendant={suggestions.length ? `${uid}-names-${active}` : undefined}
		{placeholder}
		class="smart-layer relative w-full bg-transparent outline-none placeholder:text-faint"
		autocomplete="off"
		autocapitalize="sentences"
		{enterkeyhint}
		spellcheck="false"
		onscroll={syncScroll}
		oninput={() => {
			syncScroll();
			syncCaret();
		}}
		onkeyup={syncCaret}
		onclick={syncCaret}
		onfocus={() => {
			focused = true;
			syncCaret();
		}}
		onkeydown={handleKeydown}
		onblur={() => {
			focused = false;
			onblur?.();
		}}
	/>
	{#if fragment && source && suggestions.length}
		<div
			bind:this={overlay}
			class="glass-strong absolute left-0 z-20 w-[min(100%,20rem)] rounded-xl text-base font-normal"
			class:bottom-full={placement.above}
			class:top-full={!placement.above}
			style:margin-block={`${GAP}px`}
			style:max-height={placement.maxHeight ? `${placement.maxHeight}px` : undefined}
			style:transform-origin={placement.above ? 'bottom left' : 'top left'}
			transition:scale={{ start: 0.96, duration: 160, easing: cubicOut, opacity: 0 }}
		>
			<NameSuggestions id="{uid}-names" {source} {suggestions} query={fragment.query} {active} onpick={pick} />
		</div>
	{:else if focused && timing.length}
		<div
			bind:this={overlay}
			role="status"
			aria-label="Timing preview"
			class="glass-strong pointer-events-none absolute left-0 z-20 flex max-w-full flex-wrap items-center gap-x-3 gap-y-0.5 overflow-hidden rounded-xl px-2.5 py-1.5 text-[13px] leading-5 font-normal text-ink touch:text-[14px]"
			class:bottom-full={placement.above}
			class:top-full={!placement.above}
			style:margin-block={`${GAP}px`}
			style:max-height={placement.maxHeight ? `${placement.maxHeight}px` : undefined}
			style:transform-origin={placement.above ? 'bottom left' : 'top left'}
			transition:scale={{ start: 0.96, duration: 160, easing: cubicOut, opacity: 0 }}
		>
			{#each timing as segment, i (segment.kind + i)}
				{#if i > 0}<span class="sr-only">{' · '}</span>{/if}
				<span class="timing-{segment.kind} inline-flex items-center gap-1"
					>{#if segment.kind === 'due'}<CalendarBlank size={13} weight="fill" />{:else if segment.kind === 'recurrence'}<Repeat size={13} weight="bold" />{:else}<Bell size={13} weight="fill" />{/if}{segment.text}</span
				>
			{/each}
		</div>
	{/if}
</div>

<style>
	.smart-layer {
		white-space: pre;
		font: inherit;
		letter-spacing: inherit;
		padding: 0.125rem 0.25rem;
		line-height: 1.6;
		border: 0;
		margin: 0;
	}

	.token {
		color: transparent;
		border-radius: 0.3rem;
		box-shadow: 0 0 0 0.15rem var(--tint);
		background: var(--tint);
		animation: token-in 220ms var(--ease-spring);
	}

	.token-due {
		--tint: var(--token-due);
	}
	.token-priority {
		--tint: var(--token-priority);
	}
	.token-reminder {
		--tint: var(--token-reminder);
	}
	.token-project {
		--tint: var(--token-project);
	}
	.token-recurrence {
		--tint: var(--token-recurrence);
	}
	.token-label {
		--tint: var(--token-label);
	}

	.timing-due :global(svg) {
		color: var(--tone-today);
	}
	.timing-recurrence :global(svg) {
		color: var(--tone-tomorrow);
	}
	.timing-notify :global(svg),
	.timing-reminder :global(svg) {
		color: var(--tone-week);
	}

	@keyframes token-in {
		from {
			background: transparent;
			box-shadow: 0 0 0 0 transparent;
		}
	}
</style>
