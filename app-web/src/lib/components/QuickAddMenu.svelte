<script lang="ts">
	import Plus from 'phosphor-svelte/lib/Plus';
	import PushPin from 'phosphor-svelte/lib/PushPin';
	import { toggleButton } from 'shared/quick-add-buttons.ts';
	import Popover from './Popover.svelte';
	import { store } from '../store.svelte.ts';
	import { BUTTON_INFO, WEB_BUTTONS, type WebButton } from '../quick-add-buttons.ts';

	/** `values` spells out what each attribute is set to, so a hidden one still reads in the list. */
	let { values, onrun }: { values: Partial<Record<WebButton, string>>; onrun: (button: WebButton) => void } = $props();
</script>

<Popover label="Quick add actions" align="end">
	{#snippet trigger({ open, toggle })}
		<button
			type="button"
			class="chip px-2.5"
			data-active={open}
			aria-label="More quick add actions"
			aria-expanded={open}
			onmousedown={(e) => e.preventDefault()}
			onclick={toggle}
		>
			<Plus size={16} weight="bold" class={['transition-transform duration-200', open && 'rotate-45']} />
		</button>
	{/snippet}
	{#snippet children({ close })}
		<div class="w-64" role="menu" aria-label="Quick add actions">
			{#each WEB_BUTTONS as button (button)}
				{@const { name, icon: Icon } = BUTTON_INFO[button]}
				{@const pinned = store.quickAddButtons.includes(button)}
				<div class="flex items-center">
					<button
						type="button"
						role="menuitem"
						class="menu-item min-w-0 flex-1"
						onmousedown={(e) => e.preventDefault()}
						onclick={() => {
							close();
							onrun(button);
						}}
					>
						<Icon size={15} weight={values[button] ? 'fill' : 'regular'} />
						<span class="flex-1 truncate">{name}</span>
						{#if values[button]}<span class="max-w-28 truncate text-[12px] text-muted">{values[button]}</span>{/if}
					</button>
					<button
						type="button"
						class={['icon-btn hit-area size-8 shrink-0 touch:size-11', pinned ? 'text-accent' : 'text-faint']}
						aria-label={`Show ${name} in the row`}
						aria-pressed={pinned}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => store.setQuickAddButtons(toggleButton(store.quickAddButtons, button))}
					>
						<PushPin size={14} weight={pinned ? 'fill' : 'regular'} />
					</button>
				</div>
			{/each}
			<p class="px-2 pt-1.5 pb-1 text-[11px] text-faint">Pinned actions show in the row on every device.</p>
		</div>
	{/snippet}
</Popover>
