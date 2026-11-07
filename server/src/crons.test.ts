import { expect, test } from 'bun:test';
import { CRONS } from './crons';

test('wrangler.jsonc triggers exactly the crons the Worker runs', async () => {
	const wrangler = Bun.JSONC.parse(await Bun.file(new URL('../../wrangler.jsonc', import.meta.url)).text()) as {
		triggers: { crons: string[] };
	};
	expect(wrangler.triggers.crons.toSorted()).toEqual(
		Object.values(CRONS)
			.map(cron => cron.schedule)
			.toSorted(),
	);
});
