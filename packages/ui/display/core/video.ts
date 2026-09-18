import { formatClock } from "./audio.ts";

/**
 * video — the pure, DOM-free rules of {@link VideoPlayer}: whether a source can play at all, when
 * the overlay controls are shown, how a pointer or a key moves a slider, which glyph the mute
 * control wears, and what the clock and the sliders SAY. Everything the player decides that is not
 * a media-element read lives here so it is pinned by a unit test rather than watched in a browser —
 * the same split `audio.ts` makes for the waveform player.
 */

// #region Source
/**
 * Whether `src` names media the element could load. An absent source or the `"#"` a stub fixture
 * uses for "no asset yet" is NOT playable: the element would fetch the page it sits on and raise
 * `error`, so the player renders the poster with NO controls — a control whose handler can reach
 * nothing is a defect of the same class as a broken link (root CLAUDE.md §3 gate 11).
 */
export function isPlayableSource(src: string | undefined): src is string {
	return typeof src === "string" && src.length > 0 && src !== "#";
}
// #endregion

// #region Controls visibility
/** The inputs that decide whether the overlay controls are drawn. */
export interface ControlsVisibilityInput {
	/** `compact` reveals ONLY on engagement; `full` also shows whenever the video is not playing. */
	variant: "compact" | "full";
	/** A mouse (or pen) pointer is over the player. Touch never sets this — a tap toggles instead. */
	hover: boolean;
	/** Keyboard focus is inside the player. */
	focusWithin: boolean;
	playing: boolean;
	/** The viewer tapped the surface to reveal the controls (touch). */
	tapped: boolean;
	/** A scrub or a volume drag is in progress — the controls never vanish under a held pointer. */
	dragging: boolean;
}

/**
 * Whether the overlay controls are visible.
 *
 * A pointer over the player, focus inside it, a touch reveal or a held drag all show them. The
 * `full` transport also shows while the video is NOT playing — a paused or finished frame reads as
 * a still, and its controls are what say otherwise — where `compact` stays hidden at rest so a tile
 * that has not been started is media only.
 */
export function controlsVisible(input: ControlsVisibilityInput): boolean {
	if (input.hover || input.focusWithin || input.tapped || input.dragging) return true;
	return input.variant === "full" && !input.playing;
}
// #endregion

// #region Sliders
/** How far one arrow press moves a slider, as a share of its range. */
export const SLIDER_KEY_STEP = 0.05;
/** How far PageUp / PageDown move it. */
export const SLIDER_PAGE_STEP = 0.2;

/** Clamp a ratio into `0..1`; `NaN` (a zero-width track) resolves to 0. */
export function clampRatio(ratio: number): number {
	if (!Number.isFinite(ratio)) return 0;
	return Math.min(1, Math.max(0, ratio));
}

/**
 * The ratio a pointer at `clientX` names on a horizontal track occupying `[left, left + width)`.
 *
 * `rtl` flips it: under `dir="rtl"` the track's start edge is its RIGHT edge, so a pointer near the
 * right names the BEGINNING. The physical coordinates are passed in and flipped here — never
 * pre-flipped by the caller — so the rule has one implementation.
 */
export function pointerRatio(clientX: number, left: number, width: number, rtl: boolean): number {
	if (width <= 0) return 0;
	const raw = (clientX - left) / width;
	return clampRatio(rtl ? 1 - raw : raw);
}

/**
 * The key-driven move of a slider's ratio, or `null` for a key it does not handle so the caller
 * leaves the event alone. Arrows step, PageUp / PageDown page, Home / End jump.
 *
 * ArrowRight always INCREASES the value. The WAI-ARIA slider pattern binds the arrows to the value,
 * not to a screen direction, so a reader in an RTL document still gets "right = more" — which is
 * also what every native `<input type="range">` does.
 */
export function stepRatio(ratio: number, key: string): number | null {
	switch (key) {
		case "ArrowRight":
		case "ArrowUp":
			return clampRatio(ratio + SLIDER_KEY_STEP);
		case "ArrowLeft":
		case "ArrowDown":
			return clampRatio(ratio - SLIDER_KEY_STEP);
		case "PageUp":
			return clampRatio(ratio + SLIDER_PAGE_STEP);
		case "PageDown":
			return clampRatio(ratio - SLIDER_PAGE_STEP);
		case "Home":
			return 0;
		case "End":
			return 1;
		default:
			return null;
	}
}
// #endregion

// #region Playback rate
/** The rate after `current` in the cycle, wrapping to the first; an unknown current restarts it. */
export function nextRate(rates: readonly number[], current: number): number {
	if (rates.length === 0) return 1;
	const at = rates.indexOf(current);
	return rates[(at + 1) % rates.length];
}

/** `1×` · `1.5×` — the visible label of the speed control. */
export function rateLabel(rate: number): string {
	return `${rate}×`;
}
// #endregion

// #region Labels
/** Which glyph the mute control wears: `volume-off` while silent, `volume` otherwise. */
export function volumeGlyph(muted: boolean, volume: number): "volume" | "volume-off" {
	return muted || volume <= 0 ? "volume-off" : "volume";
}

/**
 * The clock beside the scrubber: `0:34 / 2:04` once the duration is known, the elapsed time alone
 * until it is — a `–:––` placeholder would promise a figure the element has not reported.
 */
export function clockLabel(currentS: number, durationS: number): string {
	const current = formatClock(safeSeconds(currentS) * 1000);
	if (!hasDuration(durationS)) return current;
	return `${current} / ${formatClock(durationS * 1000)}`;
}

/** The spoken value of the scrubber (`aria-valuetext`) — a time, never a percentage. */
export function seekValueText(currentS: number, durationS: number): string {
	const current = formatClock(safeSeconds(currentS) * 1000);
	if (!hasDuration(durationS)) return current;
	return `${current} of ${formatClock(durationS * 1000)}`;
}

/** The scrubber's ratio for the element's clock; `0` until the duration is known. */
export function progressRatio(currentS: number, durationS: number): number {
	if (!hasDuration(durationS)) return 0;
	return clampRatio(safeSeconds(currentS) / durationS);
}

/** A finite, positive duration. A live stream (`Infinity`) and unloaded metadata (`NaN`) have none. */
export function hasDuration(durationS: number): boolean {
	return Number.isFinite(durationS) && durationS > 0;
}

function safeSeconds(s: number): number {
	return Number.isFinite(s) && s > 0 ? s : 0;
}
// #endregion
