import { expect } from 'bun:test';
import * as sharing from './sharing.ts';
import type { Person } from './sharing.ts';
import { describe, recorded, test } from './vectors/record.ts';

const shareSuggestions = recorded('sharing', sharing.shareSuggestions);

const person = (id: string, name: string): Person => ({ id, name, kind: 'human', ownerId: null });
const robo: Person = { ...person('robo', 'Robo'), kind: 'ai', ownerId: 'me' };
const known = [person('me', 'Rosa'), robo, person('ann', 'Ann')];
const names = (people: Person[]) => people.map(p => p.name);

describe('shareSuggestions', () => {
	test('people the space has met match before the server answers, and never this user', () => {
		expect(names(shareSuggestions({ q: 'Ro', me: 'me', known, found: null, granted: [] }))).toEqual(['Robo']);
		expect(names(shareSuggestions({ q: 'ro', me: 'me', known, found: { q: 'r', people: [] }, granted: [] }))).toEqual([
			'Robo',
		]);
	});

	test('the server’s answer for the same query joins them once, and people with access already drop out', () => {
		const found = { q: 'Ro', people: [robo, person('ron', 'Ron')] };
		expect(names(shareSuggestions({ q: 'Ro', me: 'me', known, found, granted: [] }))).toEqual(['Robo', 'Ron']);
		expect(names(shareSuggestions({ q: 'Ro', me: 'me', known, found, granted: ['robo'] }))).toEqual(['Ron']);
		expect(shareSuggestions({ q: '', me: 'me', known, found, granted: [] })).toEqual([]);
	});
});
