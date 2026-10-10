/**
 * pdf-zoom — the pure geometry behind the PDF canvas: zoom steps and fits, rotation, the continuous
 * vertical page layout, which pages a scroll position shows, and the scroll anchor that keeps the
 * reader's place when the zoom or the rotation changes. No DOM; every figure is CSS pixels.
 */

// #region Types
/** How the zoom is chosen: fit the page width, fit the whole page, 100%, or set by the reader. */
export type PdfFit = "width" | "page" | "actual" | "custom";

/** A quarter-turn the reader applied on top of each page's own rotation. */
export type PdfRotation = 0 | 90 | 180 | 270;

/** A width and a height. */
export interface Size {
	width: number;
	height: number;
}

/** One page at zoom 1 with no rotation: its size in PDF points (user unit applied) and its own `/Rotate`. */
export interface PdfPageBox {
	width: number;
	height: number;
	rotate: number;
}

/** Fixed spacing of the page column: the gap between pages and the padding around them. */
export interface PdfSpacing {
	gap: number;
	padding: number;
}

/** Where every page sits in the scrolled column at one zoom and rotation. */
export interface PdfLayout {
	/** Top edge of each page, from the top of the column. */
	tops: readonly number[];
	/** Displayed size of each page. */
	sizes: readonly Size[];
	/** Height of the whole column, padding included. */
	height: number;
	/** Width of the column: the widest page plus padding on both sides. */
	width: number;
	spacing: PdfSpacing;
}

/** A place in the document that survives a re-layout: a page and how far down it. */
export interface ScrollAnchor {
	page: number;
	fraction: number;
}
// #endregion

// #region Zoom
/** CSS pixels per PDF point: 100% shows a page at its printed size on a 96 dpi screen. */
export const PDF_CSS_UNITS = 96 / 72;

/** Smallest zoom (10%). */
export const PDF_ZOOM_MIN = 0.1;

/** Largest zoom (800%). */
export const PDF_ZOOM_MAX = 8;

/** The stops the zoom buttons and keys walk through. */
export const PDF_ZOOM_STEPS: readonly number[] = [
	0.1,
	0.25,
	0.33,
	0.5,
	0.67,
	0.75,
	0.8,
	0.9,
	1,
	1.1,
	1.25,
	1.5,
	1.75,
	2,
	2.5,
	3,
	4,
	5,
	6,
	8,
];

const STEP_EPSILON = 0.005;

/** Keep a zoom inside the supported range. */
export function clampZoom(zoom: number): number {
	if (!Number.isFinite(zoom)) return 1;
	return Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, zoom));
}

/** The next stop above (`1`) or below (`-1`) the current zoom. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
	if (direction === 1) {
		const next = PDF_ZOOM_STEPS.find((step) => step > zoom + STEP_EPSILON);
		return next ?? PDF_ZOOM_MAX;
	}
	for (let i = PDF_ZOOM_STEPS.length - 1; i >= 0; i--) {
		if (PDF_ZOOM_STEPS[i] < zoom - STEP_EPSILON) return PDF_ZOOM_STEPS[i];
	}
	return PDF_ZOOM_MIN;
}

const LINE_PX = 16;
const PAGE_PX = 800;
const WHEEL_PX_PER_DOUBLING = 360;

/** Zoom after one wheel event: exponential, so every notch scales by the same ratio. */
export function wheelZoom(zoom: number, deltaY: number, deltaMode = 0): number {
	const px = deltaMode === 1 ? deltaY * LINE_PX : deltaMode === 2 ? deltaY * PAGE_PX : deltaY;
	return clampZoom(zoom * 2 ** (-px / WHEEL_PX_PER_DOUBLING));
}

/** The zoom as a whole percentage, e.g. `"125%"`. */
export function zoomPercent(zoom: number): string {
	return `${Math.round(zoom * 100)}%`;
}
// #endregion

// #region Rotation
/** A rotation turned a quarter clockwise (`1`) or counter-clockwise (`-1`). */
export function rotateBy(rotation: PdfRotation, direction: 1 | -1): PdfRotation {
	return normalizeRotation(rotation + direction * 90);
}

/** Any angle snapped to the nearest quarter-turn in `[0, 360)`. */
export function normalizeRotation(degrees: number): PdfRotation {
	if (!Number.isFinite(degrees)) return 0;
	const quarter = ((Math.round(degrees / 90) % 4) + 4) % 4;
	return (quarter * 90) as PdfRotation;
}

/** The angle a page is drawn at: its own rotation plus the reader's. */
export function totalRotation(box: PdfPageBox, rotation: PdfRotation): PdfRotation {
	return normalizeRotation(box.rotate + rotation);
}

/** The size a page is drawn at. */
export function displaySize(box: PdfPageBox, rotation: PdfRotation, zoom: number): Size {
	const turned = totalRotation(box, rotation) % 180 !== 0;
	const scale = zoom * PDF_CSS_UNITS;
	return {
		width: (turned ? box.height : box.width) * scale,
		height: (turned ? box.width : box.height) * scale,
	};
}

