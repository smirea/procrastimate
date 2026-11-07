<script lang="ts">
	/**
	 * A field that commits at most once and lets Escape cancel. Chromium fires `blur` when a focused input is removed,
	 * and Svelte removes the node before it detaches the handler, so an input that commits on blur and unmounts on
	 * Escape would save what Escape meant to drop, and save twice on Enter. Focus starts a new edit, since a field shown
	 * again while it still animates out is the same one. Its Enter and Escape stop here, so the popover or sheet around
	 * it stays open.
	 */
	let {
		value = '',
		label,
		class: cls = '',
		placeholder,
		oncommit,
		onclose,
	}: {
		value?: string;
		label: string;
		class?: string;
		placeholder?: string;
		/** A trimmed, non-empty text that differs from `value`. */
		oncommit: (text: string) => void;
		onclose: () => void;
	} = $props();

	let settled = false;

	function finish(commit: boolean, text: string) {
		if (settled) return;
		settled = true;
		const trimmed = text.trim();
		if (commit && trimmed && trimmed !== value) oncommit(trimmed);
		onclose();
	}
</script>

<input
	{value}
	aria-label={label}
	class={cls}
	{placeholder}
	{@attach (node: HTMLInputElement) => node.focus()}
	onfocus={() => (settled = false)}
	onblur={(e) => finish(true, e.currentTarget.value)}
	onkeydown={(e) => {
		if (e.key !== 'Enter' && e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		finish(e.key === 'Enter', e.currentTarget.value);
	}}
/>
