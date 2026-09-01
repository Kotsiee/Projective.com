/// <reference lib="dom" />

import type { ImageMetadata } from "../../types/file-types.ts";
import { componentsFor, encodeBlurHash } from "./blurhash.ts";
import { colorSummary } from "./colors.ts";

/**
 * image — reads what an image file says about itself, and describes its pixels.
 *
 * Also the raster toolbox the video and document extractors reuse ({@link samplePixels},
 * {@link describePixels}, {@link rasterToDataUrl}): a poster frame is an image, and a second copy of
 * "draw this into a bounded canvas and read it back" is a second place for the bound to be wrong.
 *
 * ## The bound is the point
 *
 * A 6000x4000 photograph is 96 megapixels; `getImageData` over it would hand back a 384 MB
 * `Uint8ClampedArray` to compute a 5x3 hash and three colours. Everything here draws into a canvas
 * whose long edge is at most {@link SAMPLE_MAX_EDGE} first, so our allocation is a few kilobytes
 * regardless of the source. The decode itself is the browser's and is released the moment the bitmap
 * closes.
 *
 * ## Every step is allowed to fail, and none of them may throw
 *
 * A browser can refuse to decode a file it does not recognise; `getImageData` throws outright on a
 * tainted canvas; `OffscreenCanvas` is absent in older engines. Each of those is a fact worth
 * recording in the row's `notes` and none of them is a reason to fail an upload whose bytes are
 * already safe — so every function here returns `null` and appends a sentence rather than raising.
 */

// #region Bounds
/**
 * The longest edge of the bitmap the hash and the colours are computed from.
 *
 * 64 is far more than a 5x3 BlurHash can express and plenty for a colour histogram, and it caps the
 * read at 16 KB whatever the source was.
 */
export const SAMPLE_MAX_EDGE = 64;

/** The longest edge of a stored poster frame — big enough to stand in for a thumbnail, small enough to inline. */
export const POSTER_MAX_EDGE = 640;

/** JPEG quality for a poster. Low enough that a 640px frame comfortably fits the column's bound. */
export const POSTER_QUALITY = 0.72;

/**
 * The longest `posterDataUrl` the SSOT accepts, in characters.
 *
 * Checked before the value is handed on, because a poster that overshoots would be rejected by Zod at
 * the boundary and take the entire metadata row with it — losing the dimensions and the duration
 * along with the picture.
 */
export const POSTER_MAX_CHARS = 400_000;

/** How much of an SVG is read looking for its intrinsic size. The root element is in the first line. */
const SVG_HEAD_BYTES = 64 * 1024;

/** Above this, an animation probe would read the whole file into memory to count frames it may not have. */
const FRAME_PROBE_MAX_BYTES = 32 * 1024 * 1024;
// #endregion

// #region Canvas
/**
 * The 2D drawing surface this module needs, declared structurally.
 *
 * `HTMLCanvasElement` and `OffscreenCanvas` return different context types that share exactly these
 * two methods, and naming the shared shape is what lets one code path serve both — the same reasoning
 * as `UploadDrawer`'s `UploadRequest`.
 */
interface RasterContext {
	drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
	getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
}

/** A bounded drawing surface, plus whatever way it has of producing an encoded image. */
interface Raster {
	ctx: RasterContext;
	/** A JPEG `data:` URL, or `null` where this canvas kind cannot produce one synchronously. */
	toDataUrl(quality: number): string | null;
}

/**
 * Create a drawing surface, preferring a real `<canvas>`.
 *
 * `OffscreenCanvas` is the better citizen — it never touches the document — but only
 * `HTMLCanvasElement` has the synchronous `toDataURL` a poster needs, so the DOM canvas comes first
 * and the offscreen one is the fallback for an environment without a document. `willReadFrequently`
 * tells the engine to keep the surface in software memory, which is what this is for.
 */
