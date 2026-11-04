import { fitWithin, IMAGE_LIMITS, type ImageSize } from 'shared/images.ts';

export type Encoded = { width: number; height: number; sizes: Record<ImageSize, Blob> };

const QUALITIES = [0.85, 0.75, 0.6, 0.45];

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
	return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

/** Safari's canvas answers a WebP request with a PNG, so one tiny encode tells which type this browser writes. */
let writes: Promise<'image/webp' | 'image/jpeg'> | undefined;

function outputType() {
	writes ??= (async () => {
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 1;
		return (await toBlob(canvas, 'image/webp', 0.8))?.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
	})();
	return writes;
}

/** The first encoding under `bytes`, at falling quality, then at a smaller scale. */
async function encode(
	bitmap: ImageBitmap,
	edge: number,
	bytes: number,
): Promise<{ blob: Blob; width: number; height: number }> {
	const type = await outputType();
	for (let scale = 1; ; scale *= 0.75) {
		const { width, height } = fitWithin(bitmap.width, bitmap.height, Math.round(edge * scale));
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d')!;
		// JPEG has no alpha, so a transparent screenshot would turn black.
		context.fillStyle = '#ffffff';
		context.fillRect(0, 0, width, height);
		context.drawImage(bitmap, 0, 0, width, height);
		for (const quality of QUALITIES) {
			const blob = await toBlob(canvas, type, quality);
			if (blob && blob.size <= bytes) return { blob, width, height };
		}
		if (width <= 64 && height <= 64) throw new Error('This image cannot be made small enough');
	}
}

/** Downscales a picked, pasted, or dropped image to the full size and a thumbnail, upright per its EXIF. */
export async function encodeImage(file: Blob): Promise<Encoded> {
	const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	try {
		const full = await encode(bitmap, IMAGE_LIMITS.full.edge, IMAGE_LIMITS.full.bytes);
		const thumb = await encode(bitmap, IMAGE_LIMITS.thumb.edge, IMAGE_LIMITS.thumb.bytes);
		return { width: full.width, height: full.height, sizes: { full: full.blob, thumb: thumb.blob } };
	} finally {
		bitmap.close();
	}
}
