import { decode as decodeJpegRaster } from "@jsquash/jpeg";
import { decode as decodePngRaster } from "@jsquash/png";
import { decode as decodeWebpRaster, encode as encodeWebpRaster } from "@jsquash/webp";
import { GifReader } from "omggif";
import {
	type ColorSummary,
	colorSummary,
	componentsFor,
	type CropState,
	encodeBlurHash,
	isAxisAligned,
	sourcePointFor,
} from "@projective/types/files";

/**
 * image-codec — the pixel work of the media pipeline: decode, orient, crop, resample, encode.
 *
 * Everything here operates on a plain RGBA {@link Bitmap} so the operations compose and can be
 * tested without a file on disk. The codecs are wrapped at the edges — the Squoosh codecs compiled
 * to WASM (`@jsquash/jpeg` · `png` · `webp`) decode and encode, and `omggif` reads a GIF's first
 * frame — and nothing past {@link decodeImage} knows which one produced a bitmap. Crop, rotation and
 * resampling are this module's own arithmetic, driven by the shared crop model.
 *
 * This module is CPU-bound and runs inside the pipeline Worker (`image-worker.ts`), never on the
 * request thread: a 12-megapixel decode is most of a second of JavaScript, and on the SSR thread it
 * would stall every other request the server is handling.
 */

// #region Types

/** An RGBA raster, row-major, 4 bytes per pixel. */
export interface Bitmap {
	width: number;
	height: number;
	data: Uint8ClampedArray;
}

/** What decoding learned about the source besides its pixels. */
export interface DecodedImage {
	bitmap: Bitmap;
	/** The source had more than one frame (an animated GIF/WebP); the first frame was taken. */
	animated: boolean;
	/** Any pixel is not fully opaque. */
	hasAlpha: boolean;
}

/** Thrown for input the pipeline refuses — the message is written for the person who uploaded it. */
export class ImageRejection extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ImageRejection";
	}
}

// #endregion

// #region Limits

/**
 * The largest picture the pipeline will decode, in pixels. A decompression bomb is a small file that
 * claims an enormous canvas — a 50 KB PNG can declare 50 000 × 50 000 and ask for 10 GB of RGBA —
 * so the header's claimed size is checked BEFORE any decode allocates for it.
 */
export const MAX_DECODE_PIXELS = 40_000_000;

/** The largest dimension on either side, independently of area. */
export const MAX_DECODE_EDGE = 12_000;

// #endregion

// #region Header peek (before any allocation)

/**
 * The canvas size a file's header CLAIMS, read without decoding, or `null` when the header is not
 * one this reads. Used only to refuse an oversized canvas before decoding it.
 */
export function peekDimensions(bytes: Uint8Array, mime: string): { width: number; height: number } | null {
	const u16be = (i: number) => (bytes[i] << 8) | bytes[i + 1];
	const u16le = (i: number) => bytes[i] | (bytes[i + 1] << 8);
	const u24le = (i: number) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
	const u32be = (i: number) => ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];
	try {
		if (mime === "image/png" && bytes.length >= 24) {
			return { width: u32be(16), height: u32be(20) };
		}
		if (mime === "image/gif" && bytes.length >= 10) {
			return { width: u16le(6), height: u16le(8) };
		}
		if (mime === "image/webp" && bytes.length >= 30) {
			const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
			if (chunk === "VP8X") return { width: u24le(24) + 1, height: u24le(27) + 1 };
			if (chunk === "VP8 ") return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
			if (chunk === "VP8L") {
				const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
				return {
					width: 1 + (((b1 & 0x3f) << 8) | b0),
					height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
				};
			}
		}
		if (mime === "image/jpeg") {
			let i = 2;
			while (i + 9 < bytes.length) {
				if (bytes[i] !== 0xff) {
					i++;
					continue;
				}
				const marker = bytes[i + 1];
				// SOF0–SOF15 carry the frame size, except DHT (C4), JPG (C8) and DAC (CC).
				if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
					return { height: u16be(i + 5), width: u16be(i + 7) };
				}
				if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
					i += 2;
					continue;
				}
				i += 2 + u16be(i + 2);
			}
		}
	} catch {
		return null;
	}
	return null;
}

