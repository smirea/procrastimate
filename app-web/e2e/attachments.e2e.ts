import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { type App, expect, goOffline, goOnline, test, unique } from './fixtures.ts';

async function png(page: Page, width: number, height: number) {
	const base64 = await page.evaluate(
		([w, h]) => {
			const canvas = document.createElement('canvas');
			canvas.width = w;
			canvas.height = h;
			const context = canvas.getContext('2d')!;
			context.fillStyle = '#3366cc';
			context.fillRect(0, 0, w, h);
			context.fillStyle = '#ffcc00';
			context.fillRect(w / 4, h / 4, w / 2, h / 2);
			return canvas.toDataURL('image/png').split(',')[1]!;
		},
		[width, height] as const,
	);
	return { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
}

async function openDetails(app: App, title: string) {
	await app
		.row(title)
		.getByRole('button', { name: new RegExp(`^${title}`) })
		.click();
	await expect(app.details()).toBeVisible();
}

const thumbnails = (app: App) => app.details().getByRole('button', { name: /^Open image/ });

test(
	'an image picked in details shows as a thumbnail and on the row, opens full screen, and deletes with undo',
	{ tag: '@webkit' },
	async ({ app, page }) => {
		const title = unique('Fix the fridge');
		await app.add(title);
		await openDetails(app, title);
		await app
			.details()
			.locator('input[type="file"]')
			.setInputFiles(await png(page, 3000, 2000));
		await expect(thumbnails(app)).toHaveCount(1);
		await expect(thumbnails(app).first().locator('img')).toHaveAttribute('src', /^blob:/);
		await expect(app.row(title).getByRole('img', { name: '1 image' })).toBeVisible();

		const id = await app.taskId(title);
		const stored = await page.evaluate(id => window.procrastimate.entity('task', id)?.attachments, id);
		expect(stored).toEqual([{ id: expect.any(String), width: 2048, height: 1365 }]);

		await thumbnails(app).first().click();
		const viewer = page.getByRole('dialog', { name: 'Image' });
		await expect(viewer.getByRole('img', { name: `Image 1 of ${title}` })).toHaveAttribute('width', '2048');
		const downloading = page.waitForEvent('download');
		await viewer.getByRole('link', { name: 'Download image' }).click();
		const download = await downloading;
		expect(download.suggestedFilename()).toMatch(new RegExp(`^${title}\\.(jpg|webp)$`));
		expect((await readFile((await download.path())!)).byteLength).toBeGreaterThan(1000);
		await page.keyboard.press('Escape');
		await expect(viewer).toBeHidden();
		await expect(app.details()).toBeVisible();

		await thumbnails(app).first().click();
		await viewer.getByRole('button', { name: 'Delete image' }).click();
		await expect(viewer).toBeHidden();
		await expect(thumbnails(app)).toHaveCount(0);
		await expect(app.row(title).getByRole('img', { name: /image/ })).toHaveCount(0);
		await page.getByRole('button', { name: 'Undo' }).click();
		await expect(thumbnails(app)).toHaveCount(1);

		await app.reload();
		await openDetails(app, title);
		await expect(thumbnails(app).first().locator('img')).toHaveAttribute('src', /^blob:/);
	},
);

test(
	'an image added offline uploads when the network returns and shows on the other device',
	{ tag: '@webkit' },
	async ({ devices }) => {
		const a = await devices.open();
		const b = await devices.open();
		const title = unique('Broken hinge');
		await a.app.add(title);
		await expect(b.app.row(title)).toBeVisible({ timeout: 10_000 });

		await goOffline(a.context);
		await openDetails(a.app, title);
		await a.app
			.details()
			.locator('input[type="file"]')
			.setInputFiles(await png(a.page, 1200, 900));
		await expect(thumbnails(a.app)).toHaveCount(1);
		await expect.poll(() => a.app.pending()).toBeGreaterThan(0);
		await expect(b.app.row(title).getByRole('img', { name: '1 image' })).toHaveCount(0);

		await goOnline(a.context);
		await expect(b.app.row(title).getByRole('img', { name: '1 image' })).toBeVisible({ timeout: 15_000 });
		await openDetails(b.app, title);
		await expect(thumbnails(b.app).first().locator('img')).toHaveAttribute('src', /^blob:/, { timeout: 10_000 });
		const size = await thumbnails(b.app)
			.first()
			.locator('img')
			.evaluate(
				img =>
					new Promise<number>(resolve =>
						(img as HTMLImageElement).decode().then(() => resolve((img as HTMLImageElement).naturalWidth)),
					),
			);
		expect(size).toBe(320);
	},
);

test('a quick add draft with images and no title saves named for them', async ({ app, page }) => {
	const pick = async (count: number) => {
		await app.quickAdd().getByRole('button', { name: 'More quick add actions' }).click();
		const chooser = page.waitForEvent('filechooser');
		await page.getByRole('menuitem', { name: 'Attachments' }).click();
		await (await chooser).setFiles(await Promise.all(Array.from({ length: count }, () => png(page, 400, 300))));
		await expect(app.quickAdd().getByRole('list', { name: 'Attachments to add' }).locator('img')).toHaveCount(count);
	};
	const add = app.quickAdd().getByRole('button', { name: 'Add task', exact: true });
	await app.openQuickAdd();
	await expect(add).toBeDisabled();
	await pick(1);
	await expect(add).toBeEnabled();
	await add.click();
	await expect(app.taskInput()).toHaveValue('');
	await expect(add).toBeDisabled();

	await pick(2);
	await app.save();
	await app.showAdded();
	await expect(app.row('Photo').getByRole('img', { name: '1 image' })).toBeVisible();
	await expect(app.row('2 photos').getByRole('img', { name: '2 images' })).toBeVisible();
});

test('images pasted or picked in quick add attach to the new task, and pasting or dropping into details adds more', async ({
	app,
	page,
}) => {
	const title = unique('Paint swatches');
	await app.openQuickAdd();
	await app.taskInput().pressSequentially(title);
	const base64 = (await png(page, 400, 300)).buffer.toString('base64');
	await app.taskInput().evaluate((input, data) => {
		const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
		const transfer = new DataTransfer();
		transfer.items.add(new File([bytes], 'shot.png', { type: 'image/png' }));
		input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
	}, base64);
	await app.quickAdd().getByRole('button', { name: 'More quick add actions' }).click();
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('menuitem', { name: 'Attachments' }).click();
	await (await chooser).setFiles([await png(page, 3000, 2000), await png(page, 600, 600)]);
	const drafted = app.quickAdd().getByRole('list', { name: 'Attachments to add' }).locator('img');
	await expect(drafted).toHaveCount(3);
	await expect(app.taskInput()).toHaveValue(title);
	await expect(app.quickAdd().getByRole('button', { name: 'Add attachment, 3 added' })).toBeVisible();
	await app.quickAdd().getByRole('button', { name: 'Remove attachment 3' }).click();
	await expect(drafted).toHaveCount(2);

	await app.save();
	await app.showAdded();
	await expect(app.row(title).getByRole('img', { name: '2 images' })).toBeVisible();
	const id = await app.taskId(title);
	const stored = await page.evaluate(id => window.procrastimate.entity('task', id)?.attachments, id);
	expect(stored).toEqual([
		{ id: expect.any(String), width: 400, height: 300 },
		{ id: expect.any(String), width: 2048, height: 1365 },
	]);
	await openDetails(app, title);
	await expect(thumbnails(app)).toHaveCount(2);

	const send = (kind: 'paste' | 'drop') =>
		app.details().evaluate(
			(details, [data, type]) => {
				const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
				const transfer = new DataTransfer();
				transfer.items.add(new File([bytes], 'shot.png', { type: 'image/png' }));
				const target = details.querySelector('textarea')!;
				if (type === 'paste') {
					target.dispatchEvent(
						new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
					);
				} else {
					target.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }));
					target.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
				}
			},
			[base64, kind] as const,
		);
	await send('paste');
	await expect(thumbnails(app)).toHaveCount(3);
	await send('drop');
	await expect(thumbnails(app)).toHaveCount(4);
	await expect(app.details().getByRole('textbox', { name: 'Notes' })).toHaveValue('');
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 393, height: 852 } });

	test("quick add's + menu opens the camera, and the shot attaches to the new task", async ({ app, page }) => {
		const title = unique('Whiteboard');
		await app.openQuickAdd();
		await app.taskInput().pressSequentially(title);
		await app.quickAdd().getByRole('button', { name: 'More quick add actions' }).click();
		const chooser = page.waitForEvent('filechooser');
		await page.getByRole('menuitem', { name: 'Camera' }).click();
		const camera = await chooser;
		expect(await camera.element().getAttribute('capture')).toBe('environment');
		await camera.setFiles(await png(page, 800, 600));
		await expect(app.quickAdd().getByRole('list', { name: 'Attachments to add' }).locator('img')).toHaveCount(1);

		await app.save();
		await app.showAdded();
		await expect(app.row(title).getByRole('img', { name: '1 image' })).toBeVisible();
	});
});