/** Width over height of a page as drawn. */
export function displayRatio(box: PdfPageBox, rotation: PdfRotation): number {
	const size = displaySize(box, rotation, 1);
	return size.height > 0 ? size.width / size.height : 1;
}
// #endregion

// #region Fit
/**
 * The zoom that fits one page into the viewport: its width (`"width"`) or all of it (`"page"`),
 * leaving `spacing.padding` clear on each side.
 */
export function fitZoom(
	fit: "width" | "page",
	box: PdfPageBox,
	rotation: PdfRotation,
	viewport: Size,
	spacing: PdfSpacing,
): number {
	const page = displaySize(box, rotation, 1);
	if (page.width <= 0 || page.height <= 0) return 1;
	const room = Math.max(1, viewport.width - 2 * spacing.padding);
	const byWidth = room / page.width;
	if (fit === "width") return clampZoom(byWidth);
	const tall = Math.max(1, viewport.height - 2 * spacing.padding);
	return clampZoom(Math.min(byWidth, tall / page.height));
}
// #endregion

// #region Layout
/** Stack every page in one column at the given zoom and rotation. */
export function layoutPages(
	boxes: readonly PdfPageBox[],
	rotation: PdfRotation,
	zoom: number,
	spacing: PdfSpacing,
): PdfLayout {
	const tops: number[] = [];
	const sizes: Size[] = [];
	let y = spacing.padding;
	let widest = 0;
	boxes.forEach((box, i) => {
		const size = displaySize(box, rotation, zoom);
		if (i > 0) y += spacing.gap;
		tops.push(y);
		sizes.push(size);
		y += size.height;
		widest = Math.max(widest, size.width);
	});
	return {
		tops,
		sizes,
		height: y + spacing.padding,
		width: widest + 2 * spacing.padding,
		spacing,
	};
}

function lastTopAtOrAbove(layout: PdfLayout, y: number): number {
	let lo = 0;
	let hi = layout.tops.length - 1;
	let found = 0;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (layout.tops[mid] <= y) {
			found = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return found;
}

/** The pages (0-based, inclusive) any part of which is inside the viewport, or `null` for none. */
export function visiblePages(
	layout: PdfLayout,
	scrollTop: number,
	viewportHeight: number,
): { first: number; last: number } | null {
	const count = layout.tops.length;
	if (count === 0 || viewportHeight <= 0) return null;
	const bottom = scrollTop + viewportHeight;
	let first = lastTopAtOrAbove(layout, scrollTop);
	if (layout.tops[first] + layout.sizes[first].height <= scrollTop && first < count - 1) first++;
	let last = first;
	while (last + 1 < count && layout.tops[last + 1] < bottom) last++;
	if (layout.tops[first] >= bottom) return null;
	return { first, last };
}

/** The page (0-based) showing the most area in the viewport; the earlier page wins a tie. */
export function currentPage(layout: PdfLayout, scrollTop: number, viewportHeight: number): number {
	const range = visiblePages(layout, scrollTop, viewportHeight);
	if (!range) return 0;
	const bottom = scrollTop + viewportHeight;
	let best = range.first;
	let bestArea = -1;
	for (let i = range.first; i <= range.last; i++) {
		const top = layout.tops[i];
		const shown = Math.min(bottom, top + layout.sizes[i].height) - Math.max(scrollTop, top);
		if (shown > bestArea + 0.5) {
			best = i;
			bestArea = shown;
		}
	}
	return best;
}

/** The page and fraction at a content offset `y`. */
export function anchorAt(layout: PdfLayout, y: number): ScrollAnchor {
	if (layout.tops.length === 0) return { page: 0, fraction: 0 };
	const page = lastTopAtOrAbove(layout, y);
	const height = layout.sizes[page].height;
	const fraction = height > 0 ? (y - layout.tops[page]) / height : 0;
	return { page, fraction: Math.min(1, Math.max(0, fraction)) };
}

/** The content offset of an anchor in a (new) layout. */
export function anchorOffset(layout: PdfLayout, anchor: ScrollAnchor): number {
	if (layout.tops.length === 0) return 0;
	const page = Math.min(layout.tops.length - 1, Math.max(0, anchor.page));
	return layout.tops[page] + anchor.fraction * layout.sizes[page].height;
}

/**
 * Where to scroll a re-scaled axis so the point `pointer` px into the viewport stays put: the
 * content under it moves from `oldExtent` to `newExtent` proportionally.
 */
export function rescaleScroll(
	scroll: number,
	pointer: number,
	oldExtent: number,
	newExtent: number,
): number {
	if (oldExtent <= 0) return 0;
	return Math.max(0, ((scroll + pointer) * newExtent) / oldExtent - pointer);
}
// #endregion
