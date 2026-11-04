import { z } from 'zod';
import type { LabelColor } from './label-colors.ts';

/**
 * Task attachments. A task lists `Attachment`s; the bytes of each live in the server's `images` table, fetched by id
 * from `IMAGES_PATH`: an image as one row per size, any other file as the parts it was split into. See
 * `docs/decisions/images.md`.
 */

export const IMAGES_PATH = '/api/images';

export const IMAGE_SIZES = ['full', 'thumb'] as const;
export const imageSizeSchema = z.enum(IMAGE_SIZES).meta({ id: 'ImageSize' });
export type ImageSize = z.infer<typeof imageSizeSchema>;

/** Safari's canvas cannot encode WebP and iOS has no WebP encoder, so both send JPEG. */
export const IMAGE_TYPES = ['image/webp', 'image/jpeg'] as const;
export const imageTypeSchema = z.enum(IMAGE_TYPES).meta({ id: 'ImageType' });
export type ImageType = z.infer<typeof imageTypeSchema>;

/**
 * What clients encode to and the server accepts. One row must fit every store: the Durable Object's SQLite caps a
 * row at 2 MB, and Turso's server refused a single 8 MB blob where 4 MB went through. `edge` is the longest side in
 * pixels.
 */
export const IMAGE_LIMITS = {
	full: { edge: 2048, bytes: 1_500_000 },
	thumb: { edge: 320, bytes: 200_000 },
} as const satisfies Record<ImageSize, { edge: number; bytes: number }>;

/** A file is stored in parts that each fit one row, under the same 2 MB cap images stay under. */
export const FILE_PART_BYTES = 1_500_000;
export const FILE_MAX_BYTES = 25_000_000;
export const FILE_MAX_PARTS = Math.ceil(FILE_MAX_BYTES / FILE_PART_BYTES);
/** The server stores and answers every file part as opaque bytes, so a page never renders an uploaded file as itself. */
export const FILE_PART_TYPE = 'application/octet-stream';

export const filePartCount = (bytes: number) => Math.max(1, Math.ceil(bytes / FILE_PART_BYTES));

/** One row of the bytes table: an image's size, or the `n`th part of a file. */
export type PartKey = `part${number}`;
export type ByteKey = ImageSize | PartKey;
export const partKey = (index: number): PartKey => `part${index}`;
const PART_KEY = /^part(\d{1,2})$/;
/** What a request's `size` names, before `parseByteKey` checks a part's number. */
export const byteKeySchema = z.string().regex(/^(full|thumb|part\d{1,2})$/);

/** The key a request names, or null for anything else. */
export function parseByteKey(
	value: string | null,
): { key: ImageSize; part: null } | { key: PartKey; part: number } | null {
	const size = imageSizeSchema.safeParse(value);
	if (size.success) return { key: size.data, part: null };
	const match = value?.match(PART_KEY);
	const part = match ? Number(match[1]) : NaN;
	return part < FILE_MAX_PARTS ? { key: partKey(part), part } : null;
}

/** The scaled size that fits `edge`, never upscaled. */
export function fitWithin(width: number, height: number, edge: number): { width: number; height: number } {
	const scale = Math.min(1, edge / Math.max(width, height));
	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The type the bytes really are, from their first bytes, or null for anything else. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
	const text = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
	if (bytes.length >= 12 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp';
	return null;
}

export const imageUrl = (space: string | null, id: string, key: ByteKey) => {
	const query = new URLSearchParams({ id, size: key });
	if (space) query.set('space', space);
	return `${IMAGES_PATH}?${query}`;
};

/** What a file is, for its icon. iOS mirrors this table in `Core/FileKind.swift`. */
export const FILE_KINDS = [
	'pdf',
	'document',
	'spreadsheet',
	'presentation',
	'archive',
	'audio',
	'video',
	'image',
	'code',
	'text',
	'other',
] as const;
export type FileKind = (typeof FILE_KINDS)[number];

const EXTENSIONS: Record<string, FileKind> = {
	pdf: 'pdf',
	doc: 'document',
	docx: 'document',
	odt: 'document',
	rtf: 'document',
	pages: 'document',
	xls: 'spreadsheet',
	xlsx: 'spreadsheet',
	ods: 'spreadsheet',
	csv: 'spreadsheet',
	tsv: 'spreadsheet',
	numbers: 'spreadsheet',
	ppt: 'presentation',
	pptx: 'presentation',
	odp: 'presentation',
	key: 'presentation',
	zip: 'archive',
	rar: 'archive',
	'7z': 'archive',
	tar: 'archive',
	gz: 'archive',
	tgz: 'archive',
	bz2: 'archive',
	xz: 'archive',
	dmg: 'archive',
	mp3: 'audio',
	m4a: 'audio',
	wav: 'audio',
	aac: 'audio',
	flac: 'audio',
	ogg: 'audio',
	opus: 'audio',
	mp4: 'video',
	mov: 'video',
	m4v: 'video',
	webm: 'video',
	mkv: 'video',
	avi: 'video',
	png: 'image',
	jpg: 'image',
	jpeg: 'image',
	gif: 'image',
	webp: 'image',
	heic: 'image',
	heif: 'image',
	svg: 'image',
	tif: 'image',
	tiff: 'image',
	bmp: 'image',
	js: 'code',
	ts: 'code',
	jsx: 'code',
	tsx: 'code',
	json: 'code',
	html: 'code',
	css: 'code',
	py: 'code',
	rb: 'code',
	go: 'code',
	rs: 'code',
	swift: 'code',
	kt: 'code',
	java: 'code',
	c: 'code',
	h: 'code',
	cpp: 'code',
	sh: 'code',
	sql: 'code',
	xml: 'code',
	yaml: 'code',
	yml: 'code',
	toml: 'code',
	txt: 'text',
	md: 'text',
	log: 'text',
};

const TYPE_PREFIXES: [string, FileKind][] = [
	['application/pdf', 'pdf'],
	['audio/', 'audio'],
	['video/', 'video'],
	['image/', 'image'],
	['text/', 'text'],
	['application/zip', 'archive'],
	['application/json', 'code'],
];

/** The extension decides first, since browsers report an empty or generic type for many files. */
export function fileKind({ name, type }: { name: string; type: string }): FileKind {
	const dot = name.lastIndexOf('.');
	const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
	return EXTENSIONS[extension] ?? TYPE_PREFIXES.find(([prefix]) => type.startsWith(prefix))?.[1] ?? 'other';
}

/** Each kind's icon tint, from the label palette, so it has a light and dark value on both clients. */
export const FILE_KIND_COLORS = {
	pdf: 'red',
	document: 'blue',
	spreadsheet: 'green',
	presentation: 'orange',
	archive: 'amber',
	audio: 'pink',
	video: 'violet',
	image: 'teal',
	code: 'indigo',
	text: 'gray',
	other: 'gray',
} as const satisfies Record<FileKind, LabelColor>;
