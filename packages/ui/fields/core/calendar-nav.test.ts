import { assertEquals } from "@std/assert";
import {
	applyDelimiter,
	createWheelStepper,
	isWheelNotch,
	type PeriodKeyInput,
	periodStepForKey,
	shiftMonthsKeepingDay,
	WHEEL_GAP_MS,
	type WheelSample,
	YEAR_LEAP_MONTHS,
} from "./calendar-nav.ts";
import { parseSegmentLayout } from "./date-segments.ts";

// #region Fixtures

function key(k: string, mods: Partial<PeriodKeyInput> = {}): PeriodKeyInput {
	return { key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods };
}

function mouseNotch(deltaY: number, timeStamp: number): WheelSample {
	return { deltaX: 0, deltaY, deltaMode: 0, timeStamp, wheelDeltaY: deltaY < 0 ? 120 : -120 };
}

function trackpad(deltaY: number, timeStamp: number): WheelSample {
	return { deltaX: 0, deltaY, deltaMode: 0, timeStamp, wheelDeltaY: -3 * deltaY };
}

function windowsTrackpad(deltaY: number, timeStamp: number): WheelSample {
	return { deltaX: 0, deltaY, deltaMode: 0, timeStamp, wheelDeltaY: Math.round(-1.2 * deltaY) };
}

// #endregion

// #region Keyboard

Deno.test("periodStepForKey — Ctrl and Cmd map the arrows onto months and years", () => {
	for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
		assertEquals(periodStepForKey(key("ArrowUp", mod)), 12);
		assertEquals(periodStepForKey(key("ArrowDown", mod)), -12);
		assertEquals(periodStepForKey(key("ArrowRight", mod)), 1);
		assertEquals(periodStepForKey(key("ArrowLeft", mod)), -1);
		assertEquals(periodStepForKey(key("ArrowUp", { ...mod, shiftKey: true })), YEAR_LEAP_MONTHS);
		assertEquals(periodStepForKey(key("ArrowDown", { ...mod, shiftKey: true })), -YEAR_LEAP_MONTHS);
	}
});

Deno.test("periodStepForKey — unmodified, Alt-chorded and non-arrow keys are not shortcuts", () => {
	assertEquals(periodStepForKey(key("ArrowUp")), null);
	assertEquals(periodStepForKey(key("ArrowUp", { shiftKey: true })), null);
	assertEquals(periodStepForKey(key("ArrowUp", { ctrlKey: true, altKey: true })), null);
	assertEquals(periodStepForKey(key("ArrowLeft", { ctrlKey: true, shiftKey: true })), null);
	assertEquals(periodStepForKey(key("PageUp", { ctrlKey: true })), null);
});

Deno.test("shiftMonthsKeepingDay — keeps the day, clamps it into a shorter month", () => {
	assertEquals(shiftMonthsKeepingDay(new Date(2026, 0, 15), 1), new Date(2026, 1, 15));
	assertEquals(shiftMonthsKeepingDay(new Date(2026, 0, 31), 1), new Date(2026, 1, 28));
	assertEquals(shiftMonthsKeepingDay(new Date(2024, 1, 29), 12), new Date(2025, 1, 28));
	assertEquals(shiftMonthsKeepingDay(new Date(2026, 11, 31), 1), new Date(2027, 0, 31));
	assertEquals(
		shiftMonthsKeepingDay(new Date(2026, 2, 10), -YEAR_LEAP_MONTHS),
		new Date(2021, 2, 10),
	);
});

// #endregion

// #region Wheel

Deno.test("isWheelNotch — line/page modes and 120-multiples are notches, arbitrary pixels are not", () => {
	assertEquals(isWheelNotch(mouseNotch(100, 0)), true);
	assertEquals(
		isWheelNotch({ deltaX: 0, deltaY: 4, deltaMode: 0, timeStamp: 0, wheelDeltaY: -240 }),
		true,
	);
	assertEquals(isWheelNotch({ deltaX: 0, deltaY: 3, deltaMode: 1, timeStamp: 0 }), true);
	assertEquals(isWheelNotch(trackpad(4, 0)), false);
	assertEquals(isWheelNotch(windowsTrackpad(6, 0)), false);
	assertEquals(isWheelNotch({ deltaX: 0, deltaY: 100, deltaMode: 0, timeStamp: 0 }), false);
});

