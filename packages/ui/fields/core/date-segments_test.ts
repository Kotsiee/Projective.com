import { assertEquals } from "@std/assert";
import {
	adjacentSegment,
	type DateParts,
	emptyParts,
	normalizeYear,
	parsePastedDate,
	parseSegmentLayout,
	partsToDate,
	reconcile,
	segmentBounds,
	segmentOrder,
	segmentText,
	stepSegment,
	typeDigit,
	typingBounds,
} from "./date-segments.ts";
import {
	clampDayToMonth,
	daysInMonth,
	formatDatePattern,
	isLeapYear,
	MONTH_NAMES,
} from "./datetime.ts";

/**
 * Tests for the segmented date input and the token grammar under it.
 *
 * These exist for the same reason the tumbler's do: every rule here is reached from a keystroke
 * handler, and a rule that can only be checked by dispatching a `keydown` is a rule nobody checks at
 * the boundary where it is actually wrong. The cases below are deliberately the boundaries — the
 * century rule, the leap day leaving a leap year, a day that no longer fits the month it was typed
 * against, a two-digit year on both sides of the pivot — rather than several samples of the happy
 * path.
 */

// #region The formatter bug

Deno.test("formatDatePattern — the month-NAME tokens render, they are not literals", () => {
	const d = new Date(2023, 4, 12); // Friday 12 May 2023.

	// The reported defect: three shipping call sites ask for `M`, the regex only knew lowercase, and
	// the letter fell through to the literal branch — `12/05/2023` printed as `12 M 2023`.
	assertEquals(formatDatePattern(d, "dd M yy"), "12 May 23");
	assertEquals(formatDatePattern(d, "M d, yy"), "May 12, 23");
	assertEquals(formatDatePattern(d, "dd MM yyyy"), "12 May 2023");

	// A month whose short and long names differ, so an accidental `slice` of the wrong string shows.
	const jan = new Date(2023, 0, 5);
	assertEquals(formatDatePattern(jan, "M"), "Jan");
	assertEquals(formatDatePattern(jan, "MM"), "January");
});

Deno.test("formatDatePattern — numeric tokens keep their meaning beside the new name tokens", () => {
	const d = new Date(2023, 4, 12);
	assertEquals(formatDatePattern(d, "mm/dd/yy"), "05/12/23");
	assertEquals(formatDatePattern(d, "dd/mm/yyyy"), "12/05/2023");
	assertEquals(formatDatePattern(d, "d/m/yy"), "12/5/23");
	// Case is the whole distinction between a number and a name; both must survive in one pattern.
	assertEquals(formatDatePattern(d, "D dd M yyyy"), "Fri 12 May 2023");
	assertEquals(formatDatePattern(d, "DD, dd MM yyyy"), "Friday, 12 May 2023");
});

Deno.test("formatDatePattern — longest-first, or a token eats its own prefix", () => {
	const d = new Date(2023, 4, 12);
	// `yyyy` must not match as `yy` twice, and `MM` must not match as `M` twice.
	assertEquals(formatDatePattern(d, "yyyy"), "2023");
	assertEquals(formatDatePattern(d, "MM"), "May");
	// Separators and unknown characters pass through untouched.
	assertEquals(formatDatePattern(d, "yyyy-mm-dd"), "2023-05-12");
});

// #endregion

// #region Calendar arithmetic

Deno.test("isLeapYear — the century rule is the clause that gets dropped", () => {
	assertEquals(isLeapYear(2024), true);
	assertEquals(isLeapYear(2023), false);
	// Divisible by 4 and NOT leap. Reachable from any date-of-birth picker.
	assertEquals(isLeapYear(1900), false);
	assertEquals(isLeapYear(2100), false);
	// Divisible by 100 and leap, because it is also divisible by 400.
	assertEquals(isLeapYear(2000), true);
});

Deno.test("daysInMonth — February moves, nothing else does", () => {
	assertEquals(daysInMonth(2024, 1), 29);
	assertEquals(daysInMonth(2023, 1), 28);
	assertEquals(daysInMonth(1900, 1), 28);
	assertEquals(daysInMonth(2000, 1), 29);
	assertEquals(daysInMonth(2023, 0), 31);
	assertEquals(daysInMonth(2023, 3), 30);
	assertEquals(daysInMonth(2023, 11), 31);
	// A caller stepping a month counter past December must not index off the end of the table.
	assertEquals(daysInMonth(2023, 12), 31, "month 12 wraps to January");
	assertEquals(daysInMonth(2023, -1), 31, "month -1 wraps to December");
});

