import { watchedByWebhook as watches, type Webhook } from 'shared/webhooks.ts';
import { api } from './api.ts';

const FRESH_MS = 60_000;

let hooks = $state<Webhook[]>([]);
let readAt = 0;

async function refresh() {
	readAt = Date.now();
	const list = await api.webhooks.list({ query: {} }).catch(() => null);
	if (list) hooks = list.webhooks;
	else readAt = 0;
}

/**
 * Whether a live webhook watches the user's own project, as the server last said. Webhooks live on the server only,
 * so this asks it once a minute while a project is on screen.
 */
export function watchedByWebhook(projectId: string): boolean {
	if (Date.now() - readAt > FRESH_MS) void refresh();
	return watches(hooks, projectId);
}