test("quick add's + menu has no Camera on a desktop, whose browser would ignore capture", async ({ app, page }) => {
	await app.openQuickAdd();
	await app.quickAdd().getByRole('button', { name: 'More quick add actions' }).click();
	await expect(page.getByRole('menuitem', { name: 'Attachments' })).toBeVisible();
	await expect(page.getByRole('menuitem', { name: 'Camera' })).toBeHidden();
});

const file = (name: string, mimeType: string, bytes: number) => ({
	name,
	mimeType,
	buffer: Buffer.from(Array.from({ length: bytes }, (_, i) => (i * 31) % 251)),
});

test(
	'files attach with their icon, name, and size, open or download on another device whole from their parts, and delete with undo',
	{ tag: '@webkit' },
	async ({ devices }) => {
		const a = await devices.open();
		const b = await devices.open();
		const title = unique('Sign the lease');
		await a.app.add(title);
		await openDetails(a.app, title);
		const minutes = file('Minutes.txt', 'text/plain', 3_200_000);
		const lease = file('Lease.pdf', 'application/pdf', 2_000);
		const archive = file('photos.zip', 'application/zip', 2_000);
		await a.app.details().locator('input[type="file"]').setInputFiles([minutes, lease, archive]);
		const minutesTile = a.app.details().getByRole('button', { name: 'Open Minutes.txt, 3.2 MB' });
		await expect(minutesTile.locator('[data-kind="text"]')).toBeVisible();
		await expect(
			a.app.details().getByRole('button', { name: 'Open Lease.pdf, 2 KB' }).locator('[data-kind="pdf"]'),
		).toBeVisible();
		await expect(
			a.app.details().getByRole('button', { name: 'Open photos.zip, 2 KB' }).locator('[data-kind="archive"]'),
		).toBeVisible();
		await expect(a.app.row(title).getByRole('img', { name: '3 attachments' })).toBeVisible();
		const id = await a.app.taskId(title);
		const stored = await a.page.evaluate(id => window.procrastimate.entity('task', id)?.attachments, id);
		expect(stored).toEqual([
			{ id: expect.any(String), name: 'Minutes.txt', type: 'text/plain', bytes: 3_200_000 },
			{ id: expect.any(String), name: 'Lease.pdf', type: 'application/pdf', bytes: 2_000 },
			{ id: expect.any(String), name: 'photos.zip', type: 'application/zip', bytes: 2_000 },
		]);

		await expect(b.app.row(title).getByRole('img', { name: '3 attachments' })).toBeVisible({ timeout: 15_000 });
		await openDetails(b.app, title);
		const popup = b.page.waitForEvent('popup');
		await b.app.details().getByRole('button', { name: 'Open Minutes.txt, 3.2 MB' }).click();
		const tab = await popup;
		await expect.poll(() => tab.url()).toMatch(/^blob:/);
		const opened = await tab.evaluate(async () => {
			const blob = await (await fetch(location.href)).blob();
			return { size: blob.size, type: blob.type };
		});
		expect(opened).toEqual({ size: 3_200_000, type: expect.stringMatching(/^text\/plain/) });
		await tab.close();

		const download = b.page.waitForEvent('download');
		await b.app.details().getByRole('button', { name: 'Open photos.zip, 2 KB' }).click();
		const saved = await download;
		expect(saved.suggestedFilename()).toBe('photos.zip');
		expect((await readFile((await saved.path())!)).equals(archive.buffer)).toBe(true);

		await minutesTile.hover();
		await a.app.details().getByRole('button', { name: 'Delete Minutes.txt' }).click();
		await expect(minutesTile).toBeHidden();
		await expect(a.app.row(title).getByRole('img', { name: '2 attachments' })).toBeVisible();
		await a.page.getByRole('button', { name: 'Undo' }).click();
		await expect(minutesTile).toBeVisible();
	},
);

test('a file dropped into quick add with no title saves named for it', async ({ app }) => {
	await app.openQuickAdd();
	await app.taskInput().evaluate(input => {
		const transfer = new DataTransfer();
		transfer.items.add(new File(['milk, eggs'], 'groceries.txt', { type: 'text/plain' }));
		input.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }));
		input.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
	});
	await expect(
		app
			.quickAdd()
			.getByRole('list', { name: 'Attachments to add' })
			.getByRole('img', { name: 'Attachment 1 of 1, groceries.txt' }),
	).toBeVisible();
	await app.quickAdd().getByRole('button', { name: 'Add task', exact: true }).click();
	await app.showAdded();
	await expect(app.row('groceries.txt').getByRole('img', { name: '1 attachment' })).toBeVisible();
	await openDetails(app, 'groceries.txt');
	await expect(app.details().getByRole('button', { name: 'Open groceries.txt, 10 B' })).toBeVisible();
});