/** Refuse a canvas the pipeline will not decode. */
function assertDecodable(dims: { width: number; height: number } | null): void {
	if (!dims) return;
	const { width, height } = dims;
	if (width <= 0 || height <= 0) throw new ImageRejection("This picture's size couldn't be read.");
	if (width > MAX_DECODE_EDGE || height > MAX_DECODE_EDGE || width * height > MAX_DECODE_PIXELS) {
		throw new ImageRejection(
			`This picture is too large to process (${width} × ${height}). Keep it under 40 megapixels.`,
		);
	}
}

// #endregion

// #region EXIF orientation

/**
 * The EXIF orientation of a JPEG (1–8), or 1 when it carries none. A phone stores a portrait photo
 * as landscape pixels plus this tag, and every browser honours the tag when it draws the picture —
 * so the crop the person made in the editor is relative to the ORIENTED picture, and the server must
 * orient its pixels the same way before cutting, or every phone portrait is cropped sideways.
 */
export function readJpegOrientation(bytes: Uint8Array): number {
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
	let i = 2;
	while (i + 4 < bytes.length) {
		if (bytes[i] !== 0xff) return 1;
		const marker = bytes[i + 1];
		const len = (bytes[i + 2] << 8) | bytes[i + 3];
		if (marker === 0xe1 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) {
			const tiff = i + 10;
			const little = bytes[tiff] === 0x49;
			const r16 = (o: number) => little ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1];
			const r32 = (o: number) =>
				little
					? (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0
					: ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
			const ifd = tiff + r32(tiff + 4);
			const count = r16(ifd);
			for (let e = 0; e < count; e++) {
				const entry = ifd + 2 + e * 12;
				if (entry + 12 > bytes.length) break;
				if (r16(entry) === 0x0112) {
					const v = r16(entry + 8);
					return v >= 1 && v <= 8 ? v : 1;
				}
			}
			return 1;
		}
		if (marker === 0xda) return 1; // start of scan — no EXIF before the image data
		i += 2 + len;
	}
	return 1;
}

/** Apply an EXIF orientation (1–8) to a bitmap, returning the upright picture. */
export function orient(bitmap: Bitmap, orientation: number): Bitmap {
	if (orientation <= 1 || orientation > 8) return bitmap;
	const { width: w, height: h, data } = bitmap;
	const swap = orientation >= 5;
	const ow = swap ? h : w;
	const oh = swap ? w : h;
	const out = new Uint8ClampedArray(ow * oh * 4);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let nx = x, ny = y;
			switch (orientation) {
				case 2: nx = w - 1 - x; break;
				case 3: nx = w - 1 - x; ny = h - 1 - y; break;
				case 4: ny = h - 1 - y; break;
				case 5: nx = y; ny = x; break;
				case 6: nx = h - 1 - y; ny = x; break;
				case 7: nx = h - 1 - y; ny = w - 1 - x; break;
				case 8: nx = y; ny = w - 1 - x; break;
			}
			const si = (y * w + x) * 4;
			const di = (ny * ow + nx) * 4;
			out[di] = data[si];
			out[di + 1] = data[si + 1];
			out[di + 2] = data[si + 2];
			out[di + 3] = data[si + 3];
		}
	}
	return { width: ow, height: oh, data: out };
}

// #endregion

// #region Decode

/**
 * Decode a still (JPEG, PNG, GIF, WebP) into an upright RGBA bitmap. `mime` is the SNIFFED type
 * (`files/sniff.ts`), never the browser's claim. An animated GIF contributes its first frame. The
 * header's claimed canvas is checked before decoding (see {@link MAX_DECODE_PIXELS}).
 */