Deno.test("clampDayToMonth — the day yields, and only as far as it has to", () => {
	assertEquals(clampDayToMonth(2023, 1, 31), 28);
	assertEquals(clampDayToMonth(2024, 1, 31), 29);
	assertEquals(clampDayToMonth(2023, 3, 31), 30);
	assertEquals(clampDayToMonth(2023, 0, 31), 31, "a day that fits is not touched");
	assertEquals(clampDayToMonth(2023, 0, 0), 1, "there is no zeroth of January");
});

// #endregion

// #region Layout — the caller's order, this input's rendering

Deno.test("parseSegmentLayout — order comes from the pattern, rendering does not", () => {
	assertEquals(segmentOrder(parseSegmentLayout("dd/mm/yyyy")), ["day", "month", "year"]);
	assertEquals(segmentOrder(parseSegmentLayout("mm/dd/yy")), ["month", "day", "year"]);
	assertEquals(segmentOrder(parseSegmentLayout("yyyy-mm-dd")), ["year", "month", "day"]);
	// A month NAME token still orders the month segment; the segment itself stays numeric, because
	// `Apr` is a thing to read and not a thing to type into a two-character box.
	assertEquals(segmentOrder(parseSegmentLayout("M d, yy")), ["month", "day", "year"]);
	assertEquals(segmentOrder(parseSegmentLayout("dd M yy")), ["day", "month", "year"]);
});

Deno.test("parseSegmentLayout — separators survive, weekday tokens do not", () => {
	assertEquals(parseSegmentLayout("dd/mm/yyyy"), [
		{ kind: "day" },
		{ kind: "literal", text: "/" },
		{ kind: "month" },
		{ kind: "literal", text: "/" },
		{ kind: "year" },
	]);
	// `M d, yy` — the comma-space between day and year is one literal run, not two.
	assertEquals(parseSegmentLayout("M d, yy"), [
		{ kind: "month" },
		{ kind: "literal", text: " " },
		{ kind: "day" },
		{ kind: "literal", text: ", " },
		{ kind: "year" },
	]);
	// A weekday is derived from the other three and has no value of its own to edit, so it is dropped
	// from the INPUT. The display path still prints it.
	assertEquals(segmentOrder(parseSegmentLayout("DD, dd mm yyyy")), ["day", "month", "year"]);
});

Deno.test("parseSegmentLayout — a malformed pattern degrades to a usable input", () => {
	assertEquals(segmentOrder(parseSegmentLayout("")), ["day", "month", "year"]);
	assertEquals(segmentOrder(parseSegmentLayout("!!!")), ["day", "month", "year"]);
	// A pattern naming one field twice must not render two boxes bound to one value.
	assertEquals(segmentOrder(parseSegmentLayout("dd/dd/yyyy")), ["day", "year"]);
});

Deno.test("adjacentSegment — the ends fall through rather than wrapping", () => {
	const order = segmentOrder(parseSegmentLayout("dd/mm/yyyy"));
	assertEquals(adjacentSegment(order, "day", 1), "month");
	assertEquals(adjacentSegment(order, "month", 1), "year");
	assertEquals(adjacentSegment(order, "month", -1), "day");
	// Off either end is `null`: a wrap would trap focus in a three-box loop with no keyboard exit.
	assertEquals(adjacentSegment(order, "year", 1), null);
	assertEquals(adjacentSegment(order, "day", -1), null);
});

// #endregion

// #region Typing and auto-advance

Deno.test("typeDigit — a day advances as soon as it is unambiguous", () => {
	// `06` — the brief's own example: two digits, then focus moves on.
	const zero = typeDigit("day", "", "0");
	assertEquals(zero, { buffer: "0", value: null, complete: false });
	assertEquals(typeDigit("day", zero.buffer, "6"), { buffer: "06", value: 6, complete: true });

	// `4` cannot be extended — there is no 40th — so it commits on one keystroke with no leading zero
	// and no Tab. This is the difference between feeling native and feeling like three text boxes.
	assertEquals(typeDigit("day", "", "4"), { buffer: "04", value: 4, complete: true });
	assertEquals(typeDigit("day", "", "9"), { buffer: "09", value: 9, complete: true });

	// `3` CAN be extended (30, 31), so it waits — while already resolving to the 3rd if the reader
	// stops there.
	assertEquals(typeDigit("day", "", "3"), { buffer: "3", value: 3, complete: false });
	assertEquals(typeDigit("day", "3", "1"), { buffer: "31", value: 31, complete: true });
});

