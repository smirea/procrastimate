import { z } from 'zod';

/**
 * Task images. A task lists `ImageRef`s; the bytes of each live in the server's `images` table, one row per size,
 * fetched by id from `IMAGES_PATH`. See `docs/decisions/images.md`.
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

export const imageUrl = (space: string | null, id: string, size: ImageSize) => {
	const query = new URLSearchParams({ id, size });
	if (space) query.set('space', space);
	return `${IMAGES_PATH}?${query}`;
};
