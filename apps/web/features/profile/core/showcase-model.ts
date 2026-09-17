import type { ProfileShowcase, ProfileShowcaseItem } from "../types/profile-types.ts";

/**
 * showcase-model — the pure, JSX-free rules of the hero showcase carousel: which slides a profile
 * shows, how an index wraps, when a swipe commits, where the rail's roving focus goes, and the one
 * timing rule the auto-advance obeys. Everything the carousel decides that is not a DOM read lives
 * here so it can be pinned by a unit test rather than watched in a browser.
 */

// #region Slides
/** How long a still is shown — and how long a finished video holds its last frame — before advancing. */
export const SHOWCASE_DWELL_MS = 5000;

/**
 * The slides the hero draws, in order: the primary still, then the extras. `null` (no showcase) is a
 * real state and returns no slides; a single-slide showcase still returns one, and the carousel
 * then draws no rail, because a rail for one slide is a control that does nothing (§3 gate 11).
 */
export function slidesOf(showcase: ProfileShowcase | null): ProfileShowcaseItem[] {
	if (!showcase) return [];
	return [showcase.primary, ...showcase.extras];
}

/**
 * The owner's in-place edit applied over the server's showcase: a chosen image REPLACES the primary
 * still (the thumbnail every card leads with), keeping the extras. With no showcase at all, the
 * chosen image becomes a one-slide showcase. `null` (no edit) returns the base untouched.
 */
export function withPrimaryImage(
	base: ProfileShowcase | null,
	edited: string | null,
	alt: string,
): ProfileShowcase | null {
	if (!edited) return base;
	const primary: ProfileShowcase["primary"] = {
		kind: "image",
		src: edited,
		alt: base?.primary.alt ?? alt,
	};
	return { primary, extras: base?.extras ?? [] };
}
// #endregion

// #region Index arithmetic
/** Wrap an index into `[0, count)`; a count of zero has no valid index and returns 0. */
export function wrapIndex(index: number, count: number): number {
	if (count <= 0) return 0;
	return ((index % count) + count) % count;
}

/**
 * The key-driven move of the rail's ROVING FOCUS (not the selection): the arrows step one dot,
 * wrapping at the ends, Home/End jump. `null` for any other key so the caller leaves it alone.
 */
export function rovingFocusFor(key: string, focused: number, count: number): number | null {
	switch (key) {
		case "ArrowRight":
			return wrapIndex(focused + 1, count);
		case "ArrowLeft":
			return wrapIndex(focused - 1, count);
		case "Home":
			return 0;
		case "End":
			return Math.max(0, count - 1);
		default:
			return null;
	}
}
// #endregion

// #region Swipe
/** The share of the viewport a drag must cover to commit a slide change on release. */
export const SWIPE_COMMIT_RATIO = 0.18;
/** A release faster than this (px per ms) commits regardless of distance — a flick. */
export const SWIPE_FLICK_VELOCITY = 0.45;
/** The smallest travel a flick may commit on, so a tap with a twitch is not a swipe. */
export const SWIPE_MIN_PX = 24;

/**
 * Which way a released drag moves the carousel: `+1` (next), `-1` (previous) or `0` (snap back).
 *
 * `dx` is PHYSICAL travel (positive = the pointer moved right). In LTR the next slide sits to the
 * right, so dragging the content left reveals it; in RTL the slides run the other way and the same
 * physical drag reveals the PREVIOUS one — which is why the writing direction is an input, and why
 * the caller passes physical pixels rather than pre-flipping them.
 */
export function resolveSwipe(
	dx: number,
	width: number,
	velocity: number,
	rtl = false,
): -1 | 0 | 1 {
	const travel = Math.abs(dx);
	const commit = travel >= Math.max(SWIPE_MIN_PX, width * SWIPE_COMMIT_RATIO) ||
		(travel >= SWIPE_MIN_PX && Math.abs(velocity) >= SWIPE_FLICK_VELOCITY);
	if (!commit) return 0;
	const towardNext = dx < 0;
	const step: 1 | -1 = towardNext ? 1 : -1;
	return rtl ? (step === 1 ? -1 : 1) : step;
}

/**
 * The drag offset the track draws while the pointer is down. Past the first or last slide there is
 * nothing to reveal, so the travel is damped rather than blocked — the reader feels the end without
 * the content simply refusing to move.
 */
export function dampedDrag(dx: number, index: number, count: number, rtl = false): number {
	const atStart = index === 0;
	const atEnd = index >= count - 1;
	// Which physical direction reveals "next" depends on the writing direction.
	const revealingNext = rtl ? dx > 0 : dx < 0;
	const overshooting = revealingNext ? atEnd : atStart;
	return overshooting ? dx * 0.3 : dx;
}
// #endregion

// #region Playback timing
/** The auto-advance decision for the active slide. */
export type AdvancePlan =
	/** Arm a timer; advance when it fires. */
	| { kind: "dwell"; ms: number }
	/** Nothing to arm — the slide is a video still playing (it advances when it ends). */
	| { kind: "await-video" }
	/** Nothing to arm at all. */
	| { kind: "none" };

/**
 * What the carousel should do about advancing FROM the active slide.
 *
 *  - Under either reduced-motion channel nothing auto-advances: the reader asked for no motion.
 *  - While the viewer hovers or focuses the carousel it holds: a slide being read is not taken away.
 *  - With one slide there is nothing to advance to.
 *  - A still dwells, then advances.
 *  - A video plays through (no timer while it plays), then holds its LAST frame for the same dwell —
 *    long enough to press Replay — and advances only then.
 */
export function advancePlan(input: {
	slide: ProfileShowcaseItem | undefined;
	count: number;
	paused: boolean;
	reduced: boolean;
	videoEnded: boolean;
}): AdvancePlan {
	const { slide, count, paused, reduced, videoEnded } = input;
	if (!slide || count <= 1 || reduced || paused) return { kind: "none" };
	if (slide.kind === "video" && !videoEnded) return { kind: "await-video" };
	return { kind: "dwell", ms: SHOWCASE_DWELL_MS };
}
// #endregion