export async function decodeImage(bytes: Uint8Array, mime: string): Promise<DecodedImage> {
	assertDecodable(peekDimensions(bytes, mime));

	let bitmap: Bitmap;
	let animated = false;
	try {
		const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
		if (mime === "image/gif") {
			// First frame only: an animated GIF decoded whole is its own memory bomb (every frame is a
			// full RGBA canvas), and every surface this feeds shows a still anyway.
			const reader = new GifReader(bytes);
			const data = new Uint8ClampedArray(reader.width * reader.height * 4);
			reader.decodeAndBlitFrameRGBA(0, data);
			animated = reader.numFrames() > 1;
			bitmap = { width: reader.width, height: reader.height, data };
		} else {
			const decoded = mime === "image/webp"
				? await decodeWebpRaster(buffer)
				: mime === "image/png"
				? await decodePngRaster(buffer)
				: mime === "image/jpeg"
				? await decodeJpegRaster(buffer)
				: null;
			if (!decoded) throw new ImageRejection("This picture format isn't supported.");
			bitmap = {
				width: decoded.width,
				height: decoded.height,
				data: new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength),
			};
		}
	} catch (err) {
		if (err instanceof ImageRejection) throw err;
		throw new ImageRejection("This picture couldn't be read — the file may be damaged.");
	}

	assertDecodable({ width: bitmap.width, height: bitmap.height });
	if (mime === "image/jpeg") bitmap = orient(bitmap, readJpegOrientation(bytes));
	return { bitmap, animated, hasAlpha: hasTransparency(bitmap) };
}

/** Whether any pixel is not fully opaque. */
export function hasTransparency(bitmap: Bitmap): boolean {
	const d = bitmap.data;
	for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return true;
	return false;
}

// #endregion

// #region Crop

/**
 * Cut the crop described by `state` (the editor's state, already clamped against THIS picture by
 * `clampCrop`) out of `source`, into a `width × height` output. Rotation 0 with an output no larger
 * than the box is a plain copy followed by a resample; any rotation is one bilinear resampling pass
 * through the same inverse mapping the editor draws with (`sourcePointFor`), so the saved crop is the
 * one the person saw.
 */
export function renderCrop(
	source: Bitmap,
	state: CropState,
	aspect: number,
	width: number,
	height: number,
): Bitmap {
	const image = { width: source.width, height: source.height };
	if (isAxisAligned(state)) {
		const tl = sourcePointFor(state, image, aspect, 0, 0);
		const br = sourcePointFor(state, image, aspect, 1, 1);
		const x0 = clampInt(Math.round(tl.x), 0, source.width - 1);
		const y0 = clampInt(Math.round(tl.y), 0, source.height - 1);
		const x1 = clampInt(Math.round(br.x), x0 + 1, source.width);
		const y1 = clampInt(Math.round(br.y), y0 + 1, source.height);
		const cut = copyRect(source, x0, y0, x1 - x0, y1 - y0);
		return resize(cut, width, height);
	}

	// Rotated: affine inverse mapping, evaluated incrementally. The mapping from output pixel centres
	// to source points is linear, so the three corner points define it completely.
	const o = sourcePointFor(state, image, aspect, 0.5 / width, 0.5 / height);
	const ux = sourcePointFor(state, image, aspect, 1.5 / width, 0.5 / height);
	const vy = sourcePointFor(state, image, aspect, 0.5 / width, 1.5 / height);
	const dxu = ux.x - o.x, dyu = ux.y - o.y;
	const dxv = vy.x - o.x, dyv = vy.y - o.y;
	// When the output is much smaller than the box, bilinear sampling alone aliases: render at the
	// box's own scale first and resample down with the area filter.
	const boxScale = Math.hypot(dxu, dyu);
	if (boxScale > 1.5) {
		const nativeW = Math.max(1, Math.round(width * boxScale));
		const nativeH = Math.max(1, Math.round(height * boxScale));
		return resize(renderCrop(source, state, aspect, nativeW, nativeH), width, height);
	}
	const out = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		let sx = o.x + dxv * y - 0.5;
		let sy = o.y + dyv * y - 0.5;
		for (let x = 0; x < width; x++) {
			sampleBilinear(source, sx, sy, out, (y * width + x) * 4);
			sx += dxu;
			sy += dyu;
		}
	}
	return { width, height, data: out };
}

