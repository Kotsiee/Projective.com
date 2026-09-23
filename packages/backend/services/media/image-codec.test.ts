import { assert, assertAlmostEquals, assertEquals, assertRejects } from "@std/assert";
import { encode as encodeJpegRaw } from "@jsquash/jpeg";
import { encode as encodePngRaw } from "@jsquash/png";
import { encode as encodeWebpRaw } from "@jsquash/webp";
import { clampCrop, sourcePointFor } from "@projective/types/files";
import {
	type Bitmap,
	decodeImage,
	ImageRejection,
	orient,
	peekDimensions,
	readJpegOrientation,
	renderCrop,
	resize,
} from "./image-codec.ts";
import { runImageJob } from "./image-jobs.ts";

// #region Fixtures

/** A 4-quadrant test card: red TL, green TR, blue BL, white BR — orientation errors are visible. */
function quadrants(width: number, height: number): Bitmap {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const right = x > width / 2;
			const bottom = y > height / 2;
			const [r, g, b] = !right && !bottom
				? [255, 0, 0]
				: right && !bottom
				? [0, 255, 0]
				: !right && bottom
				? [0, 0, 255]
				: [255, 255, 255];
			const i = (y * width + x) * 4;
			data[i] = r;
			data[i + 1] = g;
			data[i + 2] = b;
			data[i + 3] = 255;
		}
	}
	return { width, height, data };
}

function imageData(b: Bitmap): ImageData {
	return { data: b.data, width: b.width, height: b.height } as unknown as ImageData;
}

async function asPng(b: Bitmap): Promise<Uint8Array> {
	return new Uint8Array(await encodePngRaw(imageData(b)));
}

async function asJpeg(b: Bitmap, quality = 92): Promise<Uint8Array> {
	return new Uint8Array(await encodeJpegRaw(imageData(b), { quality }));
}

async function asWebp(b: Bitmap, quality = 90): Promise<Uint8Array> {
	return new Uint8Array(await encodeWebpRaw(imageData(b), { quality }));
}

function pixel(b: Bitmap, x: number, y: number): [number, number, number, number] {
	const i = (y * b.width + x) * 4;
	return [b.data[i], b.data[i + 1], b.data[i + 2], b.data[i + 3]];
}

/** Splice an APP1 EXIF segment carrying `orientation` straight after a JPEG's SOI marker. */
function withOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
	const tiff = [
		0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // "II*\0" + IFD0 at 8
		0x01, 0x00, // one entry
		0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00, // 0x0112 SHORT = orientation
		0x00, 0x00, 0x00, 0x00, // next IFD
	];
	const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0"
	const len = payload.length + 2;
	const app1 = [0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload];
	const out = new Uint8Array(jpeg.length + app1.length);
	out.set(jpeg.subarray(0, 2), 0);
	out.set(app1, 2);
	out.set(jpeg.subarray(2), 2 + app1.length);
	return out;
}

// #endregion

Deno.test("peekDimensions: reads the claimed canvas of each still format without decoding", async () => {
	const img = quadrants(321, 123);
	assertEquals(peekDimensions(await asPng(img), "image/png"), { width: 321, height: 123 });
	assertEquals(peekDimensions(await asJpeg(img, 80), "image/jpeg"), { width: 321, height: 123 });
	assertEquals(peekDimensions(await asWebp(img, 80), "image/webp"), { width: 321, height: 123 });
});

Deno.test("decodeImage: refuses a decompression bomb from its header, before allocating", async () => {
	const png = await asPng(quadrants(8, 8));
	// Rewrite the IHDR to claim 50 000 × 50 000.
	const bomb = png.slice();
	new DataView(bomb.buffer).setUint32(16, 50_000);
	new DataView(bomb.buffer).setUint32(20, 50_000);
	await assertRejects(() => decodeImage(bomb, "image/png"), ImageRejection, "too large");
});

Deno.test("decodeImage: decodes PNG, JPEG and WebP to the same upright picture", async () => {
	const img = quadrants(64, 48);
	for (const [bytes, mime] of [
		[await asPng(img), "image/png"],
		[await asJpeg(img, 95), "image/jpeg"],
		[await asWebp(img, 100), "image/webp"],
	] as const) {
		const { bitmap } = await decodeImage(bytes, mime);
		assertEquals([bitmap.width, bitmap.height], [64, 48], mime);
		const [r, g, b] = pixel(bitmap, 8, 8);
		assert(r > 200 && g < 60 && b < 60, `${mime} top-left should be red, got ${r},${g},${b}`);
	}
});

