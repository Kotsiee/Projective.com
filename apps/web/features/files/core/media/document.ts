/// <reference lib="dom" />

import type { DocumentMetadata } from "../../types/file-types.ts";
import {
	describePixels,
	POSTER_MAX_CHARS,
	POSTER_MAX_EDGE,
	POSTER_QUALITY,
	samplePixels,
} from "./image.ts";

/**
 * document — what can be learned about a paged document without shipping a PDF reader.
 *
 * **No PDF.js dependency is added, and that is the design rather than a shortcut.** A renderer is
 * megabytes of WASM and JavaScript that would be downloaded by every person who uploads a contract,
 * to produce a thumbnail. So this module DETECTS a reader that some other part of the page has
 * already initialised and uses it, and otherwise returns a row that says out loud what it could not
 * read — a null page count with a note, never a confident `1`, which would print a sentence about a
 * document nobody opened.
 *
 * ## The byte-level count is a HEURISTIC and is labelled as one
 *
 * A PDF's page objects are `/Type /Page` dictionaries, and in a plain uncompressed file counting them
 * is exact. Since PDF 1.5 those dictionaries are routinely packed into compressed object streams,
 * where they are invisible to any scan that does not inflate them — so a file can legitimately hold
 * two hundred pages and match zero times. Zero matches is therefore reported as `null` ("not read"),
 * never as a page count, and a file too large to scan whole is not scanned at all: a count taken from
 * the first 16 MB of a 200 MB document is not a partial answer, it is a wrong one.
 */

// #region Bounds
/**
 * The largest file the byte scan will read.
 *
 * Page objects are scattered throughout a PDF rather than gathered in a header, so a partial read
 * cannot produce a partial count — past this bound the count is simply not attempted.
 */
const SCAN_MAX_BYTES = 16 * 1024 * 1024;

/** The largest file handed to a detected reader. Parsing is as memory-hungry as decoding audio. */
const RENDER_MAX_BYTES = 32 * 1024 * 1024;

/** The PDF magic. A file that does not start with it is not one, whatever its name claims. */
const PDF_MAGIC = "%PDF-";
// #endregion

// #region Reader detection
/**
 * The slice of the PDF.js surface this module uses, declared structurally.
 *
 * Structural because the library is not a dependency and may never be present: naming the shape is
 * what lets the call sites type-check against a global that is `undefined` at runtime in this build,
 * exactly as `UploadDrawer` types `XMLHttpRequest`.
 */
interface PdfViewport {
	width: number;
	height: number;
}

interface PdfPage {
	getViewport(params: { scale: number }): PdfViewport;
	render(params: { canvasContext: unknown; viewport: PdfViewport }): { promise: Promise<void> };
	cleanup?(): void;
}

interface PdfDocument {
	numPages: number;
	getPage(pageNumber: number): Promise<PdfPage>;
	destroy?(): Promise<void>;
}

interface PdfLibrary {
	getDocument(params: { data: ArrayBuffer }): { promise: Promise<PdfDocument> };
	GlobalWorkerOptions?: { workerSrc?: string };
}

/**
 * The initialised PDF reader on this page, or `null`.
 *
 * A library present but with no `workerSrc` set has not been initialised — PDF.js falls back to
 * parsing on the main thread there, which freezes the tab for the length of the document. Refusing
 * that case is why the check is for an initialised reader rather than for the global's existence.
 */
function detectPdfReader(): PdfLibrary | null {
	const library = (globalThis as { pdfjsLib?: PdfLibrary }).pdfjsLib;
	if (!library || typeof library.getDocument !== "function") return null;
	if (!library.GlobalWorkerOptions?.workerSrc) return null;
	return library;
}
// #endregion

// #region Byte scan
/**
 * Count `/Type /Page` dictionaries in the raw bytes.
 *
 * `latin1` so every byte maps to one code unit: a UTF-8 decode would turn a document's binary streams
 * into replacement characters and could fuse or split the very tokens being counted. The negative
 * lookahead is what keeps `/Pages` — the page TREE node, of which there is one per document — out of
 * the tally.
 *
 * `null` for zero matches, because zero is what a compressed-object-stream PDF produces and it is not
 * a page count. See the module note.
 */
function countPagesInBytes(bytes: Uint8Array): number | null {
	let text: string;
	try {
		text = new TextDecoder("latin1").decode(bytes);
	} catch {
		return null;
	}
	const matches = text.match(/\/Type\s*\/Page(?![sA-Za-z])/g);
	return matches && matches.length > 0 ? matches.length : null;
}
// #endregion