function createRaster(width: number, height: number): Raster | null {
	try {
		if (typeof document !== "undefined") {
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext("2d", { willReadFrequently: true });
			if (!ctx) return null;
			return {
				ctx,
				toDataUrl: (quality) => {
					try {
						return canvas.toDataURL("image/jpeg", quality);
					} catch {
						// A tainted canvas refuses to export. The caller records the absence.
						return null;
					}
				},
			};
		}
		if (typeof OffscreenCanvas !== "undefined") {
			const canvas = new OffscreenCanvas(width, height);
			const ctx = canvas.getContext("2d", { willReadFrequently: true });
			if (!ctx) return null;
			return { ctx, toDataUrl: () => null };
		}
	} catch {
		// No usable canvas in this environment.
	}
	return null;
}

/** Scale `width`x`height` down so its long edge is at most `maxEdge`, never up, never below 1px. */
function fitWithin(width: number, height: number, maxEdge: number): [number, number] {
	const longest = Math.max(width, height);
	const scale = longest > maxEdge ? maxEdge / longest : 1;
	return [
		Math.max(1, Math.round(width * scale)),
		Math.max(1, Math.round(height * scale)),
	];
}
// #endregion

// #region Raster toolbox
/** A bounded RGBA read, with the dimensions it was actually taken at. */
export interface PixelSample {
	data: Uint8ClampedArray;
	width: number;
	height: number;
}

/**
 * Draw `source` into a canvas bounded by `maxEdge` and read the pixels back.
 *
 * `null` when there is no canvas, or when the read is refused — `getImageData` throws a
 * `SecurityError` on a canvas tainted by cross-origin content, which is the single most likely
 * failure on this path and the reason every caller treats absence as normal.
 */
export function samplePixels(
	source: CanvasImageSource,
	sourceWidth: number,
	sourceHeight: number,
	maxEdge: number = SAMPLE_MAX_EDGE,
): PixelSample | null {
	if (!(sourceWidth > 0) || !(sourceHeight > 0)) return null;
	const [width, height] = fitWithin(sourceWidth, sourceHeight, maxEdge);
	const raster = createRaster(width, height);
	if (!raster) return null;
	try {
		raster.ctx.drawImage(source, 0, 0, width, height);
		return { data: raster.ctx.getImageData(0, 0, width, height).data, width, height };
	} catch {
		return null;
	}
}

/**
 * The BlurHash and the colour summary of a sampled bitmap.
 *
 * Both are independently nullable: colours survive a bitmap the hash encoder refuses (it throws only
 * on a buffer whose length disagrees with its dimensions, which would mean the sample itself is
 * malformed), so one failing does not discard the other.
 */
export function describePixels(sample: PixelSample): {
	blurhash: string | null;
	colors: ReturnType<typeof colorSummary>;
} {
	let blurhash: string | null = null;
	try {
		const [cx, cy] = componentsFor(sample.width, sample.height);
		blurhash = encodeBlurHash(sample.data, sample.width, sample.height, cx, cy);
	} catch {
		blurhash = null;
	}
	let colors: ReturnType<typeof colorSummary> = null;
	try {
		colors = colorSummary(sample.data);
	} catch {
		colors = null;
	}
	return { blurhash, colors };
}

/**
 * Encode `source` as a bounded JPEG `data:` URL.
 *
 * Retried once at half quality when the first attempt overshoots {@link POSTER_MAX_CHARS}, then given
 * up on: a poster is a convenience, and a row that cannot be written at all because its picture was
 * too large would cost the duration and the dimensions as well.
 */
export function rasterToDataUrl(
	source: CanvasImageSource,
	sourceWidth: number,
	sourceHeight: number,
	maxEdge: number = POSTER_MAX_EDGE,
	quality: number = POSTER_QUALITY,
): string | null {
	if (!(sourceWidth > 0) || !(sourceHeight > 0)) return null;
	const [width, height] = fitWithin(sourceWidth, sourceHeight, maxEdge);
	const raster = createRaster(width, height);
	if (!raster) return null;
	try {
		raster.ctx.drawImage(source, 0, 0, width, height);
	} catch {
		return null;
	}
	const first = raster.toDataUrl(quality);
	if (first === null) return null;
	if (first.length <= POSTER_MAX_CHARS) return first;
	const retry = raster.toDataUrl(quality / 2);
	return retry !== null && retry.length <= POSTER_MAX_CHARS ? retry : null;
}
// #endregion

