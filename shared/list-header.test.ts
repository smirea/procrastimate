import { expect } from 'bun:test';
import * as header from './list-header.ts';
import { describe, recorded, test } from './vectors/record.ts';

const listHeader = recorded('list-header', header.listHeader);

describe('listHeader', () => {
	test('every menu leads with share, copy, and show completed, in that order', () => {
		expect(listHeader({ kind: 'project', own: true })).toEqual({
			filters: true,
			common: ['share', 'copy', 'show-completed'],
			specific: ['add-section', 'rename', 'icon', 'delete'],
		});
		expect(listHeader({ kind: 'label', own: true, place: false })).toEqual({
			filters: true,
			common: ['share', 'copy', 'show-completed'],
			specific: ['rename', 'color', 'delete'],
		});
	});

	test('a shared project or label only copies and shows completed', () => {
		expect(listHeader({ kind: 'project', own: false })).toEqual({
			filters: true,
			common: ['copy', 'show-completed'],
			specific: [],
		});
		expect(listHeader({ kind: 'label', own: false, place: false })).toEqual({
			filters: true,
			common: ['copy', 'show-completed'],
			specific: [],
		});
	});

	test('a saved place has no share and edits its spot', () => {
		expect(listHeader({ kind: 'label', own: true, place: true })).toEqual({
			filters: true,
			common: ['copy', 'show-completed'],
			specific: ['rename', 'color', 'edit-place', 'delete'],
		});
	});

	test('an unsaved place offers to save it while its tasks name a spot', () => {
		expect(listHeader({ kind: 'place', saveable: true })).toEqual({
			filters: true,
			common: ['copy'],
			specific: ['save-place'],
		});
		expect(listHeader({ kind: 'place', saveable: false })).toEqual({ filters: true, common: ['copy'], specific: [] });
	});

	test('Inbox, Tomorrow, This week, No date, and events copy; No date also sorts', () => {
		expect(listHeader({ kind: 'inbox' })).toEqual({ filters: true, common: ['copy'], specific: [] });
		expect(listHeader({ kind: 'event' })).toEqual({ filters: true, common: ['copy'], specific: [] });
		expect(listHeader({ kind: 'tomorrow' })).toEqual({ filters: true, common: ['copy'], specific: [] });
		expect(listHeader({ kind: 'this-week' })).toEqual({ filters: true, common: ['copy'], specific: [] });
		expect(listHeader({ kind: 'no-date' })).toEqual({ filters: true, common: ['copy'], specific: ['sort'] });
	});

	test('Completed has no filters', () => {
		expect(listHeader({ kind: 'completed' })).toEqual({ filters: false, common: ['copy'], specific: [] });
	});
});