// #region Page-one raster
/** A rendered first page: the picture, its placeholder, and the size it was rendered at. */
interface PageRaster {
	posterDataUrl: string | null;
	blurhash: string | null;
	width: number;
	height: number;
}

/**
 * Render page one through a detected reader.
 *
 * Scaled so its long edge lands on {@link POSTER_MAX_EDGE} — a page rendered at its native 72 dpi is
 * both too small to read and too large to inline, and the scale is the only knob that fixes either.
 */
async function renderFirstPage(page: PdfPage): Promise<PageRaster | null> {
	if (typeof document === "undefined") return null;
	const natural = page.getViewport({ scale: 1 });
	if (!(natural.width > 0) || !(natural.height > 0)) return null;

	// Upscaling is allowed: a page is vector artwork rendered at 72 dpi, so a small one gains real
	// detail from a larger raster rather than the blur a bitmap would give.
	const viewport = page.getViewport({
		scale: POSTER_MAX_EDGE / Math.max(natural.width, natural.height),
	});
	const width = Math.max(1, Math.round(viewport.width));
	const height = Math.max(1, Math.round(viewport.height));

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;

	await page.render({ canvasContext: ctx, viewport }).promise;

	let posterDataUrl: string | null = null;
	try {
		const encoded = canvas.toDataURL("image/jpeg", POSTER_QUALITY);
		posterDataUrl = encoded.length <= POSTER_MAX_CHARS ? encoded : null;
	} catch {
		posterDataUrl = null;
	}

	const sample = samplePixels(canvas, width, height);
	const blurhash = sample ? describePixels(sample).blurhash : null;

	return { posterDataUrl, blurhash, width, height };
}
// #endregion

// #region Entry point
/** A document row that knows only that it is a document. Every field it could not read stays null. */
function unread(): DocumentMetadata {
	return {
		kind: "document",
		pageCount: null,
		posterDataUrl: null,
		blurhash: null,
		width: null,
		height: null,
	};
}

/**
 * Everything readable about a document file.
 *
 * `null` means the file is not one this module recognises, which the caller turns into a `generic`
 * row. A file that IS a document but yielded nothing gets a document row with every field null —
 * "this is a paged document and nothing further was read" is a more useful fact than "unknown", and
 * it is the one the SSOT models.
 */
export async function readDocumentMetadata(
	file: File,
	notes: string[],
): Promise<DocumentMetadata | null> {
	let head: string;
	try {
		head = await file.slice(0, PDF_MAGIC.length).text();
	} catch {
		notes.push("The document could not be read from disk.");
		return unread();
	}
	if (head !== PDF_MAGIC) {
		notes.push("Only PDFs are read in the browser, so this document's page count is unknown.");
		return unread();
	}

	let pageCount: number | null = null;
	if (file.size <= SCAN_MAX_BYTES) {
		try {
			pageCount = countPagesInBytes(new Uint8Array(await file.arrayBuffer()));
		} catch {
			pageCount = null;
		}
		if (pageCount === null) {
			notes.push("This PDF stores its pages compressed, so they could not be counted.");
		}
	} else {
		notes.push("This PDF is too large to scan in the browser, so its pages were not counted.");
	}

	const reader = detectPdfReader();
	if (!reader) {
		notes.push("No PDF reader is loaded, so the first page was not turned into a preview.");
		return { ...unread(), pageCount };
	}
	if (file.size > RENDER_MAX_BYTES) {
		notes.push("This PDF is too large to render in the browser, so it has no preview.");
		return { ...unread(), pageCount };
	}

	let loaded: PdfDocument | null = null;
	try {
		loaded = await reader.getDocument({ data: await file.arrayBuffer() }).promise;
		const page = await loaded.getPage(1);
		const raster = await renderFirstPage(page);
		page.cleanup?.();
		if (!raster) {
			notes.push("The first page could not be rendered, so this PDF has no preview.");
			return { ...unread(), pageCount: pageCount ?? loaded.numPages };
		}
		return {
			kind: "document",
			// The reader's own count is authoritative and replaces the byte-scan heuristic wherever it
			// is available — the heuristic exists for the case where no reader is.
			pageCount: loaded.numPages > 0 ? loaded.numPages : pageCount,
			posterDataUrl: raster.posterDataUrl,
			blurhash: raster.blurhash,
			width: raster.width,
			height: raster.height,
		};
	} catch {
		notes.push("The PDF reader could not open this file, so it has no preview.");
		return { ...unread(), pageCount };
	} finally {
		try {
			await loaded?.destroy?.();
		} catch {
			// Already torn down; the worker frees itself.
		}
	}
}
// #endregion