// #region Decoding
/** A decoded image, its intrinsic size, and the release its allocation needs. */
interface DecodedImage {
	source: CanvasImageSource;
	width: number;
	height: number;
	release(): void;
}

/**
 * Decode `file` far enough to draw it.
 *
 * `createImageBitmap` first: it is the only path that decodes off the main thread and it hands back
 * an explicitly closeable allocation. The `<img>` fallback exists for engines without it and pays for
 * itself the moment one turns up — `decode()` resolves before the element is drawable, so a bitmap
 * read straight after it is not a race.
 */
async function decodeImage(file: File): Promise<DecodedImage | null> {
	if (typeof createImageBitmap === "function") {
		try {
			const bitmap = await createImageBitmap(file);
			return {
				source: bitmap,
				width: bitmap.width,
				height: bitmap.height,
				release: () => bitmap.close(),
			};
		} catch {
			// Fall through: an engine can support the call and still refuse this particular file.
		}
	}
	if (typeof document === "undefined" || typeof URL?.createObjectURL !== "function") return null;

	const url = URL.createObjectURL(file);
	try {
		const element = document.createElement("img");
		element.decoding = "async";
		element.src = url;
		await element.decode();
		if (!(element.naturalWidth > 0)) throw new Error("The decoder reported no dimensions.");
		return {
			source: element,
			width: element.naturalWidth,
			height: element.naturalHeight,
			release: () => URL.revokeObjectURL(url),
		};
	} catch {
		URL.revokeObjectURL(url);
		return null;
	}
}
// #endregion

// #region Format facts
/** MIME types that can carry more than one frame — the only ones worth probing for animation. */
const ANIMATABLE = new Set(["image/gif", "image/webp", "image/avif", "image/apng", "image/png"]);

/** MIME types with no alpha channel at all, so the answer is known without reading a pixel. */
const OPAQUE_FORMATS = new Set(["image/jpeg", "image/jpg", "image/bmp"]);

/** Whether the file claims to be vector artwork. Checked by MIME first, by extension when it is absent. */
export function isSvg(file: File): boolean {
	if (file.type === "image/svg+xml") return true;
	return file.type === "" && file.name.toLowerCase().endsWith(".svg");
}

/**
 * How many frames the file holds, via `ImageDecoder` where the engine has it.
 *
 * `null` means "not asked or not answered", which the caller keeps distinct from "one frame". The
 * probe reads the whole file into memory, so it is bounded by size and by format: asking a 40 MB TIFF
 * whether it is animated would cost more than the answer is worth.
 */
async function readFrameCount(file: File): Promise<number | null> {
	if (!ANIMATABLE.has(file.type)) return null;
	if (file.size > FRAME_PROBE_MAX_BYTES) return null;
	const decoderCtor = (globalThis as {
		ImageDecoder?: new (init: { data: ArrayBuffer; type: string }) => {
			tracks: {
				ready: Promise<void>;
				selectedTrack?: { frameCount?: number } | null;
			};
			close(): void;
		};
	}).ImageDecoder;
	if (!decoderCtor) return null;
	try {
		const decoder = new decoderCtor({ data: await file.arrayBuffer(), type: file.type });
		await decoder.tracks.ready;
		const frames = decoder.tracks.selectedTrack?.frameCount ?? null;
		decoder.close();
		return typeof frames === "number" && frames > 0 ? frames : null;
	} catch {
		return null;
	}
}

/**
 * Whether the sampled pixels carry transparency.
 *
 * The sample is downscaled, and a scaled draw BLENDS alpha rather than dropping it, so a small
 * transparent region still lands below 255 somewhere. The reverse mistake is the one that matters:
 * `hasAlpha` drives the preview's checkerboard ground, and drawing one behind an opaque JPEG is as
 * wrong as omitting it behind a cut-out PNG — which is why an unread sample answers `null` and the
 * preview is left to decide what to do with a fact nobody has.
 */
function sampledAlpha(sample: PixelSample): boolean {
	for (let i = 3; i < sample.data.length; i += 4) {
		if (sample.data[i] < 255) return true;
	}
	return false;
}
// #endregion

