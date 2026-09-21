/**
 * images.ts — read an image's dimensions from its header bytes.
 *
 * The seed writes a real `AssetMetadata` envelope on every `files.items` row it creates
 * (`{ version: 1, media: { kind: "image", width, height, … } }`), because `ImageMetadataSchema` makes
 * `width`/`height` REQUIRED positive integers and a row that fails its own schema is a row the file
 * hub cannot render. That needs the dimensions, and the only honest source is the file itself.
 *
 * Header parsing only — no decoding. JPEG (SOF markers), PNG (IHDR), WebP (VP8 / VP8L / VP8X) and
 * AVIF (the `ispe` property box) are the four formats in `test_images/`. Anything unrecognised
 * returns `null`, and the caller writes a `generic` envelope rather than guessing a size.
 */

export interface ImageSize {
	width: number;
	height: number;
}

export function imageSize(bytes: Uint8Array): ImageSize | null {
	if (bytes.length < 24) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const ascii = (at: number, len: number) => String.fromCharCode(...bytes.subarray(at, at + len));

	// PNG: 8-byte signature, then the IHDR chunk carries width/height at offsets 16 and 20.
	if (ascii(1, 3) === "PNG") {
		return { width: view.getUint32(16), height: view.getUint32(20) };
	}

	// JPEG: walk the marker segments to the first SOFn (baseline/progressive) frame header.
	if (bytes[0] === 0xff && bytes[1] === 0xd8) {
		let at = 2;
		while (at + 9 < bytes.length) {
			if (bytes[at] !== 0xff) {
				at++;
				continue;
			}
			const marker = bytes[at + 1];
			if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
				at += 2;
				continue;
			}
			const len = view.getUint16(at + 2);
			const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 &&
				marker !== 0xcc;
			if (isSof) {
				return { height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
			}
			at += 2 + len;
		}
		return null;
	}

	// WebP: RIFF container; the first chunk after "WEBP" names the bitstream variant.
	if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
		const chunk = ascii(12, 4);
		if (chunk === "VP8X") {
			const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
			const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
			return { width: w, height: h };
		}
		if (chunk === "VP8L") {
			const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
			const w = 1 + (((b1 & 0x3f) << 8) | b0);
			const h = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
			return { width: w, height: h };
		}
		if (chunk === "VP8 ") {
			return {
				width: view.getUint16(26, true) & 0x3fff,
				height: view.getUint16(28, true) & 0x3fff,
			};
		}
		return null;
	}

	// AVIF / HEIF: an ISO-BMFF file whose `ispe` (image spatial extents) box carries the size.
	if (ascii(4, 4) === "ftyp") {
		for (let at = 0; at + 12 <= bytes.length; at++) {
			if (ascii(at, 4) === "ispe") {
				return { width: view.getUint32(at + 8), height: view.getUint32(at + 12) };
			}
		}
		return null;
	}

	return null;
}

/** MIME type by extension for the four seed formats. */
export function mimeOf(filename: string): string {
	const ext = filename.toLowerCase().split(".").pop() ?? "";
	switch (ext) {
		case "jpg":
		case "jpeg":
			return "image/jpeg";
		case "png":
			return "image/png";
		case "webp":
			return "image/webp";
		case "avif":
			return "image/avif";
		case "gif":
			return "image/gif";
		default:
			return "application/octet-stream";
	}
}
