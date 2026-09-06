import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
	caretAfterSanitize,
	clampNumber,
	parseNumericInput,
	roundDecimals,
	sanitizeNumericInput,
	scrubAcceleration,
	scrubDelta,
	snapToStep,
	stepDecimals,
} from "./number-field.ts";

/**
 * Tests for the numeric core.
 *
 * Two things are being protected here, and only one of them is arithmetic.
 *
 * The first is that these functions are the SINGLE implementation shared by `InputNumber` and
 * `NumberInput`. A second copy of "clamp then snap then round" would agree with this one on the day
 * it was written and drift afterwards, and on this surface the figures are prices, so the drift is
 * a money defect that no type-checker can see.
 *
 * The second is the scrub curve. A drag's live behaviour cannot be observed by a static assertion
 * and — per this repo's own harness notes — cannot reliably be observed in a preview pane either,
 * because a frame may never be composited. So the physics is asserted as PROPERTIES (monotonic,
 * bounded, total on garbage input) rather than by watching a pointer move, which is the only form of
 * evidence available that does not depend on something rendering.
 */

// #region Precision
Deno.test("stepDecimals counts the digits a step implies", () => {
	assertEquals(stepDecimals(1), 0);
	assertEquals(stepDecimals(0.5), 1);
	assertEquals(stepDecimals(0.01), 2);
	assertEquals(stepDecimals(-0.25), 2);
	assertEquals(stepDecimals(100), 0);
});

Deno.test("stepDecimals reads exponent notation, which a naive split cannot", () => {
	// `String(1e-7)` is "1e-7", so splitting on "." finds no decimals at all and the step that needs
	// the MOST digits is the one that would have been given zero.
	assertEquals(String(1e-7), "1e-7");
	assertEquals(stepDecimals(1e-7), 7);
	assertEquals(stepDecimals(1.5e-7), 8);
});

Deno.test("stepDecimals is total on non-finite input", () => {
	assertEquals(stepDecimals(NaN), 0);
	assertEquals(stepDecimals(Infinity), 0);
});

Deno.test("roundDecimals sheds float noise", () => {
	assertEquals(roundDecimals(0.1 + 0.2, 2), 0.3);
	assertEquals(roundDecimals(1.005, 2), 1.0); // the classic toFixed case, asserted as it behaves
	assertEquals(roundDecimals(1234.5678, 2), 1234.57);
});

Deno.test("roundDecimals returns huge and non-finite values untouched rather than throwing", () => {
	// `toFixed` switches to exponent notation past 1e21 and throws past 100 decimals; both would
	// surface as a crash inside a keystroke handler.
	assertEquals(roundDecimals(1e22, 2), 1e22);
	assert(Number.isNaN(roundDecimals(NaN, 2)));
	assertEquals(roundDecimals(1.23456, 500), 1.23456);
	assertEquals(roundDecimals(1.23456, -3), 1);
});
// #endregion

// #region Clamp & snap
Deno.test("clampNumber honours one bound, both bounds, or neither", () => {
	assertEquals(clampNumber(5), 5);
	assertEquals(clampNumber(-3, 0), 0);
	assertEquals(clampNumber(120, 1, 99), 99);
	assertEquals(clampNumber(50, 1, 99), 50);
	assertEquals(clampNumber(-30, -30, 30), -30);
});

Deno.test("snapToStep anchors the grid on the origin, not on zero", () => {
	// `min: 1, step: 0.5` must offer 1 / 1.5 / 2 — a zero-anchored grid would offer 0.5 / 1 / 1.5 and
	// put every legal value half a step away from the one the reader asked for.
	assertEquals(snapToStep(1.7, 0.5, 1), 1.5);
	assertEquals(snapToStep(1.8, 0.5, 1), 2);
	assertEquals(snapToStep(1.7, 0.5, 0), 1.5);
	assertEquals(snapToStep(0.3, 0.25, 0), 0.25);
});

Deno.test("snapToStep keeps the result printable", () => {
	// 0.1 + 0.1 + 0.1 through a naive grid lands on 0.30000000000000004, which is what a reader would
	// then see in the field.
	assertEquals(snapToStep(0.30000000000000004, 0.1), 0.3);
	assertEquals(snapToStep(2.675, 0.01), 2.68);
});

