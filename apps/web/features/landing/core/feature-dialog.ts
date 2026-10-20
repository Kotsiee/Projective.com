/**
 * feature-dialog — the pure half of `/features`' "Try it" dialog, its `?section=` landing and its
 * chapter marker (`flows/LANDING.md` §2.5 note 8, §2.6 notes 3 and 8; work order L5): what a "Try it"
 * link carries, which entry it names, which presses the dialog takes over, how a pressed demo opens
 * (or falls back to its link), when the page scrolls to the chapter a link asked for, and which
 * chapter the reader is in.
 *
 * Shared by the server (`components/FeatureIndex.tsx` writes the attributes) and the
 * `FeatureDemoDialog` island (which reads them), so it holds no browser global.
 */
import type { DemoId } from "./demos/demo-contract.ts";
import {
	featureDemo,
	type FeatureEntry,
	featureHelpHref,
	printedFeatures,
} from "./features-catalogue.ts";

// #region Attributes
/** On a "Try it" link: the demo it opens (`board`, `payments`…). */
export const TRY_DEMO_ATTR = "data-lp-try";

/** On a "Try it" link: the row it belongs to (`work-board`), which names the dialog. */
export const TRY_FEATURE_ATTR = "data-lp-feature";

/** On the chapter `?section=` asked for: the server marks it, the island lands on it. */
export const SECTION_TARGET_ATTR = "data-lp-target";

/** On each chapter navigation link: the chapter it leads to, whose place the island keeps marked. */
export const NAV_CHAPTER_ATTR = "data-lp-chapter";

/**
 * The id of the dialog's intro (the row's line and the stage note): the dialog is described by it,
 * not by its whole body, which holds the demo's every control.
 */
export const FEATURE_DIALOG_INTRO_ID = "lp-fdemo-intro";
// #endregion

// #region Entries
/** What the dialog shows for one row: its demo, its title (the dialog's name) and its words. */
export interface FeatureDemoEntry {
	/** The row's anchor (`work-board`). */
	feature: string;
	demo: DemoId;
	/** The dialog's title: the row's h3. */
	title: string;
	/** The row's §4.12 description, repeated under the title. */
	description: string;
	/** The row's "Learn more" (`/help/…`), or `null`. */
	helpHref: string | null;
}

/** The dialog's entries: every printed row with a demo, in page order. */
export function featureDemoEntries(
	rows: readonly FeatureEntry[] = printedFeatures(),
): FeatureDemoEntry[] {
	return rows.flatMap((row) => {
		const demo = featureDemo(row);
		return demo === null ? [] : [{
			feature: row.id,
			demo,
			title: row.title,
			description: row.description,
			helpHref: featureHelpHref(row),
		}];
	});
}

/** The entry a "Try it" link names, or `null` when it names none (a stale or foreign link). */
export function entryFor(
	entries: readonly FeatureDemoEntry[],
	feature: string | null | undefined,
): FeatureDemoEntry | null {
	return entries.find((entry) => entry.feature === feature) ?? null;
}
// #endregion

// #region Opening a demo
/** What opening a demo needs from the island. */
export interface DemoOpening<T> {
	/** The demos' loader (`DEMO_MODULES.load`): it joins an import already in flight. */
	load: (id: DemoId) => Promise<T>;
	/** The demo's module arrived: show it. */
	arrived: (module: T) => void;
	/** Whether the dialog still shows this entry (the visitor may have closed it, or opened another). */
	stillShowing: () => boolean;
	/**
	 * The pressed link's own address: the landing's demo stage on that demo (`featureTryHref`,
	 * which `FeatureRow` writes), rendered with no script.
	 */
	fallbackHref: string;
	/** Leave for an address. */
	navigate: (href: string) => void;
}

/**
 * Open `entry`'s demo: load its chunk — joining the import a press's pointer-down already started —
 * and hand the module over. Should the chunk fail (a deploy that retired an old page's hashed chunk,
 * a dropped connection) while the dialog still shows this entry, the press falls back to its link's
 * own address ({@link DemoOpening.fallbackHref}). Never rejects.
 */
export function openDemo<T>(entry: FeatureDemoEntry, opening: DemoOpening<T>): Promise<void> {
	return opening.load(entry.demo).then(opening.arrived, () => {
		if (opening.stillShowing()) opening.navigate(opening.fallbackHref);
	});
}
// #endregion

// #region Presses
/** The parts of a click the dialog reads. */
export interface PressLike {
	button: number;
	defaultPrevented: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}

/**
 * Whether the dialog takes a click over: the main button with no modifier on a press nothing else
 * handled. A modified or middle click keeps the link's own address (the landing's demo stage), so
 * "open in a new tab" still works.
 */
export function isPlainPress(press: PressLike): boolean {
	return !press.defaultPrevented && press.button === 0 &&
		!(press.metaKey || press.ctrlKey || press.shiftKey || press.altKey);
}

/** Whether a key press activates a "Try it" that has become a button: Space (Enter clicks it). */
export function isSpaceKey(key: string): boolean {
	return key === " " || key === "Spacebar";
}
// #endregion

// #region Section landing
/** What the page knows when it decides whether to land on the `?section=` chapter. */
export interface SectionLanding {
	/** `PerformanceNavigationTiming.type`: `navigate`, `reload`, `back_forward` or `prerender`. */
	navigationType: string;
	/** `location.hash`: a fragment is the browser's own to scroll to. */
	hash: string;
	/** `scrollY` when the island hydrates: a visitor who has already scrolled is never moved. */
	scrollY: number;
}

/**
 * Whether the page lands on the chapter `?section=` names: only on a fresh visit (a reload or a step
 * through history restores its own position), with no fragment, before the visitor has scrolled.
 */
export function shouldLandOnSection(landing: SectionLanding): boolean {
	return (landing.navigationType === "navigate" || landing.navigationType === "prerender") &&
		landing.hash === "" && landing.scrollY < 1;
}

/** A heading's box against the viewport. */
export interface BoxLike {
	top: number;
	bottom: number;
}

/**
 * Whether the chapter's heading is out of sight — above the pinned chrome (`pinned`, the bar and the
 * chapter navigation) or below the fold — so the page must scroll to it. A heading already in view
 * is left where it is: the page scrolls only when it must.
 */
export function needsScroll(box: BoxLike, viewport: { height: number; pinned: number }): boolean {
	return box.top < viewport.pinned || box.bottom > viewport.height;
}
// #endregion

// #region Chapter marker
/** A chapter section's box against the viewport. */
export interface ChapterBox<Id extends string = string> extends BoxLike {
	id: Id;
}

/**
 * The reader's line: a quarter of the way down the part of the screen the pinned chrome (`pinned`,
 * the bar and, from `--bp-md`, the chapter navigation) leaves. A chapter link lands its section's
 * top on the chrome's edge, so the line is inside the chapter it led to.
 */
export function readingLine(viewport: { height: number; pinned: number }): number {
	return viewport.pinned + Math.max(0, viewport.height - viewport.pinned) / 4;
}

/**
 * The chapter the reader is in: the one whose section spans the reading line, or `null` above the
 * first chapter (the page head) and past the last (the final call to action). The chapter
 * navigation marks it `aria-current="location"`, so the marker follows the reader after a
 * `?section=` landing instead of staying on the chapter the link named.
 */
export function chapterAt<Id extends string>(
	boxes: readonly ChapterBox<Id>[],
	line: number,
): Id | null {
	return boxes.find((box) => box.top <= line && box.bottom > line)?.id ?? null;
}
// #endregion