// #region SVG
/** Pull the first absolute length out of an SVG length attribute; `null` for `100%`, `auto` or junk. */
function svgLength(raw: string | null): number | null {
	if (!raw) return null;
	if (raw.includes("%")) return null;
	const value = Number.parseFloat(raw);
	return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Read an SVG's intrinsic size out of its markup.
 *
 * Deliberately NOT rasterised: an SVG has no pixels until something chooses a size for it, and
 * drawing one to find out how big it is would invent the answer. Explicit `width`/`height` win, the
 * `viewBox` is the fallback, and a document with neither has no intrinsic size — which is a real
 * property of SVG and is reported as an absence rather than as the browser's 300x150 default.
 */
async function readSvgSize(file: File): Promise<{ width: number; height: number } | null> {
	let head: string;
	try {
		head = await file.slice(0, SVG_HEAD_BYTES).text();
	} catch {
		return null;
	}
	const open = /<svg\b[^>]*>/i.exec(head);
	if (!open) return null;
	const tag = open[0];

	const attr = (name: string): string | null => {
		const found = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);
		return found ? found[1] : null;
	};

	const width = svgLength(attr("width"));
	const height = svgLength(attr("height"));
	if (width !== null && height !== null) {
		return { width: Math.round(width), height: Math.round(height) };
	}

	const viewBox = attr("viewBox");
	if (!viewBox) return null;
	const parts = viewBox.trim().split(/[\s,]+/).map(Number);
	if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
	const [, , boxWidth, boxHeight] = parts;
	if (!(boxWidth > 0) || !(boxHeight > 0)) return null;
	return { width: Math.round(boxWidth), height: Math.round(boxHeight) };
}
// #endregion

// #region Entry point
/** `width / height`, to the 4dp the SSOT stores — so SSR and a client re-read print the same number. */
function aspectRatio(width: number, height: number): number {
	return Math.round((width / height) * 10_000) / 10_000;
}

/**
 * Everything readable about an image file.
 *
 * `null` means the file could not be established as an image at all, which the caller turns into a
 * `generic` row — a row that says "we know the type and read nothing further" rather than one
 * carrying invented dimensions.
 *
 * Every absence below leaves a sentence in `notes`, because a null `blurhash` on a vector and a null
 * `blurhash` on a tainted canvas are different facts and a reader that cannot tell them apart will
 * retry the wrong one forever.
 */
export async function readImageMetadata(
	file: File,
	notes: string[],
): Promise<ImageMetadata | null> {
	if (isSvg(file)) {
		const size = await readSvgSize(file);
		if (!size) {
			notes.push("This SVG declares no width, height or viewBox, so it has no intrinsic size.");
			return null;
		}
		notes.push("Vector artwork: the size comes from the markup and no pixels were sampled.");
		return {
			kind: "image",
			width: size.width,
			height: size.height,
			aspectRatio: aspectRatio(size.width, size.height),
			blurhash: null,
			colors: null,
			animated: false,
			vector: true,
			hasAlpha: true,
		};
	}

	const decoded = await decodeImage(file);
	if (!decoded) {
		notes.push("This browser could not decode the image, so its size was not read.");
		return null;
	}

	try {
		const sample = samplePixels(decoded.source, decoded.width, decoded.height);
		if (!sample) {
			notes.push("The image could not be sampled, so it has no placeholder or colours.");
		}
		const described = sample ? describePixels(sample) : { blurhash: null, colors: null };
		if (sample && described.blurhash === null) {
			notes.push("The placeholder could not be computed from this image.");
		}

		const frames = await readFrameCount(file);
		if (ANIMATABLE.has(file.type) && frames === null) {
			notes.push("This browser cannot count frames, so animation was not detected either way.");
		}

		const hasAlpha = OPAQUE_FORMATS.has(file.type) ? false : sample ? sampledAlpha(sample) : null;

		return {
			kind: "image",
			width: decoded.width,
			height: decoded.height,
			aspectRatio: aspectRatio(decoded.width, decoded.height),
			blurhash: described.blurhash,
			colors: described.colors,
			animated: frames !== null && frames > 1,
			vector: false,
			hasAlpha,
		};
	} finally {
		decoded.release();
	}
}
// #endregion