Deno.test("snapToStep on the FINE grid lands on real pennies, not float noise", () => {
	// The Ctrl fine mode snaps to `precisionStep` rather than `step`. If it snapped to the standard
	// unit instead, a 0.01 nudge would round straight back to the whole number it came from and the
	// modifier would appear to do nothing at all.
	assertEquals(snapToStep(120 + 0.01, 0.01, 0), 120.01);
	assertEquals(snapToStep(120.01 + 0.01, 0.01, 0), 120.02);
	assertEquals(snapToStep(0.1 + 0.02, 0.01, 0), 0.12);
	// Three fine steps up from a whole number is exactly three pennies, not 120.029999999999998.
	let v = 120;
	for (let i = 0; i < 3; i++) v = snapToStep(v + 0.01, 0.01, 0);
	assertEquals(v, 120.03);
});

Deno.test("a fine step is worth 1/100 of a standard one at the shipped defaults", () => {
	// This ratio IS the brief's "dampen the scrub by 100x": the scrub swaps its unit rather than
	// dividing its output, so one rule covers the arrows, the wheel, the steppers and the drag, and a
	// caller who sets `precisionStep: 0.1` gets a consistent 10x everywhere instead of a hardcoded
	// hundred that only the drag would honour.
	const standard = scrubDelta({ movementPx: 30, elapsedMs: 1000, step: 1, pixelsPerStep: 3 });
	const fine = scrubDelta({ movementPx: 30, elapsedMs: 1000, step: 0.01, pixelsPerStep: 3 });
	assertAlmostEquals(fine, standard / 100, 1e-9);
});

Deno.test("snapToStep passes a zero, negative or non-finite step straight through", () => {
	assertEquals(snapToStep(7.3, 0), 7.3);
	assertEquals(snapToStep(7.3, -1), 7.3);
	assertEquals(snapToStep(7.3, NaN), 7.3);
	assert(Number.isNaN(snapToStep(NaN, 1)));
});

Deno.test("snapToStep survives a non-finite origin by falling back to zero", () => {
	assertEquals(snapToStep(1.7, 0.5, NaN), 1.5);
});
// #endregion

// #region Parsing
Deno.test("parseNumericInput reads a formatted figure back", () => {
	assertEquals(parseNumericInput("£1,500.00"), 1500);
	assertEquals(parseNumericInput("1500"), 1500);
	assertEquals(parseNumericInput("-30"), -30);
	assertEquals(parseNumericInput(" 42 days "), 42);
});

Deno.test("parseNumericInput answers null for an unfinished or malformed entry, never NaN", () => {
	// NaN propagates silently through arithmetic and reaches a payload; null stops at the first check.
	assertEquals(parseNumericInput(""), null);
	assertEquals(parseNumericInput("-"), null);
	assertEquals(parseNumericInput("."), null);
	assertEquals(parseNumericInput("abc"), null);
	assertEquals(parseNumericInput("1.2.3"), null);
});

Deno.test("sanitizeNumericInput keeps digits, grouping commas and ONE decimal point", () => {
	assertEquals(sanitizeNumericInput("1250.50"), "1250.50");
	assertEquals(sanitizeNumericInput("1,250.50"), "1,250.50");
	assertEquals(sanitizeNumericInput("abc"), "");
	assertEquals(sanitizeNumericInput("12a3"), "123");
	assertEquals(sanitizeNumericInput("£1,250.50"), "1,250.50");
	assertEquals(sanitizeNumericInput("1 250"), "1250");
	assertEquals(sanitizeNumericInput("12e5"), "125");
});

Deno.test("sanitizeNumericInput admits the FIRST decimal point and refuses every later one", () => {
	assertEquals(sanitizeNumericInput("1.2.3"), "1.23");
	assertEquals(sanitizeNumericInput("1.2."), "1.2");
	assertEquals(sanitizeNumericInput("..5"), ".5");
	assertEquals(sanitizeNumericInput("1..2"), "1.2");
});

Deno.test("sanitizeNumericInput takes a sign only in the lead, and only when allowed", () => {
	assertEquals(sanitizeNumericInput("-30"), "-30");
	assertEquals(sanitizeNumericInput("-30", { allowNegative: false }), "30");
	// A sign in the middle is a typo, not intent: `1-2` is not a number anybody meant to type.
	assertEquals(sanitizeNumericInput("1-2"), "12");
	assertEquals(sanitizeNumericInput("--5"), "-5");
	// Leading junk is dropped before the sign is judged, so a pasted "  -5" still keeps its sign.
	assertEquals(sanitizeNumericInput(" -5"), "-5");
});

