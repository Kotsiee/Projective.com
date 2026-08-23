/**
 * The tumbler's reel model — column domains and gesture arithmetic for {@link TimeTumbler}.
 *
 * Split out of the component for one reason above all others: **a drum-roll picker must commit the
 * right value in a background tab.** `requestAnimationFrame`, CSS transitions and CSS `@keyframes`
 * are all frozen in a hidden tab, so a snap implemented as "animate towards the nearest cell and
 * commit when the animation lands" commits nothing at all there (root CLAUDE.md §8 Decision #60
 * records three shipped defects of exactly this class). Every function below turns an input the
 * browser hands us SYNCHRONOUSLY — a pointer delta, a release velocity, a wheel delta — into a
 * finished integer step count. The component applies that step immediately; motion only ever
 * decorates the sub-cell remainder on the way back to a resting position that layout, not a
 * transform, already puts in the right place.
 *
 * The second reason is that the domains are genuinely fiddly. Which hours a bounded day offers,
 * which minutes a bounded hour offers, and whether a meridiem exists at all are three questions with
 * off-by-one answers, and they are answered here where they can be tested.
 */
import { clampToRange, MINUTES_PER_DAY, pad2 } from "./datetime.ts";

// #region Types

/** One position on a reel: the number it commits, and the text printed on the cell. */
export interface TumblerItem {
	/**
	 * The canonical value. For an hours column this is always the 24-hour hour, even in 12-hour mode
	 * where the LABEL reads 1–12 — so the value contract stays unambiguous no matter what the reel
	 * happens to be printing.
	 */
	value: number;
	/** The text on the cell, and therefore also the column's `aria-valuetext`. */
	label: string;
}

/** Which half of a 12-hour clock a column is showing. */
export type Meridiem = 0 | 1;

// #endregion

// #region Gesture constants

/**
 * Pointer travel, px, that must accumulate before a press becomes a drag.
 *
 * Below it the press is a click, which is what focuses the centre cell for typing. Without the
 * threshold the two interactions are the same event and the reader can never reach the keyboard
 * entry the column advertises.
 */
export const DRAG_THRESHOLD_PX = 4;

/**
 * How long a release velocity is allowed to coast, ms.
 *
 * Small on purpose. A flick on a bounded reel that overshoots by half a turn is not physics, it is a
 * lost value — and unlike a scroll list there is no way to see where you are heading, because only
 * three cells are ever visible.
 */
const FLICK_COAST_MS = 110;

/** Ceiling on a single flick, so a stray fast sample can never spin a column most of a turn. */
const MAX_FLICK_STEPS = 12;

/**
 * Default minute granularity for a tumbler.
 *
 * Five, not one, because a drum is a COARSE instrument: a 60-cell minute reel puts every value
 * behind a long drag or a held arrow key. It lives here rather than in the component because
 * {@link resolveMinutes} is called by consumers that have to seed a value on the same grid the reel
 * will offer — and a second copy of this number is how a picker comes to commit a time its own
 * tumbler cannot display.
 */
export const DEFAULT_MINUTE_STEP = 5;

/**
 * Pixels one `DOM_DELTA_LINE` wheel notch stands for.
 *
 * A guess, unavoidably: the browser has already discretised the gesture into "lines" and does not
 * say how tall it thinks a line is. 16 is the CSS initial root size, which is what every other
 * consumer of `deltaMode === 1` in the wild assumes.
 */
const WHEEL_LINE_PX = 16;

// #endregion

// #region Reel arithmetic

/**
 * Wrap `index` into `[0, len)`, so 23 → 00 and 59 → 00 are one continuous turn.
 *
 * `((i % len) + len) % len` rather than `i % len`, because a negative index is the ordinary case
 * here: it is what dragging DOWNWARD past the first cell produces, and JavaScript's `%` keeps the
 * sign of the dividend. Returns `0` for an empty reel so no caller can index `undefined`.
 */
export function wrapIndex(index: number, len: number): number {
	if (len <= 0) return 0;
	const i = Math.trunc(index) % len;
	return i < 0 ? i + len : i;
}

/**
 * Whole cells a drag of `dy` px has travelled. Dragging UP (negative `dy`) increments, matching the
 * physical drum — and matching the wheel, which moves the viewport rather than the drum and so runs
 * the other way for the same apparent motion.
 */
export function dragSteps(dy: number, itemH: number): number {
	if (!(itemH > 0) || !Number.isFinite(dy)) return 0;
	return Math.round(-dy / itemH);
}

