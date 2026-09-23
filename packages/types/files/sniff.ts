/**
 * files.sniff — what a file ACTUALLY is, read from its first bytes.
 *
 * The MIME type a browser reports at upload is a guess from the file's name — rename `payload.exe`
 * to `photo.jpg` and it arrives as `image/jpeg`. The quarantine step therefore never trusts it: it
 * reads the magic number at the head of the stored object and decides from that. A declared type
 * that disagrees with the bytes is a refusal, not a correction, because a file that lies about what
 * it is has no business being served to anyone.
 *
 * Pure and dependency-free (a byte array in, a verdict out), so the browser can pre-check a file
 * before spending an upload on it and the server makes the final call with the same code.
 */

// #region Types

/** The families the platform processes. */
export type SniffedFamily = "image" | "video" | "executable" | "markup";

/** A recognised format. */
export interface Sniffed {
	/** The canonical MIME type for the format. */
	mime: string;
	family: SniffedFamily;
	/** The canonical extension, without a dot. */
	ext: string;
}

/** How many leading bytes {@link sniffBytes} needs to recognise every format below. */
export const SNIFF_BYTES = 64;

// #endregion

// #region Sniffer

/**
 * Recognise a file from its leading bytes; `null` when the format is not one the platform knows.
 *
 * `executable` and `markup` are recognised so they can be REFUSED by name (a Windows PE, an ELF, a
 * Mach-O binary; an HTML or SVG document, which a browser will execute script from when served from
 * our origin) rather than merely falling through as "unknown".
 */
export function sniffBytes(head: Uint8Array): Sniffed | null {
	const b = head;
	const at = (i: number) => (i < b.length ? b[i] : -1);
	const ascii = (start: number, text: string) => {
		for (let i = 0; i < text.length; i++) if (at(start + i) !== text.charCodeAt(i)) return false;
		return true;
	};

	// #region Images
	if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
		return { mime: "image/jpeg", family: "image", ext: "jpg" };
	}
	if (
		at(0) === 0x89 && ascii(1, "PNG") && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a &&
		at(7) === 0x0a
	) {
		return { mime: "image/png", family: "image", ext: "png" };
	}
	if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) {
		return { mime: "image/gif", family: "image", ext: "gif" };
	}
	if (ascii(0, "RIFF") && ascii(8, "WEBP")) {
		return { mime: "image/webp", family: "image", ext: "webp" };
	}
	// #endregion

	// #region ISO-BMFF (`ftyp`): AVIF / HEIC stills, MP4 / QuickTime video
	if (ascii(4, "ftyp")) {
		const brand = String.fromCharCode(at(8), at(9), at(10), at(11));
		if (brand === "avif" || brand === "avis") {
			return { mime: "image/avif", family: "image", ext: "avif" };
		}
		if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)) {
			return { mime: "image/heic", family: "image", ext: "heic" };
		}
		if (brand === "qt  ") return { mime: "video/quicktime", family: "video", ext: "mov" };
		return { mime: "video/mp4", family: "video", ext: "mp4" };
	}
	// #endregion

	// #region Matroska / WebM (EBML)
	if (at(0) === 0x1a && at(1) === 0x45 && at(2) === 0xdf && at(3) === 0xa3) {
		// The DocType sits a few bytes into the EBML header; "webm" anywhere in the head is enough to
		// tell the two apart, and anything else in this family is Matroska.
		const text = String.fromCharCode(...b.slice(0, Math.min(b.length, SNIFF_BYTES)));
		return text.includes("webm")
			? { mime: "video/webm", family: "video", ext: "webm" }
			: { mime: "video/x-matroska", family: "video", ext: "mkv" };
	}
	// #endregion

	// #region Refusable by name
	if (at(0) === 0x4d && at(1) === 0x5a) return { mime: "application/x-msdownload", family: "executable", ext: "exe" };
	if (at(0) === 0x7f && ascii(1, "ELF")) return { mime: "application/x-elf", family: "executable", ext: "elf" };
	if (
		(at(0) === 0xfe && at(1) === 0xed && at(2) === 0xfa && (at(3) === 0xce || at(3) === 0xcf)) ||
		(at(0) === 0xcf && at(1) === 0xfa && at(2) === 0xed && at(3) === 0xfe) ||
		(at(0) === 0xca && at(1) === 0xfe && at(2) === 0xba && at(3) === 0xbe)
	) {
		return { mime: "application/x-mach-binary", family: "executable", ext: "macho" };
	}
	const lead = leadingText(b).toLowerCase();
	if (lead.startsWith("<svg") || (lead.startsWith("<?xml") && lead.includes("<svg"))) {
		return { mime: "image/svg+xml", family: "markup", ext: "svg" };
	}
	if (lead.startsWith("<!doctype html") || lead.startsWith("<html") || lead.startsWith("<script")) {
		return { mime: "text/html", family: "markup", ext: "html" };
	}
	// #endregion

	return null;
}

/** The head as text with a UTF-8 BOM and leading whitespace skipped — for the markup checks only. */
function leadingText(b: Uint8Array): string {
	let i = 0;
	if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
	while (i < b.length && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
	return String.fromCharCode(...b.slice(i, Math.min(b.length, i + 48)));
}

// #endregion

// #region What the media pipeline accepts

/** Still formats the pipeline can decode and re-encode. */
export const PROCESSABLE_IMAGE_MIME: readonly string[] = [
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
];

/** Video containers the showcase accepts (stored as uploaded — never transcoded). */
export const SHOWCASE_VIDEO_MIME: readonly string[] = ["video/mp4", "video/webm", "video/quicktime"];

/**
 * The refusal sentence for a format the pipeline recognises but will not process, or `null` when it
 * is processable. Written for the person who uploaded it: what went wrong, and what to do instead.
 */
export function unsupportedReason(sniffed: Sniffed | null, allowVideo: boolean): string | null {
	if (!sniffed) return "This file isn't a picture we can read. Upload a JPG, PNG, WebP or GIF.";
	if (sniffed.family === "executable") return "Programs can't be uploaded here.";
	if (sniffed.family === "markup") return "SVG and HTML files can't be used as profile media.";
	if (sniffed.family === "video") {
		if (!allowVideo) return "This slot takes a still image. Choose a picture instead.";
		return SHOWCASE_VIDEO_MIME.includes(sniffed.mime)
			? null
			: "Only MP4, WebM and MOV videos can be shown in a showcase.";
	}
	if (sniffed.mime === "image/heic" || sniffed.mime === "image/avif") {
		return "HEIC and AVIF photos can't be processed yet — export it as JPG or PNG and upload that.";
	}
	return PROCESSABLE_IMAGE_MIME.includes(sniffed.mime)
		? null
		: "This picture format isn't supported. Upload a JPG, PNG, WebP or GIF.";
}

// #endregion
