import { z } from 'zod';
import type { LabelColor } from './label-colors.ts';

/**
 * Task attachments. A task lists `Attachment`s; the bytes of each live in a private R2 bucket, read and written through
 * `IMAGES_PATH`: an image as one object per size, any other file as one `file` object. See `docs/decisions/images.md`.
 */

export const IMAGES_PATH = '/api/images';

export const IMAGE_SIZES = ['full', 'thumb'] as const;
export const imageSizeSchema = z.enum(IMAGE_SIZES).meta({ id: 'ImageSize' });
export type ImageSize = z.infer<typeof imageSizeSchema>;

/** Safari's canvas cannot encode WebP and iOS has no WebP encoder, so both send JPEG. */
export const IMAGE_TYPES = ['image/webp', 'image/jpeg'] as const;
export const imageTypeSchema = z.enum(IMAGE_TYPES).meta({ id: 'ImageType' });
export type ImageType = z.infer<typeof imageTypeSchema>;

/** What clients encode to and the server accepts. `edge` is the longest side in pixels. */
export const IMAGE_LIMITS = {
	full: { edge: 2048, bytes: 1_500_000 },
	thumb: { edge: 320, bytes: 200_000 },
} as const satisfies Record<ImageSize, { edge: number; bytes: number }>;

/** One stored object of an attachment: an image's size, or a file's bytes. */
export const BYTE_KEYS = [...IMAGE_SIZES, 'file'] as const;
export const byteKeySchema = z.enum(BYTE_KEYS);
export type ByteKey = z.infer<typeof byteKeySchema>;

/**
 * A file at most this long goes up in one request; a longer one in parts this long, the last one shorter. R2 takes
 * multipart parts of one size, at least 5 MiB, and a Worker request carries at most 100 MB.
 */
export const FILE_PART_BYTES = 16 * 1024 * 1024;
export const FILE_MAX_BYTES = 2_000_000_000;
export const FILE_MAX_PARTS = Math.ceil(FILE_MAX_BYTES / FILE_PART_BYTES);
/** What a file is stored as unless `previewType` names a type a browser shows safely. */
export const FILE_TYPE = 'application/octet-stream';

/** What beginning a multipart upload answers: the upload its parts go to, or null when the file is already stored. */
export const uploadBegunSchema = z.object({ upload: z.string().nullable() }).meta({ id: 'UploadBegun' });
/** What storing one part answers. */
export const uploadedPartSchema = z.object({ etag: z.string() }).meta({ id: 'UploadedPart' });
/** What completes a multipart upload: every part's etag, in order. */
export const uploadCompletionSchema = z.object({ parts: z.array(z.string()) }).meta({ id: 'UploadCompletion' });

export const filePartCount = (bytes: number) => Math.max(1, Math.ceil(bytes / FILE_PART_BYTES));

/**
 * The type a file is served as when a browser may show it in a tab, or null when it only downloads. Anything that can
 * run script there, such as HTML or SVG, downloads, since the tab shares the app's origin.
 */
export function previewType(file: { name: string; type: string }): string | null {
	switch (fileKind(file)) {
		case 'pdf':
			return 'application/pdf';
		case 'text':
			return 'text/plain;charset=utf-8';
		case 'audio':
		case 'video':
			return /^(audio|video)\/[\w.+-]+$/.test(file.type) ? file.type : null;
		case 'image':
			return /^image\/(png|jpeg|gif|webp|avif)$/.test(file.type) ? file.type : null;
		default:
			return null;
	}
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

/** `download` answers the bytes as a download under the file's name, whatever its type. */
export const imageUrl = (space: string | null, id: string, key: ByteKey, { download = false } = {}) => {
	const query = new URLSearchParams({ id, size: key });
	if (space) query.set('space', space);
	if (download) query.set('download', '1');
	return `${IMAGES_PATH}?${query}`;
};

/** What a file is, for its icon. iOS mirrors this table in `Core/FileKinds.swift`. */
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
