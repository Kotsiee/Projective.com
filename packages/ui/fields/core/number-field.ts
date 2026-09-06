/**
 * Numeric field arithmetic — the ONE implementation of "what does this number become" shared by
 * every numeric control in the taxonomy (`InputNumber`, `NumberInput`).
 *
 * Deliberately pure: no signals, no hooks, no DOM. Two controls that each round, clamp and snap
 * their own way are two controls that will eventually disagree about the same figure, and on a
 * surface where these fields carry money that disagreement is a price. Everything here is therefore
 * exercised directly by `number-field.test.ts` rather than inferred from a rendered tree.
 *
 * The scrub physics live here for the same reason plus one more: a drag's live behaviour cannot be
 * observed by a static assertion, so the curve is pinned by test and the island is left holding only
 * the event plumbing.
 */

// #region Precision
/**
 * Decimal places implied by a step, so a run of `0.1` increments lands on `0.3` and never on
 * `0.30000000000000004`. Handles exponent notation (`1e-7`), which `String(step).split(".")` does
 * not — a step small enough to be printed that way is exactly the one that needs the most digits.
 */
export function stepDecimals(step: number): number {
	if (!Number.isFinite(step)) return 0;
	const s = Math.abs(step).toString();
	const exp = s.indexOf("e-");
	if (exp !== -1) {
		const mantissa = s.slice(0, exp);
		const dot = mantissa.indexOf(".");
		const mantissaDecimals = dot === -1 ? 0 : mantissa.length - dot - 1;
		return mantissaDecimals + Number(s.slice(exp + 2));
	}
	const dot = s.indexOf(".");
	return dot === -1 ? 0 : s.length - dot - 1;
}

/**
 * Round to a fixed number of decimals, shedding binary float noise.
 *
 * `toFixed` is the tool here rather than a `Math.round(n * 10 ** d) / 10 ** d` scaling, which
 * reintroduces the error it is meant to remove for large `d`. Above `1e21` `toFixed` switches to
 * exponent notation, and beyond 100 decimals it throws, so both are guarded — a value that far out
 * is returned untouched, since there is no rounding left to do that the double can represent.
 */
export function roundDecimals(n: number, decimals: number): number {
	if (!Number.isFinite(n) || Math.abs(n) >= 1e21) return n;
	const d = Math.min(Math.max(Math.trunc(decimals), 0), 100);
	return Number(n.toFixed(d));
}
// #endregion

// #region Clamp & snap
/** Clamp `n` into `[min, max]`. An undefined bound is no bound. */
export function clampNumber(n: number, min?: number, max?: number): number {
	let out = n;
	if (min !== undefined && out < min) out = min;
	if (max !== undefined && out > max) out = max;
	return out;
}

/**
 * Snap `n` onto the step grid anchored at `origin`.
 *
 * The anchor matters: a control with `min: 1, step: 0.5` should offer 1, 1.5, 2 — not 0.5, 1, 1.5 —
 * so the caller passes `min` as the origin when it has one. The result is rounded to the digits the
 * step and the origin between them imply, which is what keeps a snapped value printable.
 */
export function snapToStep(n: number, step: number, origin = 0): number {
	if (!Number.isFinite(n) || !Number.isFinite(step) || step <= 0) return n;
	const base = Number.isFinite(origin) ? origin : 0;
	const steps = Math.round((n - base) / step);
	return roundDecimals(base + steps * step, stepDecimals(step) + stepDecimals(base));
}
// #endregion

// #region Parsing
/**
 * Parse what a reader typed into a number, or `null` for "nothing yet".
 *
 * Strips every character that cannot be part of a plain decimal — which is what lets a formatted
 * value (`£1,500.00`) be re-parsed after a blur, and what lets someone paste one in. Anything that
 * survives the strip but is still not a number (`1.2.3`, a lone `-`) is `null` rather than `NaN`:
 * `NaN` propagates silently through arithmetic and lands in a payload, where `null` stops at the
 * first check.
 *
 * A locale whose decimal separator is `,` is NOT handled — `1.234,5` parses as `1.2345`. That is the
 * behaviour this repo already shipped, and it is preserved verbatim here rather than quietly changed
 * underneath every existing call site.
 */
export function parseNumericInput(raw: string): number | null {
	const cleaned = raw.replace(/[^0-9.\-]/g, "");
	if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
	const n = Number(cleaned);
	return Number.isFinite(n) ? n : null;
}

/** What a field will accept as its reader types. */
export interface NumericFilterOptions {
	/** Permit a leading `-`. Set from the field's own `min`, not from taste. */
	allowNegative?: boolean;
	/** Permit a decimal point at all. `false` on a field that holds whole numbers. */
	allowDecimal?: boolean;
}

/**
 * Filter one keystroke's worth of text down to what a numeric field may hold — digits, grouping
 * commas, at most ONE decimal point, and a leading sign where the bounds allow it.
 *
 * This runs on every `input` rather than on blur, because a field that accepts `abc` for as long as
 * the reader is looking at it and then silently empties itself the moment they click away has taught
 * them nothing about what went wrong. {@link parseNumericInput} stays as the blur-time net for values
 * that never came from a keystroke at all.
 *
 * A single left-to-right scan, which is not incidental: it makes `sanitize(prefix)` always a prefix
 * of `sanitize(whole)`, and that property is what lets a caller restore the caret after a rejected
 * character by counting how many characters survived to its left. A regex-and-replace pass over the
 * whole string would not guarantee it.
 */