/**
 * The sub-cell remainder left over once `steps` whole cells are committed, px.
 *
 * This is the ONLY quantity the reel's transform ever carries, and it is always in `(-itemH/2,
 * itemH/2]` — the interval is closed at the TOP because `Math.round` breaks a tie toward `+∞`, so a
 * finger resting exactly between two cells commits the later one. It is pure decoration: it says how
 * far between two cells the finger currently is, never which cell is selected.
 */
export function dragResidual(dy: number, itemH: number, steps: number): number {
	if (!(itemH > 0) || !Number.isFinite(dy)) return 0;
	return dy + steps * itemH;
}

/**
 * Extra whole cells a release carries, from the velocity measured at the moment the pointer lifted.
 *
 * Computed and committed synchronously on `pointerup` — there is no coasting animation to sample and
 * nothing to cancel, so the value is identical in a foreground and a background tab.
 */
export function flickSteps(velocityPxPerMs: number, itemH: number): number {
	if (!(itemH > 0) || !Number.isFinite(velocityPxPerMs)) return 0;
	const raw = Math.round((-velocityPxPerMs * FLICK_COAST_MS) / itemH);
	return clampToRange(raw, -MAX_FLICK_STEPS, MAX_FLICK_STEPS);
}

/**
 * Normalise a wheel event's delta to pixels, whatever unit the device reported it in.
 *
 * A trackpad sends pixels, a notched mouse wheel usually sends lines, and a few configurations send
 * pages. Treating all three as pixels makes one mouse notch move nothing and one page gesture spin
 * the whole reel.
 */
export function wheelDeltaPx(deltaY: number, deltaMode: number, itemH: number): number {
	if (!Number.isFinite(deltaY)) return 0;
	if (deltaMode === 1) return deltaY * WHEEL_LINE_PX;
	if (deltaMode === 2) return deltaY * itemH * 3;
	return deltaY;
}

/**
 * The PageUp / PageDown jump for a reel of `len` cells — a quarter turn.
 *
 * A quarter rather than the taxonomy's usual `10 × step`, because a reel wraps: ten steps on a
 * two-value meridiem column is five pointless revolutions, and on a 24-hour column it is an
 * arbitrary landing place. A quarter turn is the same gesture on every column — 6 hours, 15 minutes
 * at the default step, the other half on a meridiem.
 */
export function quarterTurn(len: number): number {
	return Math.max(1, Math.round(len / 4));
}

/**
 * Index of the item whose value is closest to `value`, or `-1` for an empty reel.
 *
 * Needed because a column's domain narrows under bounds: 17:45 is a real selection until the reader
 * picks the day whose `max` is 17:00, and something has to decide where it lands. Ties go to the
 * EARLIER item, so a value trapped exactly between two offered ones never drifts later than asked.
 */
export function nearestIndex(items: readonly TumblerItem[], value: number): number {
	let best = -1;
	let bestDist = Infinity;
	for (let i = 0; i < items.length; i++) {
		const dist = Math.abs(items[i].value - value);
		if (dist < bestDist) {
			best = i;
			bestDist = dist;
		}
	}
	return best;
}

// #endregion

// #region Column domains

/**
 * True when the hour `h` contains at least one minute inside the `[lo, hi]` minute-of-day window.
 * An hour with no legal minute must not be offered, or the reader can select it and then find the
 * minutes column empty underneath.
 */
function hourIsOffered(h: number, lo: number, hi: number): boolean {
	return h * 60 <= hi && h * 60 + 59 >= lo;
}

/**
 * The hours a column offers, in reel order (ascending by 24-hour value).
 *
 * In 12-hour mode only the half named by `meridiem` is offered, and the labels run 12, 1, 2 … 11 —
 * the order a clock face actually goes in, since hour 0 and hour 12 are both printed `12` and both
 * come first in their half.
 *
 * Can return an empty list if `meridiem` names a half with no legal hour. Callers resolve the
 * meridiem through {@link meridiemItems} first, which only ever offers a half that has one.
 */
export function hourItems(
	hour12: boolean,
	meridiem: Meridiem,
	lo: number,
	hi: number,
): TumblerItem[] {
	const out: TumblerItem[] = [];
	for (let h = 0; h < 24; h++) {
		if (!hourIsOffered(h, lo, hi)) continue;
		if (hour12 && (h < 12 ? 0 : 1) !== meridiem) continue;
		out.push({ value: h, label: pad2(hour12 ? ((h + 11) % 12) + 1 : h) });
	}
	return out;
}

/**
 * The minutes hour `hour24` offers, on the `step` grid, inside the `[lo, hi]` minute-of-day window.
 *
 * **A boundary minute is always offered even when it is off the grid.** With a 5-minute step and a
 * `min` of 09:07, the grid alone would make 09:10 the earliest reachable time and 09:07 — the
 * earliest LEGAL time, the one the caller went to the trouble of specifying — unreachable. The
 * boundary is added only when it genuinely constrains this hour, so an unbounded hour still offers
 * exactly the grid and never grows a stray `:59`.
 */
