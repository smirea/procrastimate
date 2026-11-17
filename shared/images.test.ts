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
	test('one part per 16 MiB, and at least one', () => {
		expect(filePartCount(1)).toBe(1);
		expect(filePartCount(16_777_216)).toBe(1);
		expect(filePartCount(16_777_217)).toBe(2);
		expect(filePartCount(2_000_000_000)).toBe(120);
	});
});

describe('previewType', () => {
	test('a file opens in a tab only as a type that cannot run script there', () => {
		expect(images.previewType({ name: 'lease.pdf', type: 'text/html' })).toBe('application/pdf');
		expect(images.previewType({ name: 'notes.txt', type: '' })).toBe('text/plain;charset=utf-8');
		expect(images.previewType({ name: 'clip.mp4', type: 'video/mp4' })).toBe('video/mp4');
		expect(images.previewType({ name: 'clip.mp4', type: 'text/html' })).toBeNull();
		expect(images.previewType({ name: 'logo.svg', type: 'image/svg+xml' })).toBeNull();
		expect(images.previewType({ name: 'page.html', type: 'text/html' })).toBeNull();
		expect(images.previewType({ name: 'archive.zip', type: 'application/zip' })).toBeNull();
	});
});
