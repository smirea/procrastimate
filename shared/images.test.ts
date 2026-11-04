import { expect } from 'bun:test';
import * as images from './images.ts';
import { describe, recorded, test } from './vectors/record.ts';

const fileKind = recorded('images', images.fileKind);
const filePartCount = recorded('images', images.filePartCount);

describe('fileKind', () => {
	test('the extension decides, whatever its case', () => {
		expect(fileKind({ name: 'Lease.PDF', type: '' })).toBe('pdf');
		expect(fileKind({ name: 'budget.xlsx', type: 'application/octet-stream' })).toBe('spreadsheet');
		expect(fileKind({ name: 'deck.key', type: '' })).toBe('presentation');
		expect(fileKind({ name: 'photos.tar.gz', type: '' })).toBe('archive');
		expect(fileKind({ name: 'main.swift', type: 'text/plain' })).toBe('code');
	});

	test('the type decides when the extension is unknown or missing', () => {
		expect(fileKind({ name: 'voice-memo', type: 'audio/mpeg' })).toBe('audio');
		expect(fileKind({ name: 'clip.bin', type: 'video/mp4' })).toBe('video');
		expect(fileKind({ name: 'notes', type: 'text/plain' })).toBe('text');
		expect(fileKind({ name: '.env', type: '' })).toBe('other');
		expect(fileKind({ name: 'mystery.xyz', type: 'application/octet-stream' })).toBe('other');
	});
});

describe('filePartCount', () => {
	test('one part per 1.5 MB, and at least one', () => {
		expect(filePartCount(1)).toBe(1);
		expect(filePartCount(1_500_000)).toBe(1);
		expect(filePartCount(1_500_001)).toBe(2);
		expect(filePartCount(25_000_000)).toBe(17);
	});
});

describe('parseByteKey', () => {
	test('an image size, or a file part under the most a file can have', () => {
		expect(images.parseByteKey('thumb')).toEqual({ key: 'thumb', part: null });
		expect(images.parseByteKey('part0')).toEqual({ key: 'part0', part: 0 });
		expect(images.parseByteKey('part16')).toEqual({ key: 'part16', part: 16 });
		expect(images.parseByteKey('part17')).toBeNull();
		expect(images.parseByteKey('part')).toBeNull();
		expect(images.parseByteKey(null)).toBeNull();
	});
});