function copyRect(src: Bitmap, x0: number, y0: number, w: number, h: number): Bitmap {
	const out = new Uint8ClampedArray(w * h * 4);
	for (let y = 0; y < h; y++) {
		const from = ((y0 + y) * src.width + x0) * 4;
		out.set(src.data.subarray(from, from + w * 4), y * w * 4);
	}
	return { width: w, height: h, data: out };
}

/** Bilinear sample at a (pixel-centre-relative) source point, edge-clamped. */
function sampleBilinear(src: Bitmap, x: number, y: number, out: Uint8ClampedArray, at: number): void {
	const w = src.width, h = src.height, d = src.data;
	const fx = x < 0 ? 0 : x > w - 1 ? w - 1 : x;
	const fy = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
	const x0 = Math.floor(fx), y0 = Math.floor(fy);
	const x1 = x0 + 1 < w ? x0 + 1 : x0;
	const y1 = y0 + 1 < h ? y0 + 1 : y0;
	const ax = fx - x0, ay = fy - y0;
	const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4;
	const i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
	// Premultiplied so a transparent neighbour does not bleed its (meaningless) colour into an edge.
	const a00 = d[i00 + 3], a10 = d[i10 + 3], a01 = d[i01 + 3], a11 = d[i11 + 3];
	const w00 = (1 - ax) * (1 - ay) * a00, w10 = ax * (1 - ay) * a10;
	const w01 = (1 - ax) * ay * a01, w11 = ax * ay * a11;
	const alpha = w00 + w10 + w01 + w11;
	out[at + 3] = alpha;
	if (alpha <= 0) {
		out[at] = out[at + 1] = out[at + 2] = 0;
		return;
	}
	for (let c = 0; c < 3; c++) {
		out[at + c] = (d[i00 + c] * w00 + d[i10 + c] * w10 + d[i01 + c] * w01 + d[i11 + c] * w11) / alpha;
	}
}

// #endregion

// #region Resize — separable area (box) resampling

/**
 * Resize to exactly `width × height` with an AREA filter: each output pixel is the coverage-weighted
 * mean of the source pixels under it. For the downscales this pipeline does (a 4000px photo to a
 * 320px thumbnail) that is the correct filter — a bilinear or bicubic kernel without prefiltering
 * samples a handful of source pixels per output pixel and aliases fine detail into moiré. Separable
 * (rows, then columns) so the cost is linear in the pixel count. Premultiplied alpha throughout.
 */
export function resize(src: Bitmap, width: number, height: number): Bitmap {
	const w = Math.max(1, Math.round(width));
	const h = Math.max(1, Math.round(height));
	if (w === src.width && h === src.height) return src;
	const pre = premultiply(src);
	const horizontal = resampleAxis(pre, src.width, src.height, w, true);
	const both = resampleAxis(horizontal, w, src.height, h, false);
	return unpremultiply({ width: w, height: h, data: both });
}

function premultiply(src: Bitmap): Float32Array {
	const d = src.data;
	const out = new Float32Array(d.length);
	for (let i = 0; i < d.length; i += 4) {
		const a = d[i + 3] / 255;
		out[i] = d[i] * a;
		out[i + 1] = d[i + 1] * a;
		out[i + 2] = d[i + 2] * a;
		out[i + 3] = d[i + 3];
	}
	return out;
}

function unpremultiply(img: { width: number; height: number; data: Float32Array }): Bitmap {
	const d = img.data;
	const out = new Uint8ClampedArray(d.length);
	for (let i = 0; i < d.length; i += 4) {
		const a = d[i + 3];
		out[i + 3] = a;
		if (a > 0) {
			const k = 255 / a;
			out[i] = d[i] * k;
			out[i + 1] = d[i + 1] * k;
			out[i + 2] = d[i + 2] * k;
		}
	}
	return { width: img.width, height: img.height, data: out };
}

