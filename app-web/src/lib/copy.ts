import { toMarkdown, type MarkdownDocument } from 'shared/markdown.ts';
import { store } from './store.svelte.ts';
import { clock, toasts } from './ui.svelte.ts';

export async function copyMarkdown(document: MarkdownDocument): Promise<boolean> {
	const text = toMarkdown(document, {
		tasks: store.tasks,
		projects: store.projects,
		labels: store.labels,
		today: clock.today,
	});
	try {
		await navigator.clipboard.writeText(text);
		toasts.show('Copied as Markdown');
		return true;
	} catch {
		toasts.show('Couldn’t copy');
		return false;
	}
}