Deno.test("readJpegOrientation + decodeImage: a phone portrait (orientation 6) is decoded upright", async () => {
	const stored = quadrants(80, 40); // landscape pixels…
	const jpeg = withOrientation(await asJpeg(stored, 95), 6); // …tagged "rotate 90° CW to view"
	assertEquals(readJpegOrientation(jpeg), 6);
	const { bitmap } = await decodeImage(jpeg, "image/jpeg");
	assertEquals([bitmap.width, bitmap.height], [40, 80]);
	// Rotating the stored card 90° clockwise puts its BLUE bottom-left quadrant at the top-left.
	const [r, g, b] = pixel(bitmap, 5, 5);
	assert(b > 200 && r < 60 && g < 60, `expected blue at top-left, got ${r},${g},${b}`);
});

Deno.test("orient: all eight EXIF orientations are self-consistent round trips", () => {
	const b = quadrants(6, 4);
	const inverse: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 8, 7: 7, 8: 6 };
	for (let o = 1; o <= 8; o++) {
		const back = orient(orient(b, o), inverse[o]);
		assertEquals([back.width, back.height], [6, 4], `orientation ${o}`);
		assertEquals(Array.from(back.data), Array.from(b.data), `orientation ${o}`);
	}
});

Deno.test("resize: the area filter averages exactly — a 2×2 block of black+white becomes grey", () => {
	const src: Bitmap = {
		width: 2,
		height: 2,
		data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255]),
	};
	const out = resize(src, 1, 1);
	const [r, g, b, a] = pixel(out, 0, 0);
	assertAlmostEquals(r, 128, 1);
	assertAlmostEquals(g, 128, 1);
	assertAlmostEquals(b, 128, 1);
	assertEquals(a, 255);
});

Deno.test("renderCrop: the cut matches the editor's mapping, rotated or not", () => {
	const src = quadrants(400, 300);
	const image = { width: 400, height: 300 };
	for (const rotation of [0, 90, -30]) {
		const state = clampCrop({ zoom: 1.5, rotation, cx: -40, cy: 20 }, image, 1);
		const out = renderCrop(src, state, 1, 64, 64);
		assertEquals([out.width, out.height], [64, 64]);
		// Sample a few output pixels and compare with the source pixel the editor's mapping names.
		for (const [u, v] of [[0.2, 0.2], [0.8, 0.3], [0.5, 0.9]]) {
			const p = sourcePointFor(state, image, 1, u, v);
			const expected = pixel(src, Math.min(399, Math.floor(p.x)), Math.min(299, Math.floor(p.y)));
			const got = pixel(out, Math.floor(u * 64), Math.floor(v * 64));
			for (let c = 0; c < 3; c++) {
				assert(Math.abs(got[c] - expected[c]) < 80, `rot ${rotation} (${u},${v}) channel ${c}: ${got} vs ${expected}`);
			}
		}
	}
});

Deno.test("runImageJob(render): an avatar is square, capped, tiered and carries a placeholder", async () => {
	const jpeg = await asJpeg(quadrants(3000, 2000), 85);
	const result = await runImageJob({
		kind: "render",
		bytes: jpeg,
		mime: "image/jpeg",
		purpose: "avatar",
		crop: { zoom: 1, rotation: 0, cx: 0, cy: 0 },
	});
	assertEquals([result.full!.width, result.full!.height], [2000, 2000]);
	assertEquals([result.tiers.sm.width, result.tiers.md.width, result.tiers.lg.width], [96, 256, 1024]);
	assert(result.tiers.sm.bytes.length > 0 && result.tiers.sm.bytes.length < result.tiers.lg.bytes.length);
	assertEquals(new TextDecoder().decode(result.full!.bytes.slice(8, 12)), "WEBP");
	assert(result.blurhash && result.blurhash.length >= 6);
	assert(result.colors?.average.startsWith("#"));
});

Deno.test("runImageJob(render): a showcase crop is exactly 16:10 and never upscaled", async () => {
	const png = await asPng(quadrants(800, 800));
	const result = await runImageJob({
		kind: "render",
		bytes: png,
		mime: "image/png",
		purpose: "showcase",
		crop: { zoom: 1, rotation: 0, cx: 0, cy: 0 },
	});
	assertEquals([result.full!.width, result.full!.height], [800, 500]);
	assertEquals([result.tiers.lg.width, result.tiers.lg.height], [800, 500]);
	assertEquals([result.tiers.sm.width, result.tiers.sm.height], [480, 300]);
});

Deno.test("runImageJob(ingest): a library upload gets three tiers and keeps its dimensions", async () => {
	const webp = await asWebp(quadrants(1400, 700), 90);
	const result = await runImageJob({ kind: "ingest", bytes: webp, mime: "image/webp" });
	assertEquals([result.source.width, result.source.height], [1400, 700]);
	assertEquals(result.full, null);
	assertEquals([result.tiers.sm.width, result.tiers.md.width, result.tiers.lg.width], [320, 1280, 1400]);
});
