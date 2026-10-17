import { toMarkdown, type MarkdownDocument } from 'shared/markdown.ts';
import { store } from './store.svelte.ts';
import { toasts } from './ui.svelte.ts';

export async function copyMarkdown(document: MarkdownDocument): Promise<boolean> {
	const text = toMarkdown(document, store.tasks);
	try {
		await navigator.clipboard.writeText(text);
		toasts.show('Copied as Markdown');
		return true;
	} catch {
		toasts.show('Couldn’t copy');
		return false;
	}
}
