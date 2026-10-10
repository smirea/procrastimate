<script lang="ts">
	import type { QuickAddToken } from 'shared/quick-add.ts';

	let {
		value = $bindable(),
		tokens,
		label,
		placeholder = '',
		autofocus = false,
		enterkeyhint,
		class: className = '',
		onkeydown,
		onblur,
	}: {
		value: string;
		tokens: QuickAddToken[];
		label: string;
		placeholder?: string;
		autofocus?: boolean;
		enterkeyhint?: 'enter' | 'done' | 'send';
		class?: string;
		onkeydown?: (event: KeyboardEvent) => void;
		onblur?: () => void;
	} = $props();

	let input: HTMLInputElement;
	let backdrop: HTMLDivElement;

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

	const syncScroll = () => {
		if (backdrop) backdrop.scrollLeft = input.scrollLeft;
	};

	export function focus() {
		input.focus();
	}

	$effect(() => {
		if (autofocus) input.focus();
	});

	$effect(() => {
		void value;
		requestAnimationFrame(syncScroll);
	});
</script>

<div class="smart relative {className}">
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
		{placeholder}
		class="smart-layer relative w-full bg-transparent outline-none placeholder:text-faint"
		autocomplete="off"
		autocapitalize="sentences"
		{enterkeyhint}
		spellcheck="false"
		onscroll={syncScroll}
		oninput={syncScroll}
		{onkeydown}
		{onblur}
	/>
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

	@keyframes token-in {
		from {
			background: transparent;
			box-shadow: 0 0 0 0 transparent;
		}
	}
</style>
