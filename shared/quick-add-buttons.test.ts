import { expect } from 'bun:test';
import { DEFAULT_QUICK_ADD_BUTTONS, QUICK_ADD_BUTTONS, rowButtons, toggleButton } from './quick-add-buttons.ts';
import { describe, recorded, test } from './vectors/record.ts';

const toggle = recorded('quick-add-buttons', toggleButton);
const row = recorded('quick-add-buttons', rowButtons);

const WEB = QUICK_ADD_BUTTONS.filter(button => button !== 'location' && button !== 'event');

describe('toggleButton', () => {
	test('pinning a button puts it in row order', () => {
		expect(toggle(['date', 'subtasks'], 'labels')).toEqual(['date', 'labels', 'subtasks']);
	});

	test('unpinning removes it', () => {
		expect(toggle(DEFAULT_QUICK_ADD_BUTTONS, 'reminders')).toEqual(['date', 'priority', 'subtasks']);
	});

	test('a stored list out of order or with repeats comes back clean', () => {
		expect(toggle(['subtasks', 'date', 'date'], 'event')).toEqual(['date', 'subtasks', 'event']);
	});

	test('the last button can be unpinned, leaving only the + menu', () => {
		expect(toggle(['date'], 'date')).toEqual([]);
	});
});

describe('rowButtons', () => {
	test('the default row', () => {
		expect(row(DEFAULT_QUICK_ADD_BUTTONS, [], QUICK_ADD_BUTTONS)).toEqual([
			'date',
			'priority',
			'reminders',
			'subtasks',
		]);
	});

	test('a hidden button with a value still shows, in its place', () => {
		expect(row(['date', 'subtasks'], ['labels', 'priority'], WEB)).toEqual(['date', 'priority', 'labels', 'subtasks']);
	});

	test('the web leaves out location and event, even when pinned', () => {
		expect(row(['date', 'location', 'event'], ['event'], WEB)).toEqual(['date']);
	});

	test('nothing pinned and nothing set shows no buttons', () => {
		expect(row([], [], QUICK_ADD_BUTTONS)).toEqual([]);
	});
});