Deno.test("createWheelStepper — one mouse notch is exactly one step, up increments", () => {
	const s = createWheelStepper();
	assertEquals(s.feed(mouseNotch(-100, 0)), 1);
	assertEquals(s.feed(mouseNotch(-100, 80)), 1);
	assertEquals(s.feed(mouseNotch(100, 160)), -1);
	assertEquals(s.feed({ deltaX: 0, deltaY: 3, deltaMode: 1, timeStamp: 400 }), -1);
});

Deno.test("createWheelStepper — a small-delta notch on a macOS mouse still steps", () => {
	const s = createWheelStepper();
	assertEquals(s.feed({ deltaX: 0, deltaY: 4, deltaMode: 0, timeStamp: 0, wheelDeltaY: -120 }), -1);
});

Deno.test("createWheelStepper — a notch reported as a burst of small events steps once", () => {
	const s = createWheelStepper();
	const out = [0, 8, 16, 24, 32].map((t) => s.feed(trackpad(20, t)));
	assertEquals(out.filter((x) => x !== 0), [-1]);
	assertEquals(s.feed(mouseNotch(100, 32 + WHEEL_GAP_MS + 30)), -1);
});

Deno.test("createWheelStepper — a trackpad flick and its momentum step once, then re-arm after a pause", () => {
	for (const make of [trackpad, windowsTrackpad]) {
		const s = createWheelStepper();
		const steps: number[] = [];
		for (let t = 0; t < 900; t += 16) steps.push(s.feed(make(t < 200 ? 30 : 6, t)));
		assertEquals(steps.filter((x) => x !== 0), [-1]);

		const after = 900 + WHEEL_GAP_MS + 1;
		const next: number[] = [];
		for (let t = after; t < after + 200; t += 16) next.push(s.feed(make(12, t)));
		assertEquals(next.filter((x) => x !== 0), [-1]);
	}
});

Deno.test("createWheelStepper — a sub-step touch does not move the calendar", () => {
	const s = createWheelStepper();
	assertEquals([0, 16, 32].map((t) => s.feed(trackpad(10, t))), [0, 0, 0]);
});

Deno.test("createWheelStepper — reversing a gesture re-arms immediately", () => {
	const s = createWheelStepper();
	const out: number[] = [];
	for (let t = 0; t < 160; t += 16) out.push(s.feed(trackpad(12, t)));
	for (let t = 160; t < 320; t += 16) out.push(s.feed(trackpad(-12, t)));
	assertEquals(out.filter((x) => x !== 0), [-1, 1]);
});

Deno.test("createWheelStepper — horizontal travel is left to the month track", () => {
	const s = createWheelStepper();
	assertEquals(s.feed({ deltaX: 40, deltaY: 5, deltaMode: 0, timeStamp: 0 }), 0);
	assertEquals(s.feed({ deltaX: 0, deltaY: 0, deltaMode: 0, timeStamp: 10 }), 0);
});

// #endregion

// #region Format

Deno.test("applyDelimiter — swaps every separator run and leaves tokens alone", () => {
	assertEquals(applyDelimiter("mm/dd/yy", "."), "mm.dd.yy");
	assertEquals(applyDelimiter("dd/mm/yyyy", "-"), "dd-mm-yyyy");
	assertEquals(applyDelimiter("yyyy-mm-dd", "/"), "yyyy/mm/dd");
	assertEquals(applyDelimiter("M d, yy", "/"), "M/d/yy");
	assertEquals(applyDelimiter("dd/mm/yyyy"), "dd/mm/yyyy");
});

Deno.test("applyDelimiter — the segment layout renders the forced delimiter", () => {
	const layout = parseSegmentLayout(applyDelimiter("dd/mm/yyyy", "."));
	const literals = layout.flatMap((p) => p.kind === "literal" ? [p.text] : []);
	assertEquals(literals, [".", "."]);
});

// #endregion