Deno.test("typeDigit — an impossible pair restarts from the newest keystroke", () => {
	// `3` then `9` is not the 39th and is not the 3rd; the reader changed their mind.
	assertEquals(typeDigit("day", "3", "9"), { buffer: "09", value: 9, complete: true });
	// `0` then `0` is not a day at all; the trailing zero starts over rather than committing a zeroth.
	assertEquals(typeDigit("day", "0", "0"), { buffer: "0", value: null, complete: false });
	assertEquals(typeDigit("month", "1", "9"), { buffer: "09", value: 8, complete: true });
});

Deno.test("typeDigit — months return STORED numbering, off by the one that is easy to lose", () => {
	// The reader types May as `05`; `Date` calls May `4`. The conversion happens here so no call site
	// can forget it.
	assertEquals(typeDigit("month", "0", "5"), { buffer: "05", value: 4, complete: true });
	assertEquals(typeDigit("month", "1", "2"), { buffer: "12", value: 11, complete: true });
	// `5` alone is already December-proof — there is no 50th month — so it commits immediately.
	assertEquals(typeDigit("month", "", "5"), { buffer: "05", value: 4, complete: true });
	assertEquals(typeDigit("month", "", "1"), { buffer: "1", value: 0, complete: false });
});

Deno.test("typeDigit — the day's typed ceiling is 31 even in February", () => {
	// The rule that makes the roll-forward reachable at all. If typing were bounded by the month in
	// view, the second `1` of `31` would be refused in February and `reconcile` could never fire.
	assertEquals(typingBounds("day").max, 31);
	assertEquals(typeDigit("day", "", "3"), { buffer: "3", value: 3, complete: false });
	assertEquals(typeDigit("day", "3", "1"), { buffer: "31", value: 31, complete: true });

	// Stepping keeps the narrower, month-aware ceiling — those are two different questions.
	assertEquals(segmentBounds("day", { day: 1, month: 1, year: 2023 }).max, 28);
	assertEquals(segmentBounds("day", { day: 1, month: 1, year: 2024 }).max, 29);
	assertEquals(segmentBounds("day", emptyParts()).max, 31, "with no month chosen, 31 is honest");
});

Deno.test("typeDigit — the year accumulates four digits and is not widened mid-entry", () => {
	let t = typeDigit("year", "", "2");
	assertEquals(t, { buffer: "2", value: 2, complete: false });
	t = typeDigit("year", t.buffer, "0");
	// The trap: widening `20` to `2020` here would rewrite a value the reader is still typing.
	assertEquals(t, { buffer: "20", value: 20, complete: false });
	t = typeDigit("year", t.buffer, "2");
	t = typeDigit("year", t.buffer, "6");
	assertEquals(t, { buffer: "2026", value: 2026, complete: true });
});

Deno.test("normalizeYear — a two-digit year is widened on commit, on a fixed pivot", () => {
	assertEquals(normalizeYear(26), 2026);
	assertEquals(normalizeYear(0), 2000);
	assertEquals(normalizeYear(68), 2068, "the last year on the near side of the pivot");
	assertEquals(normalizeYear(69), 1969, "the first on the far side");
	assertEquals(normalizeYear(99), 1999);
	// Anything already wide enough is left exactly as typed.
	assertEquals(normalizeYear(2026), 2026);
	assertEquals(normalizeYear(1875), 1875);
});

Deno.test("segmentText — the buffer shows while typing, the value shows after", () => {
	// Mid-entry the reader sees precisely what they pressed.
	assertEquals(segmentText("year", 20, "20", true), "20");
	// Committed, it is unambiguous.
	assertEquals(segmentText("year", 2026, "", false), "2026");
	assertEquals(segmentText("day", 6, "", false), "06");
	assertEquals(segmentText("month", 4, "", false), "05", "stored 4 is May, and prints as 05");
	// Empty is the shape of what is missing, not a zero.
	assertEquals(segmentText("day", null, "", false), "DD");
	assertEquals(segmentText("month", null, "", false), "MM");
	assertEquals(segmentText("year", null, "", false), "YYYY");
});