Deno.test("sanitizeNumericInput refuses the point outright on a whole-number field", () => {
	// `maxFractionDigits: 0` says the field holds integers. Accepting `3.7` there only defers the
	// disappointment to the blur that rounds it to 4.
	assertEquals(sanitizeNumericInput("3.7", { allowDecimal: false }), "37");
	assertEquals(sanitizeNumericInput("-365.5", { allowDecimal: false }), "-3655");
});

Deno.test("sanitize of a PREFIX is always a prefix of sanitize of the whole", () => {
	// The caret restore depends on this and nothing else. A filter written as a regex sweep over the
	// whole string would not guarantee it, and the caret would land wrong only on the inputs where a
	// character was actually rejected — i.e. exactly when it matters.
	const cases = ["1.2.3", "-1,250.50", "a1b2.c3", "..5", "1--2", "£9,9.9.9"];
	for (const raw of cases) {
		const whole = sanitizeNumericInput(raw);
		for (let i = 0; i <= raw.length; i++) {
			const prefix = sanitizeNumericInput(raw.slice(0, i));
			assert(
				whole.startsWith(prefix),
				`"${prefix}" is not a prefix of "${whole}" (raw "${raw}", cut ${i})`,
			);
		}
	}
});

Deno.test("caretAfterSanitize counts the survivors to its left", () => {
	// Typing a second "." at the end of "1.2" must leave the caret after the "2", not jump it away.
	assertEquals(caretAfterSanitize("1.2.", 4), 3);
	// A letter rejected mid-string holds the caret where the reader was working.
	assertEquals(caretAfterSanitize("12a34", 3), 2);
	assertEquals(caretAfterSanitize("abc", 3), 0);
	assertEquals(caretAfterSanitize("1,250.50", 8), 8);
});

Deno.test("caretAfterSanitize clamps a caret outside the string rather than throwing", () => {
	assertEquals(caretAfterSanitize("123", 99), 3);
	assertEquals(caretAfterSanitize("123", -4), 0);
});

Deno.test("everything sanitize admits, parse can still read", () => {
	// The two must agree, or a field would accept text on every keystroke and then empty itself on
	// blur — the exact failure the live filter exists to remove.
	for (const raw of ["1250.50", "1,250.50", "-30", "0.01", "1.2.3", "12a3", "£9,999"]) {
		const clean = sanitizeNumericInput(raw);
		if (clean === "" || clean === "-" || clean === "." || clean === ",") continue;
		assert(
			parseNumericInput(clean) !== null,
			`sanitize("${raw}") = "${clean}" which parse rejects`,
		);
	}
});

Deno.test("parseNumericInput preserves the shipped comma-decimal behaviour verbatim", () => {
	// Documented, not desired: a de-DE figure loses its separator meaning. Asserted so that changing
	// it is a deliberate act with a failing test attached, rather than a silent shift under every
	// existing call site.
	assertEquals(parseNumericInput("1.234,5"), 1.2345);
});
// #endregion

// #region Scrub physics
Deno.test("scrubAcceleration is 1x at rest, so a still pointer moves nothing extra", () => {
	assertEquals(scrubAcceleration(0), 1);
});

Deno.test("scrubAcceleration is total on garbage input", () => {
	// A bad sample must degrade to a SLOW scrub. The alternative failure — a NaN or an unbounded
	// multiplier — writes a figure nobody asked for into a field that carries money.
	assertEquals(scrubAcceleration(NaN), 1);
	// Infinity degrades DOWN to 1, not up to the cap: an unmeasurable speed is a broken sample, and
	// the honest reading of a broken sample is "I do not know how fast this was", which earns no
	// acceleration at all. Handing back the maximum instead would turn a dropped timestamp into a
	// 64x jump on a field that carries money.
	assertEquals(scrubAcceleration(Infinity), 1);
	assertEquals(scrubAcceleration(-2), scrubAcceleration(2));
	assertEquals(scrubAcceleration(1, { reference: 0 }), scrubAcceleration(1));
});

