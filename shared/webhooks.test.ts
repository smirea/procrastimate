import { expect } from 'bun:test';
import * as webhooks from './webhooks.ts';
import type { Webhook } from './webhooks.ts';
import { describe, recorded, test } from './vectors/record.ts';

const watchedByWebhook = recorded('webhooks', webhooks.watchedByWebhook);

const hook = (projectIds: string[], disabledAt: number | null = null): Webhook => ({
	id: `h-${projectIds.join('-')}`,
	url: 'https://agent.example/hook',
	projectIds,
	createdBy: 'me',
	createdAt: 0,
	cursor: 0,
	deliveredAt: null,
	failingSince: null,
	lastError: null,
	disabledAt,
});

describe('watchedByWebhook', () => {
	test('a live hook watches the projects it names, or every project when it names none', () => {
		expect(watchedByWebhook([hook(['home'])], 'home')).toBe(true);
		expect(watchedByWebhook([hook(['home'])], 'work')).toBe(false);
		expect(watchedByWebhook([hook([])], 'work')).toBe(true);
	});

	test('a disabled hook watches nothing', () => {
		expect(watchedByWebhook([hook([], 5)], 'home')).toBe(false);
		expect(watchedByWebhook([], 'home')).toBe(false);
	});
});