Deno.test("parsePastedDate — the layout decides which number is the day", () => {
	const dmy = segmentOrder(parseSegmentLayout("dd/mm/yyyy"));
	const mdy = segmentOrder(parseSegmentLayout("mm/dd/yyyy"));
	// The same eleven characters are two different dates, and both readings are correct for their
	// own field. Guessing here is how a 5 May becomes a 12 May.
	assertEquals(parsePastedDate("12/05/2023", dmy), { day: 12, month: 4, year: 2023 });
	assertEquals(parsePastedDate("12/05/2023", mdy), { day: 5, month: 11, year: 2023 });
});

Deno.test("parsePastedDate — separators are ignored, the pivot still applies", () => {
	const dmy = segmentOrder(parseSegmentLayout("dd/mm/yyyy"));
	assertEquals(parsePastedDate("12-05-2023", dmy), { day: 12, month: 4, year: 2023 });
	assertEquals(parsePastedDate("12 05 2023", dmy), { day: 12, month: 4, year: 2023 });
	assertEquals(parsePastedDate("Due 12.05.2023.", dmy), { day: 12, month: 4, year: 2023 });
	assertEquals(parsePastedDate("12/05/26", dmy), { day: 12, month: 4, year: 2026 });
});

Deno.test("parsePastedDate — anything not a whole date is refused, never half-applied", () => {
	const dmy = segmentOrder(parseSegmentLayout("dd/mm/yyyy"));
	assertEquals(parsePastedDate("12/05", dmy), null, "two groups is not a date");
	assertEquals(parsePastedDate("", dmy), null);
	assertEquals(parsePastedDate("no digits here", dmy), null);
	assertEquals(parsePastedDate("12/13/2023", dmy), null, "there is no thirteenth month");
	assertEquals(parsePastedDate("32/05/2023", dmy), null, "there is no thirty-second");
});

Deno.test("parsePastedDate — a pasted day is intent, so the month accommodates it", () => {
	const dmy = segmentOrder(parseSegmentLayout("dd/mm/yyyy"));
	// The same rule a TYPED day follows: 31 February is a request for the next 31st.
	assertEquals(parsePastedDate("31/02/2023", dmy), { day: 31, month: 2, year: 2023 });
	// And a real leap day pastes through untouched.
	assertEquals(parsePastedDate("29/02/2024", dmy), { day: 29, month: 1, year: 2024 });
});

// #endregion

// #region Reconciliation — the 31st-of-February problem

Deno.test("reconcile — editing the MONTH makes the day yield", () => {
	// The reader asked for February. February is what they get, on its last day.
	const feb = reconcile({ day: 31, month: 1, year: 2023 }, "month");
	assertEquals(feb.parts, { day: 28, month: 1, year: 2023 });
	assertEquals(feb.rolledMonths, 0, "the month the reader just chose does not move");

	const leap = reconcile({ day: 31, month: 1, year: 2024 }, "month");
	assertEquals(leap.parts, { day: 29, month: 1, year: 2024 });

	const april = reconcile({ day: 31, month: 3, year: 2023 }, "month");
	assertEquals(april.parts, { day: 30, month: 3, year: 2023 });
});

Deno.test("reconcile — editing the DAY makes the month yield, rolling forward", () => {
	// The reader asked for the 31st. The 31st is what they get, in the next month that has one.
	const r = reconcile({ day: 31, month: 1, year: 2023 }, "day");
	assertEquals(r.parts, { day: 31, month: 2, year: 2023 }, "February → March");
	assertEquals(r.rolledMonths, 1);

	// April has 30 and May has 31, so one step is enough there too.
	assertEquals(reconcile({ day: 31, month: 3, year: 2023 }, "day").parts.month, 4);

	// The 30th in February needs one step as well; the roll is not hard-coded to the 31st.
	assertEquals(reconcile({ day: 30, month: 1, year: 2023 }, "day").parts.month, 2);
});

Deno.test("reconcile — a roll out of December carries the year with it", () => {
	// November has 30 days, so the 31st rolls to December and stays in the same year.
	assertEquals(reconcile({ day: 31, month: 10, year: 2023 }, "day").parts, {
		day: 31,
		month: 11,
		year: 2023,
	});
	// A year that is not yet known must not be invented by the roll.
	const noYear = reconcile({ day: 31, month: 1, year: null }, "day");
	assertEquals(noYear.parts.year, null);
	assertEquals(noYear.parts.month, 2);
});