export function minuteItems(
	hour24: number,
	step: number,
	lo: number,
	hi: number,
): TumblerItem[] {
	const base = hour24 * 60;
	const mLo = Math.max(0, lo - base);
	const mHi = Math.min(59, hi - base);
	if (mHi < mLo) return [];

	const grid = Math.max(1, Math.trunc(step));
	const values = new Set<number>();
	for (let m = 0; m <= 59; m += grid) {
		if (m >= mLo && m <= mHi) values.add(m);
	}
	if (mLo > 0) values.add(mLo);
	if (mHi < 59) values.add(mHi);

	return [...values].sort((a, b) => a - b).map((m) => ({ value: m, label: pad2(m) }));
}

/**
 * The halves of the clock that contain at least one legal hour.
 *
 * A well-formed window always yields at least one — reaching the empty case requires `lo > hi`,
 * which {@link dayTimeBounds} cannot produce. The fallback is there so a caller that hand-builds a
 * malformed window still gets a column it can render, rather than an empty reel every gesture
 * silently no-ops against.
 */
export function meridiemItems(lo: number, hi: number): TumblerItem[] {
	const out: TumblerItem[] = [];
	if (lo <= 11 * 60 + 59) out.push({ value: 0, label: "AM" });
	if (hi >= 12 * 60) out.push({ value: 1, label: "PM" });
	if (out.length > 0) return out;
	const half: Meridiem = lo < 12 * 60 ? 0 : 1;
	return [{ value: half, label: half === 0 ? "AM" : "PM" }];
}

// #endregion

// #region Typed entry

/**
 * Resolve typed text to a reel index, or `-1` while it is not yet a value.
 *
 * Numeric columns match on the printed LABEL, not on {@link TumblerItem.value}: in 12-hour mode the
 * reader types the number they can see (`12`), which is hour 0 or hour 12 depending on the meridiem
 * beside it. Matching the value would silently refuse the only entry that makes sense on screen.
 *
 * Non-numeric columns (AM/PM) match on the first letter, so `a`, `A` and `am` all land.
 */
export function resolveTyped(
	items: readonly TumblerItem[],
	text: string,
	numeric: boolean,
): number {
	const trimmed = text.trim();
	if (trimmed === "") return -1;
	if (!numeric) {
		const first = trimmed[0].toLowerCase();
		return items.findIndex((i) => i.label[0].toLowerCase() === first);
	}
	const digits = trimmed.replace(/\D/g, "");
	if (digits === "") return -1;
	// The last two digits, so an over-typed field (a reader replacing "09" by typing "11" without
	// selecting first) resolves to what they can see rather than refusing.
	const n = Number(digits.slice(-2));
	return items.findIndex((i) => Number(i.label) === n);
}

// #endregion

// #region Whole-value resolution

/**
 * Snap a minute-of-day onto the nearest position the columns actually offer, under the given
 * window, step and clock convention.
 *
 * The single entry point for "make this value legal". Applying the window, the grid and the
 * per-hour minute domain in the wrong order produces times that exist in none of them — snapping
 * 23:58 to 24:00 on a 5-minute grid, say — so the order is fixed here and nowhere else: clamp into
 * the window first, resolve the hour against the hours the window offers, then resolve the minute
 * against the minutes THAT hour offers.
 */
export function resolveMinutes(
	minutes: number,
	step: number,
	lo: number,
	hi: number,
	hour12: boolean,
): number {
	const wanted = clampToRange(
		Number.isFinite(minutes) ? Math.trunc(minutes) : 0,
		0,
		MINUTES_PER_DAY - 1,
	);
	const inWindow = clampToRange(wanted, lo, hi);

	const meridiems = meridiemItems(lo, hi);
	const wantedMeridiem: Meridiem = inWindow < 12 * 60 ? 0 : 1;
	const meridiem = (meridiems.find((m) => m.value === wantedMeridiem) ?? meridiems[0])
		.value as Meridiem;

	const hours = hourItems(hour12, meridiem, lo, hi);
	const hourIdx = nearestIndex(hours, Math.floor(inWindow / 60));
	if (hourIdx < 0) return inWindow;
	const hour = hours[hourIdx].value;

	const mins = minuteItems(hour, step, lo, hi);
	const minIdx = nearestIndex(mins, inWindow % 60);
	if (minIdx < 0) return hour * 60;
	return hour * 60 + mins[minIdx].value;
}

// #endregion
