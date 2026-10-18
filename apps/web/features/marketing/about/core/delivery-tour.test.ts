import { assertEquals } from "@std/assert";
import {
	autoplayNext,
	autoplayRuns,
	NARROW,
	narrowNode,
	stepperKeyTarget,
	TOUR_ZONE_ORDER,
	tourControl,
	tourSteps,
	WIDE,
	wideNode,
	zoneRuns,
} from "./delivery-tour.ts";

const STEPS = tourSteps("5%");

// #region Content
Deno.test("tourSteps: the eight steps of the work order, in order, each with two lines", () => {
	assertEquals(STEPS.map((s) => s.label), [
		"Fund",
		"Prepaid escrow",
		"Claim",
		"In progress",
		"Submit",
		"Accept & release",
		"7-day clearing",
		"Withdraw",
	]);
	assertEquals(new Set(STEPS.map((s) => s.id)).size, 8);
	for (const step of STEPS) {
		assertEquals(step.lines.length, 2);
		for (const line of step.lines) assertEquals(line.trim().length > 0, true);
	}
});

Deno.test("tourSteps: the live fee is written into the release step, never a literal", () => {
	const release = tourSteps("2.5%").find((s) => s.id === "accept-release");
	assertEquals(release?.lines[1].includes("2.5% platform fee"), true);
});

Deno.test("tourSteps: the money's place only ever moves forward along the rail", () => {
	const order = STEPS.map((s) => TOUR_ZONE_ORDER.indexOf(s.zone));
	for (let i = 1; i < order.length; i++) assertEquals(order[i] >= order[i - 1], true);
	assertEquals(STEPS[0].zone, "client");
	assertEquals(STEPS[STEPS.length - 1].zone, "available");
});

Deno.test("tourSteps: product words only (owner ruling (c))", () => {
	const text = STEPS.flatMap((s) => [s.label, ...s.lines]).join(" ");
	for (const banned of ["Squad", "Contributor", "micro-agenc", "TVL"]) {
		assertEquals(text.includes(banned), false, banned);
	}
});

Deno.test("zoneRuns: one bracket per contiguous place", () => {
	assertEquals(zoneRuns(STEPS), [
		{ zone: "client", from: 0, to: 0 },
		{ zone: "escrow", from: 1, to: 5 },
		{ zone: "pending", from: 6, to: 6 },
		{ zone: "available", from: 7, to: 7 },
	]);
});
// #endregion

// #region Keyboard
Deno.test("stepperKeyTarget: arrows wrap both ways, Home / End jump, other keys are ignored", () => {
	assertEquals(stepperKeyTarget("ArrowRight", 0, 8), 1);
	assertEquals(stepperKeyTarget("ArrowDown", 7, 8), 0);
	assertEquals(stepperKeyTarget("ArrowLeft", 0, 8), 7);
	assertEquals(stepperKeyTarget("ArrowUp", 3, 8), 2);
	assertEquals(stepperKeyTarget("Home", 5, 8), 0);
	assertEquals(stepperKeyTarget("End", 1, 8), 7);
	assertEquals(stepperKeyTarget("Enter", 1, 8), null);
	assertEquals(stepperKeyTarget("a", 1, 8), null);
	assertEquals(stepperKeyTarget("ArrowRight", 0, 0), null);
});
// #endregion

// #region Autoplay
Deno.test("autoplayNext: one pass, resting on the last step", () => {
	assertEquals(autoplayNext(0, 8), 1);
	assertEquals(autoplayNext(6, 8), 7);
	assertEquals(autoplayNext(7, 8), null);
});

Deno.test("autoplayRuns: only in auto mode, motion allowed, on screen, not hovered, tab visible", () => {
	const open = {
		mode: "auto",
		motionAllowed: true,
		inView: true,
		hovered: false,
		visible: true,
	} as const;
	assertEquals(autoplayRuns(open), true);
	assertEquals(autoplayRuns({ ...open, motionAllowed: false }), false);
	assertEquals(autoplayRuns({ ...open, inView: false }), false);
	assertEquals(autoplayRuns({ ...open, hovered: true }), false);
	assertEquals(autoplayRuns({ ...open, visible: false }), false);
	for (const mode of ["paused", "manual", "done"] as const) {
		assertEquals(autoplayRuns({ ...open, mode }), false, mode);
	}
});

Deno.test("tourControl: Pause while playing, Play to resume, Replay at the end", () => {
	assertEquals(tourControl("auto", false), { label: "Pause", next: "paused", rewind: false });
	assertEquals(tourControl("paused", false), { label: "Play", next: "auto", rewind: false });
	assertEquals(tourControl("manual", false), { label: "Play", next: "auto", rewind: false });
	assertEquals(tourControl("manual", true), { label: "Replay", next: "auto", rewind: true });
	assertEquals(tourControl("done", true), { label: "Replay", next: "auto", rewind: true });
});
// #endregion

// #region Geometry
Deno.test("geometry: the CSS token offsets are node(i) − node(0) on each layout", () => {
	// delivery-tour.css hard-codes these translations; this pins them to the geometry.
	const wide = Array.from({ length: 8 }, (_, i) => wideNode(i).x - wideNode(0).x);
	assertEquals(wide, [0, 110, 220, 330, 440, 550, 660, 770]);
	const narrow = Array.from({ length: 8 }, (_, i) => {
		const a = narrowNode(0);
		const b = narrowNode(i);
		return [b.x - a.x, b.y - a.y];
	});
	assertEquals(narrow, [[0, 0], [100, 0], [200, 0], [300, 0], [300, 110], [200, 110], [100, 110], [
		0,
		110,
	]]);
	// Every node sits inside its viewBox.
	for (let i = 0; i < 8; i++) {
		assertEquals(wideNode(i).x < WIDE.width && wideNode(i).y < WIDE.height, true);
		assertEquals(narrowNode(i).x < NARROW.width && narrowNode(i).y < NARROW.height, true);
	}
});

Deno.test("geometry: the stylesheet's token translations are exactly the node offsets", async () => {
	const css = await Deno.readTextFile(new URL("../styles/delivery-tour.css", import.meta.url));
	const rule =
		/\.abt-tour__fig--(wide|narrow)\[data-step="(\d)"\]\s+\.abt-tour__token\s*\{\s*transform:\s*translate\((\d+)(?:px)?,\s*(\d+)(?:px)?\);?\s*\}/g;
	const found = new Map<string, [number, number]>();
	for (const m of css.matchAll(rule)) found.set(`${m[1]}-${m[2]}`, [Number(m[3]), Number(m[4])]);
	assertEquals(found.size, 14);
	for (let i = 1; i < 8; i++) {
		assertEquals(found.get(`wide-${i}`), [wideNode(i).x - wideNode(0).x, 0], `wide ${i}`);
		const a = narrowNode(0);
		const b = narrowNode(i);
		assertEquals(found.get(`narrow-${i}`), [b.x - a.x, b.y - a.y], `narrow ${i}`);
	}
});
// #endregion