Deno.test("reconcile — the leap day falls out of the same rule when the YEAR moves", () => {
	// 29 February 2024, year stepped to 2025. That is a year edit, so the day yields.
	assertEquals(reconcile({ day: 29, month: 1, year: 2025 }, "year").parts, {
		day: 28,
		month: 1,
		year: 2025,
	});
	// ...and stepping back into a leap year does NOT restore the 29th. The 28th is a real date the
	// reader is now on; silently moving it because the year changed would be a second guess.
	assertEquals(reconcile({ day: 28, month: 1, year: 2024 }, "year").parts.day, 28);
});

Deno.test("reconcile — a half-entered date is left alone", () => {
	const partial: DateParts = { day: 31, month: null, year: 2023 };
	assertEquals(reconcile(partial, "day").parts, partial, "no month yet means nothing to reconcile");
	assertEquals(reconcile({ day: null, month: 1, year: 2023 }, "month").parts.day, null);
});

// #endregion

// #region Stepping

Deno.test("stepSegment — the day wraps inside its own month", () => {
	const jan: DateParts = { day: 31, month: 0, year: 2023 };
	assertEquals(stepSegment(jan, "day", 1).day, 1, "past the 31st of a 31-day month is the 1st");
	assertEquals(stepSegment({ ...jan, day: 1 }, "day", -1).day, 31);

	// February's ceiling is its own, and it moves with the leap year.
	assertEquals(stepSegment({ day: 28, month: 1, year: 2023 }, "day", 1).day, 1);
	assertEquals(stepSegment({ day: 28, month: 1, year: 2024 }, "day", 1).day, 29);
	assertEquals(stepSegment({ day: 1, month: 1, year: 2024 }, "day", -1).day, 29);
});

Deno.test("stepSegment — the month wraps and takes the day with it", () => {
	assertEquals(stepSegment({ day: 15, month: 11, year: 2023 }, "month", 1).month, 0);
	assertEquals(stepSegment({ day: 15, month: 0, year: 2023 }, "month", -1).month, 11);

	// Stepping January 31st forward lands on February, and the day yields — a month edit.
	const stepped = stepSegment({ day: 31, month: 0, year: 2023 }, "month", 1);
	assertEquals(stepped, { day: 28, month: 1, year: 2023 });
});

Deno.test("stepSegment — the year clamps rather than wrapping, and drops the leap day", () => {
	// 29 February 2024 stepped forward: 2025 has no 29th of February.
	assertEquals(stepSegment({ day: 29, month: 1, year: 2024 }, "year", 1), {
		day: 28,
		month: 1,
		year: 2025,
	});
	// A year has no cycle to wrap around, so the floor holds instead.
	assertEquals(stepSegment({ day: 1, month: 0, year: 1 }, "year", -1).year, 1);
});

Deno.test("stepSegment — an empty segment starts from the anchor, not from zero", () => {
	const anchor = new Date(2026, 8, 1); // 1 September 2026.
	assertEquals(stepSegment(emptyParts(), "year", 1, anchor).year, 2026);
	assertEquals(stepSegment(emptyParts(), "month", 1, anchor).month, 8);
	assertEquals(stepSegment(emptyParts(), "day", -1, anchor).day, 1);
});

// #endregion

// #region Resolution

Deno.test("partsToDate — only a complete date resolves", () => {
	assertEquals(partsToDate(emptyParts()), null);
	assertEquals(partsToDate({ day: 12, month: 4, year: null }), null);
	const d = partsToDate({ day: 12, month: 4, year: 2023 }) as Date;
	assertEquals([d.getFullYear(), d.getMonth(), d.getDate()], [2023, 4, 12]);
});

Deno.test("partsToDate — an overflowing day is clamped, never rolled by the constructor", () => {
	// `new Date(2023, 1, 31)` is not an error in JavaScript: it silently returns 3 March. Answering a
	// question about February with a date in March is how the calendar jumps a month unasked.
	const d = partsToDate({ day: 31, month: 1, year: 2023 }) as Date;
	assertEquals(d.getMonth(), 1, MONTH_NAMES[d.getMonth()] + " — must still be February");
	assertEquals(d.getDate(), 28);
});

// #endregion
