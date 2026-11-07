import { DataUtils, HalfFloatType } from "three";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";

/**
 * texture-read — HDR and EXR files decoded to pixels. Reached only from `texture-worker.ts`: decoding
 * a 50 MB EXR would otherwise freeze the page it is being previewed on. Like `sheet-read.ts`, it
 * imports only from `node_modules`, the one thing a worker's production bundle can resolve.
 */

// #region Contract
/** A texture format the panorama canvas can decode. */
export type TextureFormat = "hdr" | "exr";

/** RGBA half-float pixels, top row first. */
export interface DecodedTexture {
	width: number;
	height: number;
	pixels: Uint16Array;
}

/** RGBA bytes tone-mapped for a screen, top row first. */
export interface TexturePreview {
	width: number;
	height: number;
	pixels: Uint8ClampedArray;
}
// #endregion

// #region Decode
function flipRows(pixels: Uint16Array, width: number, height: number): void {
	const stride = width * 4;
	const scratch = new Uint16Array(stride);
	for (let top = 0, bottom = height - 1; top < bottom; top++, bottom--) {
		const a = top * stride;
		const b = bottom * stride;
		scratch.set(pixels.subarray(a, a + stride));
		pixels.copyWithin(a, b, b + stride);
		pixels.set(scratch, b);
	}
}

/** Keep every nth pixel, so a texture fits what the GPU can hold. */
function decimate(texture: DecodedTexture, maxWidth: number): DecodedTexture {
	const step = Math.ceil(texture.width / maxWidth);
	if (step <= 1) return texture;
	const width = Math.floor(texture.width / step);
	const height = Math.floor(texture.height / step);
	const pixels = new Uint16Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const from = (y * step * texture.width + x * step) * 4;
			pixels.set(texture.pixels.subarray(from, from + 4), (y * width + x) * 4);
		}
	}
	return { width, height, pixels };
}

/** Decode a file, top row first. Radiance stores rows top-down, EXR bottom-up as three hands them on. */
export function decodeTexture(
	bytes: ArrayBuffer,
	format: TextureFormat,
	maxWidth: number,
): DecodedTexture {
	const decoded = format === "hdr"
		? new HDRLoader().setDataType(HalfFloatType).parse(bytes)
		: new EXRLoader().setDataType(HalfFloatType).parse(bytes);
	const { width, height } = decoded;
	const pixels = decoded.data as Uint16Array;
	if (!(pixels instanceof Uint16Array) || !width || !height) {
		throw new Error("The texture has no pixels.");
	}
	if (format === "exr") flipRows(pixels, width, height);
	return decimate({ width, height, pixels }, maxWidth);
}
// #endregion

// #region Preview
const EXPOSURE_KEY = 0.18;
const GAMMA = 1 / 2.2;
const SAMPLE_STEP = 7;

function luminance(r: number, g: number, b: number): number {
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The exposure that lands a scene's log-average brightness on mid-grey. */
function autoExposure(texture: DecodedTexture): number {
	const { width, height, pixels } = texture;
	let total = 0;
	let samples = 0;
	for (let y = 0; y < height; y += SAMPLE_STEP) {
		for (let x = 0; x < width; x += SAMPLE_STEP) {
			const at = (y * width + x) * 4;
			const value = luminance(
				DataUtils.fromHalfFloat(pixels[at]),
				DataUtils.fromHalfFloat(pixels[at + 1]),
				DataUtils.fromHalfFloat(pixels[at + 2]),
			);
			total += Math.log(Math.max(value, 1e-4));
			samples += 1;
		}
	}
	return EXPOSURE_KEY / Math.exp(total / Math.max(samples, 1));
}

function tone(value: number, exposure: number): number {
	const scaled = value * exposure;
	return 255 * Math.pow(scaled / (1 + scaled), GAMMA);
}

/** A small, screen-ready copy of a texture, exposed for its own brightness. */
export function toneMappedPreview(texture: DecodedTexture, width: number): TexturePreview {
	const scale = Math.min(1, width / texture.width);
	const outWidth = Math.max(1, Math.round(texture.width * scale));
	const outHeight = Math.max(1, Math.round(texture.height * scale));
	const exposure = autoExposure(texture);
	const pixels = new Uint8ClampedArray(outWidth * outHeight * 4);
	for (let y = 0; y < outHeight; y++) {
		const sourceY = Math.min(texture.height - 1, Math.floor(y / scale));
		for (let x = 0; x < outWidth; x++) {
			const sourceX = Math.min(texture.width - 1, Math.floor(x / scale));
			const from = (sourceY * texture.width + sourceX) * 4;
			const to = (y * outWidth + x) * 4;
			for (let c = 0; c < 3; c++) {
				pixels[to + c] = tone(DataUtils.fromHalfFloat(texture.pixels[from + c]), exposure);
			}
			pixels[to + 3] = 255;
		}
	}
	return { width: outWidth, height: outHeight, pixels };
}
// #endregion
