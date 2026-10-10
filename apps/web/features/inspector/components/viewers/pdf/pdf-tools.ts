import { type Signal, signal } from "@preact/signals";
import type { PdfFit, PdfRotation } from "../../../core/pdf-zoom.ts";
import type { FindMatch } from "./pdf-find.ts";
import type { PdfEngine } from "./pdf-engine.ts";

/**
 * pdf-tools — the PDF canvas's signal state, shared by its stage (which draws) and its panel
 * controls (which drive). Created during SSR, so it holds signals only; the live engine arrives in
 * {@link PdfTools.engine} once the document is open in the browser.
 */

// #region Types
/** A destination inside the document: a named destination or an explicit one. */
export type PdfDest = string | readonly unknown[];

/** One entry of the document outline (bookmarks). */
export interface PdfOutlineItem {
	key: string;
	title: string;
	dest: PdfDest | null;
	url: string | null;
	items: readonly PdfOutlineItem[];
}

/** Find-in-document state. */
export interface PdfFindState {
	/** Whether the find bar is showing. */
	open: Signal<boolean>;
	query: Signal<string>;
	matches: Signal<readonly FindMatch[]>;
	/** Index into `matches` of the selected hit, or `-1`. */
	active: Signal<number>;
	/** True while pages are still being searched. */
	searching: Signal<boolean>;
	/** Bumped to ask the find bar to take focus. */
	focusRequest: Signal<number>;
}

/** Everything the PDF stage and its controls share. */
export interface PdfTools {
	/** Pages in the document; `0` until it opens. */
	pageCount: Signal<number>;
	/** The page most in view (1-based). */
	page: Signal<number>;
	/** 1 is actual size. */
	zoom: Signal<number>;
	fit: Signal<PdfFit>;
	rotation: Signal<PdfRotation>;
	thumbnails: Signal<boolean>;
	outline: Signal<readonly PdfOutlineItem[]>;
	find: PdfFindState;
	printOpen: Signal<boolean>;
	/** Bumped whenever page sizes change, so size-dependent views re-read them. */
	layoutVersion: Signal<number>;
	/** The live engine, once the document is open. */
	engine: Signal<PdfEngine | null>;
}
// #endregion

/** Fresh PDF tool state: fit to width, no rotation, panels closed. Safe during SSR. */
export function createPdfTools(): PdfTools {
	return {
		pageCount: signal(0),
		page: signal(1),
		zoom: signal(1),
		fit: signal<PdfFit>("width"),
		rotation: signal<PdfRotation>(0),
		thumbnails: signal(false),
		outline: signal<readonly PdfOutlineItem[]>([]),
		find: {
			open: signal(false),
			query: signal(""),
			matches: signal<readonly FindMatch[]>([]),
			active: signal(-1),
			searching: signal(false),
			focusRequest: signal(0),
		},
		printOpen: signal(false),
		layoutVersion: signal(0),
		engine: signal<PdfEngine | null>(null),
	};
}
