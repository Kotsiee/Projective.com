/**
 * pdf-print — the pure decisions behind printing a PDF: which pages a range like `"1-3, 7"` means,
 * how sharp each page is rasterised, and which way up each printed sheet goes. The DOM job that
 * draws and prints the pages lives beside the PDF canvas.
 */

// #region Options
/** Which pages to print. */
export type PrintRange = "all" | "current" | "custom";

/** Raster quality of the printed pages. */
export type PrintQuality = "draft" | "standard" | "high";

/** Whether each page is scaled to the sheet or printed at its own size. */
export type PrintFit = "page" | "actual";

/** Dots per inch for each quality. */
export const PRINT_DPI: Readonly<Record<PrintQuality, number>> = {
	draft: 150,
	standard: 200,
	high: 300,
};

/** Upper bound on one page's raster, in pixels, so a huge page cannot exhaust canvas memory. */
export const PRINT_MAX_PIXELS = 4096 * 4096 * 2;
// #endregion

// #region Ranges
/** The pages to print (1-based, ascending, unique), or why the range was refused. */
export type PageRangeResult =
	| { ok: true; pages: number[] }
	| { ok: false; error: string };

const RANGE_TOKEN = /^(\d*)\s*[-–—]\s*(\d*)$/;
const PAGE_TOKEN = /^\d+$/;

function refuse(error: string): PageRangeResult {
	return { ok: false, error };
}

function pastEnd(page: number, pageCount: number): string {
	return `Page ${page} is past the end — this document has ${pageCount} ${
		pageCount === 1 ? "page" : "pages"
	}.`;
}

/**
 * Read a custom page range: comma-separated pages and ranges, e.g. `"1-3, 7"`. An open range runs to
 * the end (`"5-"`) or from the start (`"-3"`). Overlaps merge; the result is in document order.
 */
export function parsePageRange(input: string, pageCount: number): PageRangeResult {
	const text = input.trim();
	if (text.length === 0) return refuse("Enter the pages to print, for example 1-3, 7.");
	if (pageCount < 1) return refuse("This document has no pages to print.");
	const picked = new Set<number>();
	for (const raw of text.split(/[,;]/)) {
		const token = raw.trim();
		if (token.length === 0) continue;
		if (PAGE_TOKEN.test(token)) {
			const page = Number(token);
			if (page < 1) return refuse("Pages are numbered from 1.");
			if (page > pageCount) return refuse(pastEnd(page, pageCount));
			picked.add(page);
			continue;
		}
		const range = RANGE_TOKEN.exec(token);
		if (!range || (range[1] === "" && range[2] === "")) {
			return refuse(`"${token}" isn't a page or a range, for example 2-5.`);
		}
		const from = range[1] === "" ? 1 : Number(range[1]);
		const to = range[2] === "" ? pageCount : Number(range[2]);
		if (from < 1 || to < 1) return refuse("Pages are numbered from 1.");
		if (from > to) {
			return refuse(`"${token}" runs backwards — write it low to high, e.g. ${to}-${from}.`);
		}
		if (from > pageCount) return refuse(pastEnd(from, pageCount));
		if (to > pageCount) return refuse(pastEnd(to, pageCount));
		for (let page = from; page <= to; page++) picked.add(page);
	}
	if (picked.size === 0) return refuse("Enter the pages to print, for example 1-3, 7.");
	return { ok: true, pages: [...picked].sort((a, b) => a - b) };
}

/** The pages a range choice selects. `current` is 1-based. */
export function printPages(
	range: PrintRange,
	custom: string,
	current: number,
	pageCount: number,
): PageRangeResult {
	if (pageCount < 1) return refuse("This document has no pages to print.");
	if (range === "all") {
		return {
			ok: true,
			pages: Array.from({ length: pageCount }, (_, i) => i + 1),
		};
	}
	if (range === "current") {
		return { ok: true, pages: [Math.min(pageCount, Math.max(1, Math.round(current)))] };
	}
	return parsePageRange(custom, pageCount);
}
// #endregion

// #region Raster
/**
 * The render scale for a page of `width × height` points at `dpi`, lowered when the raster would
 * pass {@link PRINT_MAX_PIXELS}.
 */
export function printScale(
	width: number,
	height: number,
	dpi: number,
	maxPixels = PRINT_MAX_PIXELS,
): number {
	const scale = dpi / 72;
	const pixels = width * scale * height * scale;
	if (pixels <= maxPixels || pixels <= 0) return scale;
	return scale * Math.sqrt(maxPixels / pixels);
}

/** Which way up a sheet prints, following the page. Square pages print portrait. */
export function printOrientation(width: number, height: number): "portrait" | "landscape" {
	return width > height ? "landscape" : "portrait";
}
// #endregion