/**
 * Resample one axis. When shrinking, each destination pixel averages the source span it covers with
 * fractional end weights; when growing (a tier is never an upscale, but a rotation render can be), it
 * falls back to linear interpolation between neighbours.
 */
function resampleAxis(
	src: Float32Array,
	srcW: number,
	srcH: number,
	dstLen: number,
	horizontal: boolean,
): Float32Array {
	const srcLen = horizontal ? srcW : srcH;
	const lines = horizontal ? srcH : srcW;
	const outW = horizontal ? dstLen : srcW;
	const out = new Float32Array(outW * (horizontal ? srcH : dstLen) * 4);
	const scale = srcLen / dstLen;
	const at = (line: number, pos: number) => (horizontal ? (line * srcW + pos) : (pos * srcW + line)) * 4;
	const put = (line: number, pos: number) => (horizontal ? (line * outW + pos) : (pos * outW + line)) * 4;

	for (let line = 0; line < lines; line++) {
		for (let i = 0; i < dstLen; i++) {
			const o = put(line, i);
			if (scale >= 1) {
				const start = i * scale;
				const end = start + scale;
				let p = Math.floor(start);
				let r = 0, g = 0, b = 0, a = 0, wsum = 0;
				while (p < end && p < srcLen) {
					const lo = Math.max(start, p), hi = Math.min(end, p + 1);
					const wgt = hi - lo;
					if (wgt > 0) {
						const s = at(line, p);
						r += src[s] * wgt;
						g += src[s + 1] * wgt;
						b += src[s + 2] * wgt;
						a += src[s + 3] * wgt;
						wsum += wgt;
					}
					p++;
				}
				const inv = wsum > 0 ? 1 / wsum : 0;
				out[o] = r * inv;
				out[o + 1] = g * inv;
				out[o + 2] = b * inv;
				out[o + 3] = a * inv;
			} else {
				const pos = (i + 0.5) * scale - 0.5;
				const p0 = clampInt(Math.floor(pos), 0, srcLen - 1);
				const p1 = clampInt(p0 + 1, 0, srcLen - 1);
				const t = Math.min(1, Math.max(0, pos - p0));
				const s0 = at(line, p0), s1 = at(line, p1);
				for (let c = 0; c < 4; c++) out[o + c] = src[s0 + c] * (1 - t) + src[s1 + c] * t;
			}
		}
	}
	return out;
}

// #endregion

// #region Encode + placeholder

/**
 * Encode a bitmap as WebP at `quality` (0–100). Alpha is preserved. The codec reads the three
 * ImageData fields and nothing else, so a plain object stands in for the DOM type Deno lacks.
 */
export async function encodeWebp(bitmap: Bitmap, quality: number): Promise<Uint8Array> {
	const image = { data: bitmap.data, width: bitmap.width, height: bitmap.height } as unknown as ImageData;
	const out = await encodeWebpRaster(image, { quality: Math.max(1, Math.min(100, Math.round(quality))) });
	return new Uint8Array(out);
}

/**
 * The placeholder facts a surface paints before the picture arrives — a BlurHash and the colour
 * summary — computed from a small copy so the cost is independent of the source's size. Written by
 * the same encoder the browser extractor uses (`@projective/types/files` `encodeBlurHash`), so a
 * pipeline-written placeholder and a browser-written one are indistinguishable. Never throws: a
 * placeholder is not worth failing an upload for.
 */
export function placeholderOf(bitmap: Bitmap): { blurhash: string | null; colors: ColorSummary | null } {
	try {
		const small = resize(bitmap, Math.min(64, bitmap.width), Math.max(1, Math.round(Math.min(64, bitmap.width) * bitmap.height / bitmap.width)));
		const [cx, cy] = componentsFor(small.width, small.height);
		return {
			blurhash: encodeBlurHash(small.data, small.width, small.height, cx, cy),
			colors: colorSummary(small.data),
		};
	} catch {
		return { blurhash: null, colors: null };
	}
}

// #endregion

function clampInt(n: number, lo: number, hi: number): number {
	return n < lo ? lo : n > hi ? hi : n;
}
