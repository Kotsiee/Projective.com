import { publicObjectUrl } from "../../core/storage-url.ts";
import { uploadObject } from "../../core/storage-signed.ts";
import { guardedFetch, type LinkTransport } from "./link-fetch.ts";

/**
 * link-favicon — a link card's icon, RE-HOSTED in `public_assets` and never hotlinked: a hotlinked
 * icon sends every reader's IP address to a host the link's author chose.
 *
 * Only raster images survive, identified by their bytes rather than the origin's `Content-Type`:
 * PNG, JPEG, GIF and WebP pass as they are, a modern `.ico` gives up the PNG it carries, and SVG is
 * refused outright — a script-bearing image served from the platform's own bucket is a stored XSS.
 * Objects are content-addressed, so a thousand links to one site store one icon.
 */

/** Maximum bytes accepted for a favicon. */
export const MAX_FAVICON_BYTES = 64 * 1024;

const BUCKET = "public_assets";
const FOLDER = "platform/link-favicons";

/** A raster image's type, identified from its first bytes. */
export interface SniffedImage {
	bytes: Uint8Array;
	mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
	ext: "png" | "jpg" | "gif" | "webp";
}

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** The PNG an `.ico` carries (the largest), or null when it holds only BMP frames. */
export function pngFromIco(bytes: Uint8Array): Uint8Array | null {
	if (bytes.length < 6 || !startsWith(bytes, [0, 0, 1, 0])) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const count = view.getUint16(4, true);
	let best: Uint8Array | null = null;
	for (let i = 0; i < count; i++) {
		const entry = 6 + i * 16;
		if (entry + 16 > bytes.length) break;
		const size = view.getUint32(entry + 8, true);
		const offset = view.getUint32(entry + 12, true);
		if (offset + size > bytes.length || size < 8) continue;
		const frame = bytes.subarray(offset, offset + size);
		if (startsWith(frame, [0x89, 0x50, 0x4e, 0x47]) && (!best || frame.length > best.length)) {
			best = frame;
		}
	}
	return best ? best.slice() : null;
}

/** Identify a raster favicon from its bytes; null for anything else (SVG and BMP included). */
export function sniffFavicon(bytes: Uint8Array): SniffedImage | null {
	if (bytes.length < 8) return null;
	if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
		return { bytes, mime: "image/png", ext: "png" };
	}
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { bytes, mime: "image/jpeg", ext: "jpg" };
	if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return { bytes, mime: "image/gif", ext: "gif" };
	if (
		startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
	) {
		return { bytes, mime: "image/webp", ext: "webp" };
	}
	const png = pngFromIco(bytes);
	return png ? sniffFavicon(png) : null;
}

/** The content address of a favicon's bytes. */
export async function faviconPath(image: SniffedImage): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(image.bytes)));
	const hex = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
	return `${FOLDER}/${hex}.${image.ext}`;
}

/**
 * Fetch a page's icon under the SAME guards as the page and re-host it. Null when there is no usable
 * raster icon or storage refuses — the card then draws the generic link glyph.
 */
export async function rehostFavicon(
	iconUrl: string,
	deadline: number,
	transport?: LinkTransport,
): Promise<string | null> {
	const fetched = await guardedFetch(iconUrl, {
		maxBytes: MAX_FAVICON_BYTES,
		deadline,
		accept: "image/avif,image/webp,image/png,image/*;q=0.8",
		transport,
	});
	if (!fetched.ok || fetched.page.status !== 200 || fetched.page.truncated) return null;
	const image = sniffFavicon(fetched.page.body);
	if (!image) return null;
	const path = await faviconPath(image);
	const stored = await uploadObject(BUCKET, path, image.bytes, image.mime, {
		upsert: true,
		immutable: true,
	});
	return stored ? publicObjectUrl(BUCKET, path) : null;
}