export function sanitizeNumericInput(raw: string, options: NumericFilterOptions = {}): string {
	const { allowNegative = true, allowDecimal = true } = options;
	let out = "";
	let seenDecimal = false;
	for (const ch of raw) {
		if (ch >= "0" && ch <= "9") {
			out += ch;
		} else if (ch === ",") {
			// Grouping. It carries no arithmetic meaning here — `parseNumericInput` strips it — but
			// refusing it would fight anyone pasting a figure they copied from a formatted total.
			out += ch;
		} else if (ch === "." && allowDecimal && !seenDecimal) {
			seenDecimal = true;
			out += ch;
		} else if (ch === "-" && allowNegative && out.length === 0) {
			// Leading only: `1-2` is not a number, and a sign in the middle is a typo rather than intent.
			out += ch;
		}
	}
	return out;
}

/**
 * Where the caret belongs after {@link sanitizeNumericInput} rewrote the field.
 *
 * Counts the characters that SURVIVE to the left of where the caret was. Without this, rejecting a
 * character mid-string sends the caret to the end, so correcting a typo in the middle of `1250.00`
 * throws the reader to the far end of the figure on the very keystroke they used to fix it.
 */
export function caretAfterSanitize(
	raw: string,
	caret: number,
	options: NumericFilterOptions = {},
): number {
	const bounded = Math.max(0, Math.min(caret, raw.length));
	return sanitizeNumericInput(raw.slice(0, bounded), options).length;
}
// #endregion

// #region Scrub physics
/** Tuning for {@link scrubAcceleration}. Every field is optional and has a shipped default. */
export interface ScrubAccelerationOptions {
	/** Speed (CSS px per ms) at which acceleration starts to bite. Default `0.5`. */
	reference?: number;
	/** How hard the curve climbs past the reference. Default `6`. */
	gain?: number;
	/** Exponent applied to the log term — the knee's sharpness. Default `2`. */
	exponent?: number;
	/** Hard ceiling on the multiplier, so a flick cannot reach infinity. Default `64`. */
	max?: number;
}

/** One frame at 60Hz — the elapsed time assumed when a sample carries no usable interval. */
const FRAME_MS = 16;

/**
 * The multiplier a drag earns for its speed: `1 + gain · ln(1 + v/ref)^exponent`, capped.
 *
 * Logarithmic rather than linear because the two things a scrub has to be good at pull in opposite
 * directions — landing exactly on 1500, and travelling from 0 to 250000 — and a linear gain can only
 * be tuned for one of them. A log curve sits at ~1x while the pointer is creeping, so a slow drag
 * moves by single steps, and climbs through orders of magnitude once it is genuinely being thrown.
 *
 * Total by construction: a NaN, infinite or zero speed returns `1` (no acceleration) rather than
 * poisoning the value, because the failure mode of a bad sample must be a slow scrub and never a
 * figure nobody asked for.
 */
export function scrubAcceleration(
	speedPxPerMs: number,
	opts: ScrubAccelerationOptions = {},
): number {
	const { reference = 0.5, gain = 6, exponent = 2, max = 64 } = opts;
	const v = Math.abs(speedPxPerMs);
	const ref = Number.isFinite(reference) && reference > 0 ? reference : 0.5;
	if (!Number.isFinite(v) || v === 0) return 1;
	const accel = 1 + gain * Math.log1p(v / ref) ** exponent;
	if (!Number.isFinite(accel)) return max;
	return Math.min(Math.max(accel, 1), max);
}

/** Inputs to {@link scrubDelta} — one pointer sample's worth of movement. */
export interface ScrubDeltaInput {
	/** Signed movement along the scrub axis since the last sample, in CSS pixels. */
	movementPx: number;
	/** Milliseconds since the last sample. A zero, negative or absent interval assumes one frame. */
	elapsedMs: number;
	/** The control's step granularity. */
	step: number;
	/** Pixels of unaccelerated travel that equal one step. Default `6`. */
	pixelsPerStep?: number;
	/** Curve tuning, forwarded to {@link scrubAcceleration}. */
	acceleration?: ScrubAccelerationOptions;
}

/**
 * The value change one pointer sample is worth.
 *
 * Returns a FRACTION of a step deliberately — the caller accumulates it and commits whole steps, so
 * a 3px creep on a 6px-per-step control is remembered rather than rounded away to nothing. Snapping
 * per sample instead would make a slow drag either inert or jumpy depending on the rounding mode.
 */
export function scrubDelta(input: ScrubDeltaInput): number {
	const { movementPx, elapsedMs, step, pixelsPerStep = 6, acceleration } = input;
	if (!Number.isFinite(movementPx) || movementPx === 0) return 0;
	if (!Number.isFinite(step) || step === 0) return 0;
	const px = Number.isFinite(pixelsPerStep) && pixelsPerStep > 0 ? pixelsPerStep : 6;
	const dt = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : FRAME_MS;
	const accel = scrubAcceleration(Math.abs(movementPx) / dt, acceleration);
	return (movementPx / px) * step * accel;
}
// #endregion
