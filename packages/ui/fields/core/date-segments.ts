/**
 * The segmented date input's state machine — pure, total, and framework-free.
 *
 * A segmented input is a typing surface, and typing surfaces are where date pickers go wrong: the
 * awkward answers ("the reader typed 31 and then chose February", "they typed 26 for the year",
 * "they held ArrowUp on the 29th of February 2024 until the year left the leap") are decided here,
 * once, by functions a test can call directly. None of it may live in a keydown handler, because a
 * rule that only exists inside an event listener can only be checked by dispatching events, and the
 * cases that matter are exactly the ones nobody thinks to dispatch.
 *
 * Two conventions hold throughout:
 *
 * - `month` is ZERO-based, matching `Date.prototype.getMonth`. Every boundary that faces the reader
 *   converts; nothing in between does, so there is one place to get the offset wrong instead of ten.
 * - A segment is `null` when it is EMPTY, which is not the same as zero and not the same as invalid.
 *   A half-typed date has to be representable, or the input has to refuse a keystroke somewhere in
 *   the middle of the reader entering a perfectly ordinary date.
 */

import { clampDayToMonth, clampToRange, daysInMonth, pad2 } from "./datetime.ts";

// #region Types

/** The three editable segments. Ordered by the caller's `dateFormat`, not by this list. */
export type DateSegmentKind = "day" | "month" | "year";

/** One rendered part of the input: an editable segment, or the literal text between two of them. */
export type DateSegmentPart =
	| { kind: DateSegmentKind }
	| { kind: "literal"; text: string };

/**
 * A date under construction. Each field is independently absent.
 *
 * `month` is 0-based; `year` is always the full four-digit year once committed (a two-digit entry is
 * widened by {@link normalizeYear} before it lands here, so nothing downstream has to wonder which
 * century a `26` meant).
 */
export interface DateParts {
	day: number | null;
	month: number | null;
	year: number | null;
}

/** The result of feeding one digit to a segment. */
export interface TypedDigit {
	/** The segment's new raw buffer — what the reader sees while the segment holds focus. */
	buffer: string;
	/**
	 * The value the buffer resolves to in {@link DateParts} STORAGE numbering (so a typed `05` in the
	 * month segment comes back as `4`), or `null` while the buffer is still ambiguous.
	 */
	value: number | null;
	/** The buffer can take no further digit: the caller advances focus to the next segment. */
	complete: boolean;
}

/** Inclusive bounds a segment's value may take, used for stepping and for `aria-valuemin/max`. */
export interface SegmentBounds {
	min: number;
	max: number;
}

// #endregion

// #region Constants

/**
 * The pivot that widens a two-digit year, matching the POSIX / ISO C `%y` convention.
 *
 * `00`–`68` are read as 2000–2068 and `69`–`99` as 1969–1999. A FIXED pivot rather than a window
 * sliding off the current year, because a sliding window silently changes what a keystroke means
 * from one year to the next and cannot be pinned by a test that will still pass in 2031.
 */
export const TWO_DIGIT_YEAR_PIVOT = 68;

/** The widest year this input will construct from typing. Bounds only; callers narrow further. */
export const YEAR_BOUNDS: SegmentBounds = { min: 1, max: 9999 };

/** Placeholder text per segment — the shape of what is missing, in the reader's own notation. */
export const SEGMENT_PLACEHOLDER: Record<DateSegmentKind, string> = {
	day: "DD",
	month: "MM",
	year: "YYYY",
};

/** Spoken name per segment, for the `aria-label` on each spinbutton. */
export const SEGMENT_LABEL: Record<DateSegmentKind, string> = {
	day: "Day",
	month: "Month",
	year: "Year",
};

/** How many digits a segment accepts before it is necessarily full. */
const SEGMENT_WIDTH: Record<DateSegmentKind, number> = { day: 2, month: 2, year: 4 };

// #endregion

// #region Layout

