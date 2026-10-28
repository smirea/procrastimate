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
		const stored = await page.evaluate(id => window.procrastimate.entity('task', id)?.images, id);
		expect(stored).toEqual([{ id: expect.any(String), width: 2048, height: 1365 }]);

		await thumbnails(app).first().click();
		const viewer = page.getByRole('dialog', { name: 'Image' });
		await expect(viewer.getByRole('img', { name: `Image 1 of ${title}` })).toHaveAttribute('width', '2048');
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
		await page.getByRole('menuitem', { name: 'Images' }).click();
		await (await chooser).setFiles(await Promise.all(Array.from({ length: count }, () => png(page, 400, 300))));
		await expect(app.quickAdd().getByRole('list', { name: 'Images to attach' }).locator('img')).toHaveCount(count);
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
	await app.taskInput().press('Enter');
	await expect(app.taskInput()).toHaveValue('');
	await app.closeQuickAdd();
	await app.go('No date');
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
	await page.getByRole('menuitem', { name: 'Images' }).click();
	await (await chooser).setFiles([await png(page, 3000, 2000), await png(page, 600, 600)]);
	const drafted = app.quickAdd().getByRole('list', { name: 'Images to attach' }).locator('img');
	await expect(drafted).toHaveCount(3);
	await expect(app.taskInput()).toHaveValue(title);
	await expect(app.quickAdd().getByRole('button', { name: 'Add image, 3 added' })).toBeVisible();
	await app.quickAdd().getByRole('button', { name: 'Remove image 3' }).click();
	await expect(drafted).toHaveCount(2);

	await app.save();
	await app.showAdded();
	await expect(app.row(title).getByRole('img', { name: '2 images' })).toBeVisible();
	const id = await app.taskId(title);
	const stored = await page.evaluate(id => window.procrastimate.entity('task', id)?.images, id);
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
		await expect(app.quickAdd().getByRole('list', { name: 'Images to attach' }).locator('img')).toHaveCount(1);

		await app.save();
		await app.showAdded();
		await expect(app.row(title).getByRole('img', { name: '1 image' })).toBeVisible();
	});
});

test("quick add's + menu has no Camera on a desktop, whose browser would ignore capture", async ({ app, page }) => {
	await app.openQuickAdd();
	await app.quickAdd().getByRole('button', { name: 'More quick add actions' }).click();
	await expect(page.getByRole('menuitem', { name: 'Images' })).toBeVisible();
	await expect(page.getByRole('menuitem', { name: 'Camera' })).toBeHidden();
});