Deno.test("scrubAcceleration climbs monotonically and never dips below 1", () => {
	let previous = 0;
	for (let v = 0; v <= 12; v += 0.05) {
		const accel = scrubAcceleration(v);
		assert(accel >= 1, `accel fell below 1 at ${v}: ${accel}`);
		assert(accel >= previous, `accel dipped at ${v}: ${accel} < ${previous}`);
		previous = accel;
	}
});

Deno.test("scrubAcceleration spans orders of magnitude between a creep and a flick", () => {
	// The whole reason the curve is not linear: a precision drag has to stay near 1x while a thrown
	// one has to cover a large range. These are the two ends of that requirement, stated as numbers.
	const creep = scrubAcceleration(0.05);
	const flick = scrubAcceleration(6);
	assert(creep < 1.1, `a creep should barely accelerate, got ${creep}`);
	assert(flick > 20, `a flick should climb hard, got ${flick}`);
});

Deno.test("scrubAcceleration is capped, so no flick can reach infinity", () => {
	assertEquals(scrubAcceleration(1e6), 64);
	assertEquals(scrubAcceleration(1e6, { max: 10 }), 10);
});

Deno.test("scrubDelta moves one step per pixelsPerStep at creeping speed", () => {
	// 6px over a full second is far below the acceleration knee, so this is the unaccelerated ratio.
	const delta = scrubDelta({ movementPx: 6, elapsedMs: 1000, step: 1, pixelsPerStep: 6 });
	assertAlmostEquals(delta, 1, 0.05);
});

Deno.test("scrubDelta carries the sign of the movement", () => {
	const up = scrubDelta({ movementPx: 12, elapsedMs: 1000, step: 1 });
	const down = scrubDelta({ movementPx: -12, elapsedMs: 1000, step: 1 });
	assert(up > 0 && down < 0);
	assertAlmostEquals(up, -down, 1e-9);
});

Deno.test("scrubDelta scales with step, so a 0.01 control creeps in pennies", () => {
	const whole = scrubDelta({ movementPx: 6, elapsedMs: 1000, step: 1, pixelsPerStep: 6 });
	const penny = scrubDelta({ movementPx: 6, elapsedMs: 1000, step: 0.01, pixelsPerStep: 6 });
	assertAlmostEquals(penny, whole * 0.01, 1e-9);
});

Deno.test("scrubDelta returns 0 for a sample that carries no movement or no step", () => {
	assertEquals(scrubDelta({ movementPx: 0, elapsedMs: 16, step: 1 }), 0);
	assertEquals(scrubDelta({ movementPx: NaN, elapsedMs: 16, step: 1 }), 0);
	assertEquals(scrubDelta({ movementPx: 10, elapsedMs: 16, step: 0 }), 0);
});

Deno.test("scrubDelta treats a zero or absent interval as one frame rather than dividing by it", () => {
	// Two samples in the same millisecond is ordinary on a high-rate pointer. A raw division would
	// produce an infinite speed, and the cap would then hand back the maximum multiplier for what was
	// actually a 1px nudge.
	const zero = scrubDelta({ movementPx: 1, elapsedMs: 0, step: 1 });
	const frame = scrubDelta({ movementPx: 1, elapsedMs: 16, step: 1 });
	assertEquals(zero, frame);
	assertEquals(scrubDelta({ movementPx: 1, elapsedMs: -5, step: 1 }), frame);
	assert(Number.isFinite(zero));
});

Deno.test("scrubDelta accelerates: the same distance covered faster is worth more", () => {
	const slow = scrubDelta({ movementPx: 40, elapsedMs: 400, step: 1 });
	const fast = scrubDelta({ movementPx: 40, elapsedMs: 20, step: 1 });
	assert(fast > slow * 5, `expected a hard climb, got ${slow} then ${fast}`);
});

Deno.test("scrubDelta falls back to a sane pixelsPerStep rather than dividing by zero", () => {
	const bad = scrubDelta({ movementPx: 6, elapsedMs: 1000, step: 1, pixelsPerStep: 0 });
	const good = scrubDelta({ movementPx: 6, elapsedMs: 1000, step: 1, pixelsPerStep: 6 });
	assertEquals(bad, good);
	assert(Number.isFinite(bad));
});
// #endregion