/**
 * Derive the input's segment order and separators from a `dateFormat` pattern.
 *
 * The ORDER is the caller's, because a form that prints `dd/mm/yyyy` and then asks the reader to
 * type month-first is worse than either convention on its own. The RENDERING is not: every segment
 * is numeric here regardless of whether the pattern asked for a month NAME, since `Apr` is a thing
 * to read and not a thing to type into a two-character box.
 *
 * Weekday tokens (`D`, `DD`) are dropped rather than rendered. A weekday is derived from the other
 * three fields and has no independent value, so a segment for it could only ever be read-only text
 * that moves when its neighbours do — which is a display concern, and the display path still prints
 * it via `formatDatePattern`.
 *
 * An unparseable pattern (one naming no segment at all) falls back to ISO order, so a typo in a
 * caller's prop degrades to a usable input rather than an empty one.
 */
export function parseSegmentLayout(format: string): DateSegmentPart[] {
	const parts: DateSegmentPart[] = [];
	const seen = new Set<DateSegmentKind>();
	let literal = "";

	const flushLiteral = () => {
		if (literal !== "") {
			parts.push({ kind: "literal", text: literal });
			literal = "";
		}
	};
	const pushSegment = (kind: DateSegmentKind) => {
		// A pattern naming the same field twice (`dd/dd`) would otherwise render two boxes bound to one
		// value, where typing in either silently rewrites the other.
		if (seen.has(kind)) return;
		seen.add(kind);
		flushLiteral();
		parts.push({ kind });
	};

	for (const m of format.matchAll(/yyyy|yy|MM|M|mm|m|DD|D|dd|d|[^yMmDd]+/g)) {
		const token = m[0];
		switch (token) {
			case "yyyy":
			case "yy":
				pushSegment("year");
				break;
			case "MM":
			case "M":
			case "mm":
			case "m":
				pushSegment("month");
				break;
			case "dd":
			case "d":
				pushSegment("day");
				break;
			case "DD":
			case "D":
				break;
			default:
				literal += token;
		}
	}
	flushLiteral();

	if (seen.size === 0) {
		return [
			{ kind: "day" },
			{ kind: "literal", text: "/" },
			{ kind: "month" },
			{ kind: "literal", text: "/" },
			{ kind: "year" },
		];
	}
	return parts;
}

/** The editable segments of a layout, in reading order. */
export function segmentOrder(layout: DateSegmentPart[]): DateSegmentKind[] {
	return layout
		.filter((p): p is { kind: DateSegmentKind } => p.kind !== "literal")
		.map((p) => p.kind);
}

/**
 * The segment `delta` places along from `kind`, or `null` at either end.
 *
 * `null` rather than a wrap is deliberate: ArrowRight off the last segment must fall through to the
 * browser so Tab-like traversal still leaves the control, and a silent wrap back to the first
 * segment would trap focus in a three-box loop with no way out but the mouse.
 */
export function adjacentSegment(
	order: DateSegmentKind[],
	kind: DateSegmentKind,
	delta: number,
): DateSegmentKind | null {
	const i = order.indexOf(kind);
	if (i < 0) return null;
	const next = i + delta;
	return next >= 0 && next < order.length ? order[next] : null;
}

// #endregion

// #region Values

/** An entirely empty date. */
export function emptyParts(): DateParts {
	return { day: null, month: null, year: null };
}

/** Decompose a `Date` into its three segment values. */
export function partsFromDate(d: Date): DateParts {
	return { day: d.getDate(), month: d.getMonth(), year: d.getFullYear() };
}

/** Every segment filled in? */
export function isComplete(parts: DateParts): boolean {
	return parts.day !== null && parts.month !== null && parts.year !== null;
}

/**
 * The `Date` a complete set of parts names, or `null` while any segment is still empty.
 *
 * The day is clamped to the month rather than allowed to overflow into the next one. `new Date(2023,
 * 1, 31)` is not an error in JavaScript — it silently returns the 3rd of March — so an unclamped
 * construction here would answer a question about February with a date in March, and the calendar
 * would jump a month the reader never asked for.
 */
