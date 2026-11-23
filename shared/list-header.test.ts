import { expect } from 'bun:test';
import * as header from './list-header.ts';
import { describe, recorded, test } from './vectors/record.ts';

const listHeader = recorded('list-header', header.listHeader);

describe('listHeader', () => {
	test('every menu leads with share, then copy, and projects and labels toggle completed beside it', () => {
		expect(listHeader({ kind: 'project', own: true })).toEqual({
			filters: true,
			showCompleted: true,
			common: ['share', 'copy'],
			specific: ['add-section', 'rename', 'icon', 'delete'],
		});
		expect(listHeader({ kind: 'label', own: true, place: false })).toEqual({
			filters: true,
			showCompleted: true,
			common: ['share', 'copy'],
			specific: ['rename', 'color', 'delete'],
		});
	});

	test('a shared project or label only copies, and still toggles completed', () => {
		expect(listHeader({ kind: 'project', own: false })).toEqual({
			filters: true,
			showCompleted: true,
			common: ['copy'],
			specific: [],
		});
		expect(listHeader({ kind: 'label', own: false, place: false })).toEqual({
			filters: true,
			showCompleted: true,
			common: ['copy'],
			specific: [],
		});
	});

	test('a saved place has no share and edits its spot', () => {
		expect(listHeader({ kind: 'label', own: true, place: true })).toEqual({
			filters: true,
			showCompleted: true,
			common: ['copy'],
			specific: ['rename', 'color', 'edit-place', 'delete'],
		});
	});

	test('an unsaved place offers to save it while its tasks name a spot', () => {
		expect(listHeader({ kind: 'place', saveable: true })).toEqual({
			filters: true,
			showCompleted: false,
			common: ['copy'],
			specific: ['save-place'],
		});
		expect(listHeader({ kind: 'place', saveable: false })).toEqual({
			filters: true,
			showCompleted: false,
			common: ['copy'],
			specific: [],
		});
	});

	test('Inbox, Tomorrow, This week, No date, and events copy; No date also sorts', () => {
		expect(listHeader({ kind: 'inbox' })).toEqual({
			filters: true,
			showCompleted: false,
			common: ['copy'],
			specific: [],
		});
		expect(listHeader({ kind: 'event' })).toEqual({
			filters: true,
			showCompleted: false,
			common: ['copy'],
			specific: [],
		});
		expect(listHeader({ kind: 'tomorrow' })).toEqual({
			filters: true,
			showCompleted: false,
			common: ['copy'],
			specific: [],
		});
		expect(listHeader({ kind: 'this-week' })).toEqual({
			filters: true,
			showCompleted: false,
			common: ['copy'],
			specific: [],
		});
		expect(listHeader({ kind: 'no-date' })).toEqual({
			filters: true,
			showCompleted: false,
			common: ['copy'],
			specific: ['sort'],
		});
	});

	test('Completed has no filters', () => {
		expect(listHeader({ kind: 'completed' })).toEqual({
			filters: false,
			showCompleted: false,
			common: ['copy'],
			specific: [],
		});
	});
});
