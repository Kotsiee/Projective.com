/**
 * Pure geometry for the editorial islands — which heading is "current", how far through the
 * document the reader is — kept out of the islands so the rules are unit-tested without a DOM.
 */
import type { TocEntry } from "@projective/types/content";
import { prefersJumpToFinal } from "../../core/motion.ts";

// #region Table of contents
/** Every id in a TOC tree, in document order (the order the scroll-spy walks). */
export function tocIds(entries: readonly TocEntry[]): string[] {
	return entries.flatMap((entry) => [entry.id, ...tocIds(entry.children)]);
}

/** The text of the entry with `id`, searching the whole tree; `null` when absent. */
export function tocText(entries: readonly TocEntry[], id: string | null): string | null {
	if (id === null) return null;
	for (const entry of entries) {
		if (entry.id === id) return entry.number ? `${entry.number} ${entry.text}` : entry.text;
		const nested = tocText(entry.children, id);
		if (nested !== null) return nested;
	}
	return null;
}

/** A heading's position, as the scroll-spy sees it. */
export interface HeadingPosition {
	id: string;
	/** Its top edge, in viewport pixels (`getBoundingClientRect().top`). */
	top: number;
}

/** Where the scroll-spy draws its reading line. */
export interface ReadingLine {
	/** The line, in viewport pixels: a heading at or above it has been reached. */
	line: number;
	/** The viewport's height. */
	viewport: number;
	/** Whether the page is scrolled to its end. */
	atEnd: boolean;
}

/**
 * The current heading: the last one (in document order) whose top has reached the reading line —
 * `null` while the reader is still above the first. At the very end of the page the last heading
 * that is on screen wins instead, because a short final section can never scroll its heading up to
 * the line, and a table of contents that cannot mark the section the reader is looking at is lying.
 */
export function pickActiveHeading(
	headings: readonly HeadingPosition[],
	at: ReadingLine,
): string | null {
	if (at.atEnd) {
		for (let i = headings.length - 1; i >= 0; i--) {
			if (headings[i].top < at.viewport) return headings[i].id;
		}
	}
	let current: string | null = null;
	for (const heading of headings) {
		if (heading.top <= at.line + 1) current = heading.id;
		else break;
	}
	return current;
}

/**
 * The reading line for a document: a heading counts as reached once it is within a short distance
 * below its own landing position (its scroll margin), so a heading jumped to from the table of
 * contents is current the moment it lands.
 */
export function readingLineFor(scrollMarginTop: number, viewport: number): number {
	return scrollMarginTop + Math.min(96, Math.max(24, viewport * 0.1));
}
// #endregion

// #region Reading progress
/** The geometry {@link readingRatio} reads. */
export interface ReadingGeometry {
	/** The article's top edge, in viewport pixels. */
	top: number;
	/** The article's height. */
	height: number;
	/** The viewport's height. */
	viewport: number;
	/** The pinned chrome's height (the bar's own top edge). */
	chrome: number;
}

/**
 * How far through the article the reader is, `0..1`: `0` while its top is still below the chrome,
 * `1` once its bottom has reached the viewport floor. `null` when the article scrolls less than half
 * a viewport end to end — a page that short gains nothing from a progress bar, so the bar hides and
 * leaves the accessibility tree.
 */
export function readingRatio(g: ReadingGeometry): number | null {
	const travel = g.height - (g.viewport - g.chrome);
	if (travel < g.viewport / 2) return null;
	const ratio = (g.chrome - g.top) / travel;
	return ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
}
// #endregion

// #region Motion
/** Whether either reduced-motion channel is on (the OS query, or the in-app `data-motion`). */
export function motionReduced(): boolean {
	if (prefersJumpToFinal()) return true;
	return typeof document !== "undefined" && document.documentElement.dataset.motion === "reduced";
}
// #endregion