export function partsToDate(parts: DateParts): Date | null {
	if (!isComplete(parts)) return null;
	const year = parts.year as number;
	const month = parts.month as number;
	return new Date(year, month, clampDayToMonth(year, month, parts.day as number));
}

/**
 * Widen a typed year to four digits.
 *
 * Applied at the moment the year segment is committed, not while it is being typed: a reader part
 * way through `2026` has typed `20`, and widening that to `2020` under their fingers would rewrite
 * the value they are halfway through entering.
 */
export function normalizeYear(typed: number): number {
	const n = Math.trunc(typed);
	if (n < 0) return 0;
	if (n >= 100) return n;
	return n <= TWO_DIGIT_YEAR_PIVOT ? 2000 + n : 1900 + n;
}

/**
 * The inclusive range a segment may hold, given what the OTHER segments currently say.
 *
 * The day's ceiling is a function of the month and year, which is the entire reason this takes the
 * whole `parts` object: February's is 28 or 29, and answering 31 for every month is how a picker
 * comes to offer a day it will then refuse.
 *
 * These are the bounds for STEPPING and for `aria-valuemax`. Typing has a different ceiling — see
 * {@link typingBounds}.
 */
export function segmentBounds(kind: DateSegmentKind, parts: DateParts): SegmentBounds {
	switch (kind) {
		case "day": {
			// With no month chosen yet, 31 is the honest ceiling: every day the reader might reach is
			// still reachable, and the month they pick next is what narrows it.
			const max = parts.month === null
				? 31
				: daysInMonth(parts.year ?? new Date().getFullYear(), parts.month);
			return { min: 1, max };
		}
		case "month":
			return { min: 1, max: 12 };
		case "year":
			return YEAR_BOUNDS;
	}
}

/**
 * The inclusive range TYPING may produce, which for the day is deliberately wider than
 * {@link segmentBounds}.
 *
 * Stepping is a move WITHIN the chosen month, so it stops at that month's length — ArrowUp on the
 * 28th of February belongs on the 1st, not on a 29th that does not exist. Typing is not: a reader
 * entering `31` while February happens to be in view is naming a day, not proposing one for
 * February, and {@link reconcile} rolls the month forward to the next one that has a 31st. Narrowing
 * the typed ceiling to February's 28 would make that keystroke unreachable — the second `1` would be
 * refused, and the rule that exists to handle it could never fire.
 */
export function typingBounds(kind: DateSegmentKind): SegmentBounds {
	switch (kind) {
		case "day":
			return { min: 1, max: 31 };
		case "month":
			return { min: 1, max: 12 };
		case "year":
			return YEAR_BOUNDS;
	}
}

/**
 * Reader-facing number → the form {@link DateParts} stores.
 *
 * Months are the only field where the two differ, and they differ by one in the direction that is
 * easy to lose: the reader types `05` for May, `Date` calls it `4`. The conversion is a named
 * function rather than a `- 1` at each call site so there is one place it can be wrong.
 */
export function toStoredValue(kind: DateSegmentKind, reader: number): number {
	return kind === "month" ? reader - 1 : reader;
}

/** The inverse of {@link toStoredValue}. */
export function toReaderValue(kind: DateSegmentKind, stored: number): number {
	return kind === "month" ? stored + 1 : stored;
}

// #endregion

// #region Typing

/**
 * Feed one digit to a segment, returning the new buffer and whether focus should advance.
 *
 * The auto-advance rule is arithmetic rather than a length count, which is what makes typing a date
 * feel like the native control instead of like three text boxes. A single `4` in the day segment is
 * already unambiguous — no valid day starts with a 4 — so it completes immediately and the reader
 * never has to type a leading zero or reach for Tab. A single `3` does not, because the 30th and the
 * 31st exist, so that one waits for a second digit.
 *
 * A second digit that would make the pair invalid restarts the buffer with that digit rather than
 * being swallowed. `3` then `9` is not the 39th and is not the 3rd; it is a reader who has changed
 * their mind mid-entry, and the 9th is the only reading that keeps their last keystroke meaningful.
 */
