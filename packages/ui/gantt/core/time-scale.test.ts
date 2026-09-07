/**
 * The time scale's arithmetic, pinned directly.
 *
 * Worth testing for the reason every pure module in this engine is: a scale whose rounding is
 * subtly wrong does not throw and does not look broken — it looks like a zoom that walks the
 * timestamp out from under the cursor, and the live gesture that would reveal it cannot be observed
 * in this repo's preview harness at all.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { DAY, HOUR, MIN } from "../../calendar/core/time.ts";
import {
	AXIS_LIMIT_DAYS,
	clampZoom,
	daysVisible,
	durationLabel,
	fitZoom,
	msAtX,
	PX_PER_DAY_DEFAULT,
	PX_PER_DAY_MAX,
	PX_PER_DAY_MIN,
	snapTo,
	ticksFor,
	tierFor,
	UNIT_RANK,
	unitNext,
	unitStart,
	weekendSpans,
	xOfMs,
	ZOOM_RANGE_DEFAULT,
	zoomedScrollX,
} from "./time-scale.ts";

const ORIGIN = Date.parse("2026-07-13T00:00:00Z");

// #region Time ⇄ pixels
Deno.test("xOfMs / msAtX — round-trip at every zoom the tiers span", () => {
	for (const ppd of [PX_PER_DAY_MIN, 1.5, 6, 26, 44, 300, 800, 1600, PX_PER_DAY_MAX]) {
		for (
			const ms of [ORIGIN - 400 * DAY, ORIGIN, ORIGIN + 17 * HOUR + 23 * MIN, ORIGIN + 900 * DAY]
		) {
			const x = xOfMs(ms, ORIGIN, ppd);
			assertAlmostEquals(msAtX(x, ORIGIN, ppd), ms, 1e-3, `ppd ${ppd}`);
		}
	}
});

Deno.test("xOfMs — one day is exactly pxPerDay wide and the origin sits at zero", () => {
	assertEquals(xOfMs(ORIGIN, ORIGIN, 44), 0);
	assertEquals(xOfMs(ORIGIN + DAY, ORIGIN, 44), 44);
	assertEquals(xOfMs(ORIGIN - 2 * DAY, ORIGIN, 10), -20);
});

Deno.test("clampZoom — bounded, and a non-finite request lands on the default rather than NaN", () => {
	assertEquals(clampZoom(0.0001), PX_PER_DAY_MIN);
	assertEquals(clampZoom(1e9), PX_PER_DAY_MAX);
	assertEquals(clampZoom(44), 44);
	assertEquals(clampZoom(Number.NaN), PX_PER_DAY_DEFAULT);
	assertEquals(clampZoom(50, [10, 20]), 20);
});

Deno.test("daysVisible — a viewport's width in days, zero at a degenerate zoom", () => {
	assertEquals(daysVisible(880, 44), 20);
	assertEquals(daysVisible(880, 0), 0);
});
// #endregion

// #region The zoom anchor
Deno.test("zoomedScrollX — the instant under the cursor does not move across a zoom", () => {
	const scrollX = 1234.5;
	const viewX = 317;
	for (const from of [8, 44, 300]) {
		const anchorMs = msAtX(scrollX + viewX, ORIGIN, from);
		for (const to of [from * 1.12, from / 1.12, from * 4, from / 5]) {
			const next = zoomedScrollX(anchorMs, viewX, ORIGIN, to);
			assertAlmostEquals(msAtX(next + viewX, ORIGIN, to), anchorMs, 1e-6);
		}
	}
});

Deno.test("zoomedScrollX — twenty compounding notches through one captured anchor never drift", () => {
	// The whole reason the anchor is captured once: re-deriving it from the previous step's offset
	// feeds every step's rounding into the next. Solved from the captured instant, the error at the
	// twentieth notch is the error at the first.
	const viewX = 200;
	let ppd = 44;
	let scrollX = 5000;
	const anchorMs = msAtX(scrollX + viewX, ORIGIN, ppd);
	for (let i = 0; i < 20; i++) {
		ppd *= 1.12;
		scrollX = zoomedScrollX(anchorMs, viewX, ORIGIN, ppd);
	}
	assertAlmostEquals(msAtX(scrollX + viewX, ORIGIN, ppd), anchorMs, 1e-6);
});
// #endregion

// #region Tiers
Deno.test("tierFor — the header only ever gets FINER as the zoom deepens", () => {
	let prevBottom = Number.POSITIVE_INFINITY;
	let prevTop = Number.POSITIVE_INFINITY;
	for (let ppd = PX_PER_DAY_MIN; ppd <= PX_PER_DAY_MAX; ppd *= 1.05) {
		const t = tierFor(ppd);
		assert(UNIT_RANK[t.bottom] <= prevBottom, `bottom coarsened at ${ppd}`);
		assert(UNIT_RANK[t.top] <= prevTop, `top coarsened at ${ppd}`);
		assert(UNIT_RANK[t.top] > UNIT_RANK[t.bottom], "the top row must be the coarser one");
		prevBottom = UNIT_RANK[t.bottom];
		prevTop = UNIT_RANK[t.top];
	}
});

Deno.test("tierFor — a bottom cell is never narrower than a two-character label needs", () => {
	// Days at 26px/day, weeks at 6px/day (42px), months at 1.5px/day (~46px), quarters at 0.6 (~55px),
	// six-hourly at 300px/day (75px), two-hourly at 800 (67px), hourly at 1600 (67px).
	for (let ppd = PX_PER_DAY_MIN; ppd <= PX_PER_DAY_MAX; ppd *= 1.03) {
		const t = tierFor(ppd);
		const cell = t.bottom === "hour"
			? (ppd * t.hourStep) / 24
			: t.bottom === "day"
			? ppd
			: t.bottom === "week"
			? ppd * 7
			: t.bottom === "month"
			? ppd * 28
			: ppd * 90;
		assert(
			cell >= 24,
			`a ${t.bottom} cell at ${ppd.toFixed(2)}px/day is only ${cell.toFixed(1)}px`,
		);
	}
});

Deno.test("tierFor — a non-finite zoom resolves to the default tier rather than throwing", () => {
	assertEquals(tierFor(Number.NaN), tierFor(PX_PER_DAY_DEFAULT));
});
// #endregion

// #region Ticks
Deno.test("ticksFor(day) — crosses a spring-forward day as a 23-hour cell and never duplicates a key", () => {
	const tz = "America/New_York";
	const start = Date.parse("2026-03-06T12:00:00Z");
	const end = start + 5 * DAY;
	const ticks = ticksFor("day", start, end, tz);
	const keys = new Set(ticks.map((t) => t.ms));
	assertEquals(keys.size, ticks.length, "every tick must be a distinct instant");
	for (let i = 1; i < ticks.length; i++) assert(ticks[i].ms > ticks[i - 1].ms, "monotone");
	const gaps = ticks.slice(1).map((t, i) => t.ms - ticks[i].ms);
	assert(gaps.includes(23 * HOUR), `expected one 23h day, got ${gaps.map((g) => g / HOUR)}`);
	assert(ticks[0].ms <= start, "the first tick is at or before the range start");
	assert(ticks[ticks.length - 1].ms > end, "the last tick is past the range end");
});

Deno.test("ticksFor(day) — a fall-back day is a 25-hour cell", () => {
	const tz = "Europe/London";
	const start = Date.parse("2026-10-23T12:00:00Z");
	const ticks = ticksFor("day", start, start + 5 * DAY, tz);
	const gaps = ticks.slice(1).map((t, i) => t.ms - ticks[i].ms);
	assert(gaps.includes(25 * HOUR), `expected one 25h day, got ${gaps.map((g) => g / HOUR)}`);
});

Deno.test("ticksFor(hour, step 6) — re-anchors at midnight so a stride lands on 0/6/12/18 across DST", () => {
	const tz = "America/New_York";
	const start = Date.parse("2026-03-08T00:00:00-05:00");
	const ticks = ticksFor("hour", start, start + DAY, tz, { hourStep: 6 });
	const labels = ticks.map((t) => t.label);
	// The 6 AM tick must exist even though 2 AM never happens that day.
	assert(labels.includes("6 AM"), labels.join(","));
	assert(labels.includes("12 PM"));
	assertEquals(ticks[0].major, true, "midnight is a major tick");
});

Deno.test("ticksFor(month) — January is the major boundary, and labels carry three widths", () => {
	const ticks = ticksFor(
		"month",
		Date.parse("2026-11-15T00:00:00Z"),
		Date.parse("2027-02-10T00:00:00Z"),
		"UTC",
	);
	const jan = ticks.find((t) => t.label === "January 2027");
	assert(jan, "January present");
	assertEquals(jan.major, true);
	assertEquals(jan.short, "Jan");
	assertEquals(jan.narrow, "J");
	const nov = ticks.find((t) => t.label === "November 2026");
	assertEquals(nov?.major, false);
});

Deno.test("ticksFor(week) — weeks start on Monday and the week holding the 1st is major", () => {
	const ticks = ticksFor(
		"week",
		Date.parse("2026-07-01T00:00:00Z"),
		Date.parse("2026-07-31T00:00:00Z"),
		"UTC",
	);
	for (const t of ticks) {
		assertEquals(new Date(t.ms).getUTCDay(), 1, `week tick ${t.label} is not a Monday`);
	}
	assertEquals(ticks[0].major, true); // Mon Jun 29 holds Jul 1
	assertEquals(ticks[1].major, false); // Mon Jul 6
});

Deno.test("ticksFor(year / quarter) — quarters count from January", () => {
	const q = ticksFor(
		"quarter",
		Date.parse("2026-05-01T00:00:00Z"),
		Date.parse("2027-01-15T00:00:00Z"),
		"UTC",
	);
	// The trailing tick is the first boundary PAST the range — the header sizes the last cell from it.
	assertEquals(q.map((t) => t.short), ["Q2", "Q3", "Q4", "Q1", "Q2"]);
	assertEquals(q[3].major, true);
	const y = ticksFor(
		"year",
		Date.parse("2026-05-01T00:00:00Z"),
		Date.parse("2027-01-15T00:00:00Z"),
		"UTC",
	);
	assertEquals(y.map((t) => t.label), ["2026", "2027", "2028"]);
});

Deno.test("ticksFor — an inverted or non-finite range yields nothing, and a huge one is capped", () => {
	assertEquals(ticksFor("day", 10, 0, "UTC"), []);
	assertEquals(ticksFor("day", Number.NaN, 0, "UTC"), []);
	const many = ticksFor("hour", 0, 400 * DAY, "UTC");
	assert(many.length <= 600, `capped, got ${many.length}`);
});

Deno.test("unitStart / unitNext — floor and step agree for every unit", () => {
	const tz = "Europe/London";
	const ms = Date.parse("2026-07-17T16:20:00Z");
	for (const unit of ["hour", "day", "week", "month", "quarter", "year"] as const) {
		const start = unitStart(ms, unit, tz);
		assert(start <= ms, `${unit} start is at or before`);
		const next = unitNext(start, unit, tz);
		assert(next > ms, `${unit} next is after`);
		assertEquals(unitStart(next, unit, tz), next, `${unit} next is itself a boundary`);
	}
});
// #endregion

// #region Weekends
Deno.test("weekendSpans — only Saturdays and Sundays, merged into one span per weekend", () => {
	const spans = weekendSpans(
		Date.parse("2026-07-13T00:00:00Z"),
		Date.parse("2026-07-27T00:00:00Z"),
		"UTC",
	);
	assertEquals(spans.length, 2);
	for (const s of spans) {
		assertEquals(new Date(s.start).getUTCDay(), 6);
		assertEquals((s.end - s.start) / DAY, 2);
	}
});

Deno.test("weekendSpans — declines a multi-year range rather than emitting hundreds of slivers", () => {
	assertEquals(weekendSpans(0, 5 * 365 * DAY, "UTC"), []);
});
// #endregion

// #region Fit + snap + labels
Deno.test("fitZoom — the range spans the viewport less the pad on each side", () => {
	const range = { start: ORIGIN, end: ORIGIN + 20 * DAY };
	const ppd = fitZoom(range, 1000, 0.1);
	assertAlmostEquals(xOfMs(range.end, ORIGIN, ppd) - xOfMs(range.start, ORIGIN, ppd), 800, 1e-9);
	// A lone instant fits as one day rather than dividing by zero.
	assert(Number.isFinite(fitZoom({ start: ORIGIN, end: ORIGIN }, 1000)));
	assertEquals(fitZoom({ start: ORIGIN, end: ORIGIN + 1e6 * DAY }, 1000), ZOOM_RANGE_DEFAULT[0]);
});

Deno.test("snapTo — quarter-hours at the hourly tier, the NEARER zoned midnight at a day tier", () => {
	const tz = "America/New_York";
	const hourly = tierFor(1600);
	assertEquals(
		snapTo(Date.parse("2026-07-17T10:07:00Z"), hourly, tz),
		Date.parse("2026-07-17T10:00:00Z"),
	);
	assertEquals(
		snapTo(Date.parse("2026-07-17T10:08:00Z"), hourly, tz),
		Date.parse("2026-07-17T10:15:00Z"),
	);
	const daily = tierFor(44);
	const noon = Date.parse("2026-03-08T16:00:00Z"); // 12:00 EDT on the spring-forward day
	const snapped = snapTo(noon + HOUR, daily, tz);
	assertEquals(snapped, Date.parse("2026-03-09T04:00:00Z")); // next local midnight (EDT)
	assertEquals(snapTo(noon - 2 * HOUR, daily, tz), Date.parse("2026-03-08T05:00:00Z")); // that day's midnight (EST)
});

Deno.test("durationLabel — reads at the grain a human would say it", () => {
	assertEquals(durationLabel(0, 0), "Instant");
	assertEquals(durationLabel(0, 45 * MIN), "45 min");
	assertEquals(durationLabel(0, 3 * HOUR + 30 * MIN), "3 h 30 min");
	assertEquals(durationLabel(0, DAY), "1 day");
	assertEquals(durationLabel(0, 3.5 * DAY), "3.5 days");
	assertEquals(durationLabel(0, 28 * DAY), "4 wk");
	assertEquals(durationLabel(0, 200 * DAY), "7 mo");
});

Deno.test("AXIS_LIMIT_DAYS — two centuries each way stays exact in a double at the deepest zoom", () => {
	const x = xOfMs(ORIGIN + AXIS_LIMIT_DAYS * DAY, ORIGIN, PX_PER_DAY_MAX);
	assert(Number.isSafeInteger(Math.round(x)));
});
// #endregion
