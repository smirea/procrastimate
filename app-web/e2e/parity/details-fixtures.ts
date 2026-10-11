import { expect, type PhoneApp } from './fixtures.ts';

/** Task details handles shared by the details, subtasks, and recurring pairs, named like `DetailsHelpers.swift`. */
export const details = (app: PhoneApp) => app.details();
export const titleInput = (app: PhoneApp) => app.details().getByRole('textbox', { name: 'Title' });
export const chip = (app: PhoneApp, name: string | RegExp) => app.details().getByRole('button', { name, exact: true });
export const menu = (app: PhoneApp, name: string) => app.page.getByRole('dialog', { name });
export const subtaskInput = (app: PhoneApp) => app.details().getByRole('textbox', { name: 'Add subtask' });
export const subtaskCheckbox = (app: PhoneApp, title: string) =>
	app.details().getByRole('checkbox', { name: `Complete ${title}` });
export const subtask = (app: PhoneApp, title: string) => app.details().locator(`[data-subtask="${title}"]`);
export const subtaskRows = (app: PhoneApp) =>
	app
		.details()
		.getByRole('list', { name: /^Subtasks of / })
		.getByRole('listitem');

export async function openDetails(app: PhoneApp, title: string) {
	await app
		.row(title)
		.getByRole('button', { name: new RegExp(title) })
		.tap();
	await expect(titleInput(app)).toHaveValue(title);
}

export async function closeDetails(app: PhoneApp) {
	await app.details().getByRole('button', { name: 'Close' }).tap();
	await expect(app.details()).toBeHidden();
}

/** Replaces the title and presses return, which applies it. */
export async function retitle(app: PhoneApp, title: string) {
	await titleInput(app).fill(title);
	await titleInput(app).press('Enter');
}

export async function addSubtasks(app: PhoneApp, ...titles: string[]) {
	for (const title of titles) {
		await subtaskInput(app).fill(title);
		await subtaskInput(app).press('Enter');
		await expect(subtaskInput(app)).toHaveValue('');
	}
}

/** Adds a parent through quick add, then its subtasks in its details. */
export async function addWithSubtasks(app: PhoneApp, parent: string, ...titles: string[]) {
	await app.add(parent);
	await openDetails(app, parent);
	await addSubtasks(app, ...titles);
}