export function typeDigit(kind: DateSegmentKind, buffer: string, digit: string): TypedDigit {
	if (!/^[0-9]$/.test(digit)) return { buffer, value: null, complete: false };
	const width = SEGMENT_WIDTH[kind];
	const bounds = typingBounds(kind);
	const store = (reader: number) => toStoredValue(kind, reader);

	// The year is a plain four-digit accumulator: no prefix makes a fifth digit impossible, so length
	// is genuinely the only completion rule it has. It is NOT normalised here — a reader part way
	// through `2026` has typed `20`, and widening that under their fingers would rewrite the value
	// they are still entering. `normalizeYear` runs when the segment is committed instead.
	if (kind === "year") {
		const next = (buffer + digit).slice(-width);
		return { buffer: next, value: Number(next), complete: next.length === width };
	}

	const candidate = buffer + digit;
	const asNumber = Number(candidate);

	if (candidate.length >= width) {
		if (asNumber >= bounds.min && asNumber <= bounds.max) {
			return { buffer: candidate, value: store(asNumber), complete: true };
		}
		// The pair is not a value, so the newest keystroke starts a fresh one. `3` then `9` is neither
		// the 39th nor the 3rd; it is a reader who changed their mind, and the 9th is the only reading
		// that keeps their last keystroke meaningful.
		return typeDigit(kind, "", digit);
	}

	const n = Number(digit);
	// Could any further digit still land inside the range? If not, the reader has already said
	// everything they need to and focus advances without a leading zero or a Tab.
	if (n * 10 > bounds.max) {
		const clamped = clampToRange(n, bounds.min, bounds.max);
		return { buffer: pad2(clamped), value: store(clamped), complete: true };
	}
	return { buffer: candidate, value: n >= bounds.min ? store(n) : null, complete: false };
}

/**
 * Read a whole date out of pasted text, in the layout's own field order.
 *
 * This exists because the input default-prevents every text-entry channel so its DOM value can never
 * drift from the state machine — which means paste reaches nothing unless it is handled here. A
 * field that silently swallows Ctrl+V is the same defect class as a button whose handler is empty.
 *
 * Only the digit RUNS are read, so any separator survives (`12/05/2023`, `12-05-2023`, `12 05 2023`)
 * and a stray label does not. Order comes from the layout rather than being guessed, so pasting into
 * a `mm/dd/yyyy` field and a `dd/mm/yyyy` field gives two different, and in both cases correct,
 * answers. A two-digit year is widened on the same pivot typing uses.
 *
 * Anything that is not three groups is refused outright rather than partially applied: half a date
 * silently merged into the reader's existing one is worse than a paste that visibly did nothing.
 */
export function parsePastedDate(text: string, order: DateSegmentKind[]): DateParts | null {
	const groups = text.match(/\d+/g);
	if (!groups || groups.length !== 3 || order.length !== 3) return null;

	const parts = emptyParts();
	for (let i = 0; i < 3; i++) {
		const kind = order[i];
		const raw = groups[i];
		const n = Number(raw);
		if (!Number.isFinite(n)) return null;
		if (kind === "year") {
			parts.year = raw.length <= 2 ? normalizeYear(n) : n;
		} else {
			const bounds = typingBounds(kind);
			if (n < bounds.min || n > bounds.max) return null;
			parts[kind] = toStoredValue(kind, n);
		}
	}
	// The pasted day is the reader's stated intent, so it wins and the month accommodates — the same
	// rule a typed day follows.
	return reconcile(parts, "day").parts;
}

/**
 * What a segment shows: the live buffer while it is being typed, the committed value otherwise.
 *
 * The two are deliberately different renderings. A buffer is exactly the characters the reader has
 * pressed, so `2` stays `2` while they are on their way to `2026`; a committed value is normalised,
 * so the moment they leave it reads `2026` and the year is unambiguous on the way back past it.
 */
