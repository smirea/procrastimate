import { expect } from 'bun:test';
import {
	DEFAULT_QUICK_ADD_BUTTONS,
	QUICK_ADD_BUTTONS,
	moveButton,
	rowButtons,
	toggleButton,
} from './quick-add-buttons.ts';
import { describe, recorded, test } from './vectors/record.ts';

const toggle = recorded('quick-add-buttons', toggleButton);
const row = recorded('quick-add-buttons', rowButtons);
const move = recorded('quick-add-buttons', moveButton);

const WEB = QUICK_ADD_BUTTONS.filter(button => button !== 'location' && button !== 'event');

describe('toggleButton', () => {
	test('pinning a button puts it last', () => {
		expect(toggle(['subtasks', 'date'], 'labels')).toEqual(['subtasks', 'date', 'labels']);
	});

	test('unpinning removes it', () => {
		expect(toggle(DEFAULT_QUICK_ADD_BUTTONS, 'reminders')).toEqual(['date', 'priority', 'subtasks']);
	});

	test('a stored list with repeats comes back clean, in its order', () => {
		expect(toggle(['subtasks', 'date', 'subtasks'], 'event')).toEqual(['subtasks', 'date', 'event']);
	});

	test('the last button can be unpinned, leaving only the + menu', () => {
		expect(toggle(['date'], 'date')).toEqual([]);
	});
});

describe('moveButton', () => {
	test('moves a button before another', () => {
		expect(move(['date', 'priority', 'reminders', 'subtasks'], 'subtasks', 'priority')).toEqual([
			'date',
			'subtasks',
			'priority',
			'reminders',
		]);
	});

	test('moves a button down', () => {
		expect(move(['date', 'priority', 'reminders'], 'date', 'reminders')).toEqual(['priority', 'date', 'reminders']);
	});

	test('no neighbor moves it to the end', () => {
		expect(move(['date', 'priority', 'reminders'], 'date', null)).toEqual(['priority', 'reminders', 'date']);
	});

	test('the web reorders around iOS-only buttons without moving them', () => {
		expect(move(['location', 'date', 'event', 'labels'], 'labels', 'date')).toEqual([
			'location',
			'labels',
			'date',
			'event',
		]);
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

	test('pinned buttons keep their stored order', () => {
		expect(row(['subtasks', 'date', 'priority'], [], QUICK_ADD_BUTTONS)).toEqual(['subtasks', 'date', 'priority']);
	});

	test('a hidden button with a value still shows, after the pinned ones', () => {
		expect(row(['subtasks', 'date'], ['labels', 'priority', 'date'], WEB)).toEqual([
			'subtasks',
			'date',
			'priority',
			'labels',
		]);
	});

	test('every supported button, pinned first, for settings and the + menu', () => {
		expect(row(['labels', 'date'], WEB, WEB)).toEqual([
			'labels',
			'date',
			'priority',
			'reminders',
			'repeat',
			'subtasks',
			'images',
		]);
	});

	test('the web leaves out location and event, even when pinned', () => {
		expect(row(['date', 'location', 'event'], ['event'], WEB)).toEqual(['date']);
	});

	test('nothing pinned and nothing set shows no buttons', () => {
		expect(row([], [], QUICK_ADD_BUTTONS)).toEqual([]);
	});
});