export function segmentText(
	kind: DateSegmentKind,
	value: number | null,
	buffer: string,
	editing: boolean,
): string {
	if (editing && buffer !== "") return buffer;
	if (value === null) return SEGMENT_PLACEHOLDER[kind];
	if (kind === "year") return String(value).padStart(4, "0");
	return pad2(kind === "month" ? value + 1 : value);
}

// #endregion

// #region Stepping

/**
 * Step one segment by `delta`, wrapping at its own bounds and reconciling the rest.
 *
 * Wrapping rather than stopping: a spinbutton that refuses to go past December is a spinbutton the
 * reader has to abandon and re-enter to reach January, and every native date field wraps. The YEAR
 * does not wrap — it has no cycle to wrap around — it clamps.
 *
 * An empty segment starts from `anchor` rather than from zero, so the first ArrowDown on a blank
 * field lands somewhere the reader recognises instead of in the year 1.
 */
export function stepSegment(
	parts: DateParts,
	kind: DateSegmentKind,
	delta: number,
	anchor: Date = new Date(),
): DateParts {
	const bounds = segmentBounds(kind, parts);
	const current = parts[kind];

	let next: number;
	if (current === null) {
		next = kind === "month"
			? anchor.getMonth()
			: kind === "day"
			? anchor.getDate()
			: anchor.getFullYear();
	} else if (kind === "year") {
		next = clampToRange(current + delta, bounds.min, bounds.max);
	} else {
		// `month` is 0-based while its bounds face the reader as 1-12, so it steps on a 0-based cycle of
		// the same length rather than through the 1-based bounds.
		const span = bounds.max - bounds.min + 1;
		const base = kind === "month" ? current : current - bounds.min;
		next = (((base + delta) % span) + span) % span + (kind === "month" ? 0 : bounds.min);
	}

	return reconcile({ ...parts, [kind]: next }, kind).parts;
}

// #endregion

// #region Reconciliation

/** The outcome of reconciling a change: the settled parts, and how far the month had to move. */
export interface Reconciled {
	parts: DateParts;
	/** Months the reconciliation rolled forward to accommodate the day. `0` when nothing moved. */
	rolledMonths: number;
}

/**
 * Settle a change so the three segments name a date that exists — the 31st-of-February problem.
 *
 * The rule is keyed on WHICH segment the reader just moved, because that is the only reading that
 * never overrides the field currently under their cursor:
 *
 * - They changed the MONTH (or the YEAR) while the 31st was selected → the day yields. They asked
 *   for February; February is what they get, on its last day.
 * - They changed the DAY to one this month cannot hold → the month yields, rolling FORWARD to the
 *   next month that has such a day. They asked for the 31st; the 31st is what they get.
 *
 * The forward roll is bounded by construction — a 31-day month is never more than two months away,
 * and the loop is capped at a full year regardless — so a malformed `parts` cannot spin here.
 *
 * The leap year falls out of the same rule rather than needing a case of its own: the 29th of
 * February 2024 with the year stepped to 2025 is a year edit, so the day yields to the 28th.
 */
export function reconcile(parts: DateParts, edited: DateSegmentKind): Reconciled {
	if (parts.day === null || parts.month === null) return { parts, rolledMonths: 0 };
	const year = parts.year ?? new Date().getFullYear();

	if (edited === "day") {
		let month = parts.month;
		let y = year;
		for (let i = 0; i < 12; i++) {
			if (parts.day <= daysInMonth(y, month)) {
				return {
					parts: { ...parts, month, year: parts.year === null ? null : y },
					rolledMonths: i,
				};
			}
			month += 1;
			if (month > 11) {
				month = 0;
				y += 1;
			}
		}
		return { parts, rolledMonths: 0 };
	}

	const day = clampDayToMonth(year, parts.month, parts.day);
	return { parts: day === parts.day ? parts : { ...parts, day }, rolledMonths: 0 };
}

// #endregion
