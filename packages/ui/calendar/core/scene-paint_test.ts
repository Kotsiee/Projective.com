/**
 * The pure-canvas viewport's paint pass.
 *
 * The point of these is not that the pixels look right — a test cannot see them — but that the pass
 * is a PURE FUNCTION of its scene, which is the property the whole design rests on. Two things follow
 * from it and are asserted here: a complete frame is produced with `requestAnimationFrame` deleted
 * from the environment entirely (the background-tab rule), and the layer ORDER is a fact of the code
 * rather than of a stacking context, so the now-line can never end up under a card.
 *
 * The 2D context is a recorder, so what is checked is what the routine ASKED the canvas to do.
 */
import { assert, assertEquals } from "@std/assert";
import type { GridBox, GridScene, SceneEvent, ScenePalette, TextStyle } from "./grid-paint.ts";
import { leverThrowPx } from "./chrome.ts";
import type { BuildSceneEventsOptions } from "./scene-build.ts";
import { badgeRect, buildSceneEvents, draftRect, eventRect, hitTest } from "./scene-build.ts";
import { hoverExpansionFor, paintScene, sceneCost } from "./scene-paint.ts";
import type { CalendarEvent } from "./types.ts";

// #region A recording 2D context
interface Op {
	op: string;
	args: number[];
	fill: string;
	stroke: string;
	alpha: number;
	tracking?: string;
	lineWidth?: number;
	/** The line-dash pattern in force — how a DRAFT block's provisional stroke is observed. */
	dash?: number[];
	/** The ambient shadow in force when the op was issued — how the hovered card's LIFT is observed. */
	shadow?: string;
	shadowBlur?: number;
}

/** Enough of `CanvasRenderingContext2D` to run the pass, recording every drawing call. */
function recorder(width = 700, height = 500) {
	const ops: Op[] = [];
	const state = {
		fillStyle: "",
		strokeStyle: "",
		lineWidth: 1,
		dash: [] as number[],
		globalAlpha: 1,
		font: "",
		letterSpacing: "normal",
		wordSpacing: "normal",
		textAlign: "left",
		textBaseline: "alphabetic",
		lineCap: "butt",
		lineJoin: "miter",
		shadowColor: "",
		shadowBlur: 0,
		shadowOffsetY: 0,
	};
	const push = (op: string, ...args: number[]) =>
		ops.push({
			op,
			args,
			fill: state.fillStyle,
			stroke: state.strokeStyle,
			alpha: state.globalAlpha,
			shadow: state.shadowColor,
			shadowBlur: state.shadowBlur,
		});
	const stack: (typeof state)[] = [];
	const ctx = {
		canvas: { width, height },
		get fillStyle() {
			return state.fillStyle;
		},
		set fillStyle(v: string) {
			state.fillStyle = v;
		},
		get strokeStyle() {
			return state.strokeStyle;
		},
		set strokeStyle(v: string) {
			state.strokeStyle = v;
		},
		get globalAlpha() {
			return state.globalAlpha;
		},
		set globalAlpha(v: number) {
			state.globalAlpha = v;
		},
		get lineWidth() {
			return state.lineWidth;
		},
		set lineWidth(v: number) {
			state.lineWidth = v;
		},
		set font(v: string) {
			state.font = v;
		},
		// Present, so the routine's feature test finds them and the tracking path is actually exercised
		// — the whole reason the open-dyslexic overlay reaches canvas type at all.
		get letterSpacing() {
			return state.letterSpacing;
		},
		set letterSpacing(v: string) {
			state.letterSpacing = v;
		},
		get wordSpacing() {
			return state.wordSpacing;
		},
		set wordSpacing(v: string) {
			state.wordSpacing = v;
		},
		set textAlign(v: string) {
			state.textAlign = v;
		},
		set textBaseline(v: string) {
			state.textBaseline = v;
		},
		set lineCap(v: string) {
			state.lineCap = v;
		},
		set lineJoin(v: string) {
			state.lineJoin = v;
		},
		get shadowColor() {
			return state.shadowColor;
		},
		set shadowColor(v: string) {
			state.shadowColor = v;
		},
		get shadowBlur() {
			return state.shadowBlur;
		},
		set shadowBlur(v: number) {
			state.shadowBlur = v;
		},
		get shadowOffsetY() {
			return state.shadowOffsetY;
		},
		set shadowOffsetY(v: number) {
			state.shadowOffsetY = v;
		},
		setTransform: (...a: number[]) => push("setTransform", ...a),
		clearRect: (...a: number[]) => push("clearRect", ...a),
		fillRect: (...a: number[]) => push("fillRect", ...a),
		fillText: (t: string, x: number, y: number) => {
			ops.push({
				op: `text:${t}`,
				args: [x, y],
				fill: state.fillStyle,
				stroke: state.strokeStyle,
				alpha: state.globalAlpha,
				tracking: state.letterSpacing,
			});
		},
		measureText: (t: string) => ({ width: t.length * 6 }),
		beginPath: () => push("beginPath"),
		closePath: () => push("closePath"),
		moveTo: (...a: number[]) => push("moveTo", ...a),
		lineTo: (...a: number[]) => push("lineTo", ...a),
		arcTo: (...a: number[]) => push("arcTo", ...a),
		arc: (...a: number[]) => push("arc", ...a),
		rect: (...a: number[]) => push("rect", ...a),
		fill: () => push("fill"),
		stroke: () => {
			ops.push({
				op: "stroke",
				args: [],
				fill: state.fillStyle,
				stroke: state.strokeStyle,
				alpha: state.globalAlpha,
				lineWidth: state.lineWidth,
				dash: state.dash,
			});
		},
		setLineDash: (d: number[]) => {
			state.dash = d;
			ops.push({
				op: "setLineDash",
				args: [],
				fill: state.fillStyle,
				stroke: state.strokeStyle,
				alpha: state.globalAlpha,
				dash: d,
			});
		},
		clip: () => push("clip"),
		translate: (...a: number[]) => push("translate", ...a),
		scale: (...a: number[]) => push("scale", ...a),
		save: () => {
			stack.push({ ...state });
			push("save");
		},
		restore: () => {
			Object.assign(state, stack.pop() ?? state);
			push("restore");
		},
		createLinearGradient: () => ({ addColorStop: () => {} }),
	};
	return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}
// #endregion

// #region Fixtures
/** A resolved text style, with the tracking channels the open-dyslexic overlay travels through. */
function text(
	font: string,
	color: string,
	size: number,
	letterSpacing = "0.36px",
	wordSpacing = "1.9px",
): TextStyle {
	return { font, color, size, letterSpacing, wordSpacing, lineHeight: size + 2 };
}

const PALETTE: ScenePalette = {
	rule: "rgba(1, 1, 1, 1)",
	ruleWidth: 1,
	boundary: "rgba(2, 2, 2, 1)",
	boundaryWidth: 1,
	bandFill: "rgba(3, 3, 3, 1)",
	bandEdge: "rgba(4, 4, 4, 1)",
	bandEdgeWidth: 2,
	blackout: "rgba(5, 5, 5, 1)",
	hatchStripe: 6,
	hatchPitch: 12,
	hourText: text("400 11px x", "rgba(10, 10, 10, 1)", 11),
	titleText: text("600 12px x", "rgba(11, 11, 11, 1)", 12),
	metaText: text("400 11px x", "rgba(12, 12, 12, 1)", 11),
	markerText: text("700 11px x", "rgba(13, 13, 13, 1)", 11),
	pillText: text("600 12px x", "rgba(14, 14, 14, 1)", 12),
	maskedText: text("500 12px x", "rgba(16, 16, 16, 1)", 12),
	markerFill: "rgba(15, 15, 15, 1)",
	cancelledAlpha: 0.6,
	now: "rgba(200, 0, 0, 1)",
	nowWidth: 2,
	nowDotSize: 9,
	selectionFill: "rgba(20, 20, 20, 1)",
	selectionStroke: "rgba(21, 21, 21, 1)",
	selectionStrokeWidth: 1,
	selectionInsetStart: 2,
	selectionInsetEnd: 3,
	highlightRingWidth: 2,
	dimDrag: 0.35,
	dimFocus: 0.25,
	nowLeadAlpha: 0.3,
	// `1` is the pre-2026-08-22 full-width pin; the tests that assert the pin's extent set their own.
	pinWidthFrac: 1,
	selectionDash: 0,
	selectionGap: 0,
	selectionAlpha: 1,
	selectionGrab: 10,
	barFill: "rgba(30, 30, 30, 1)",
	barFillStrong: "rgba(31, 31, 31, 1)",
	barEdge: "rgba(32, 32, 32, 1)",
	barEdgeWidth: 1,
	barRadius: 5,
	barWidth: 10,
	barInset: 4,
	barHit: 24,
	barBallSize: 14,
	barBallFill: "rgba(35, 35, 35, 1)",
	pillFill: "rgba(40, 40, 40, 1)",
	pillStroke: "rgba(41, 41, 41, 1)",
	pillStrokeWidth: 1,
	pillStrokeWidthHover: 2,
	pillAccent: "rgba(42, 42, 42, 1)",
	pillW: 80,
	pillH: 32,
	pillInset: 16,
	focusRing: "rgba(50, 50, 50, 1)",
	focusRingHalo: "rgba(51, 51, 51, 1)",
	focusRingWidth: 2,
	tooltipFill: "rgba(60, 60, 60, 1)",
	tooltipStroke: "rgba(61, 61, 61, 1)",
	tooltipStrokeWidth: 1,
	eventRadius: 12,
	glyphSize: 12,
	glyphStroke: 1.5,
	liftShadow: "rgba(0, 0, 0, 0.1)",
	liftBlur: 12,
	liftOffsetY: 4,
	liftScale: 1.02,
	pinThickness: 2,
	pinChipW: 20,
	pinInk: "rgba(90, 90, 90, 1)",
	pinRadius: 999,
	avatarSize: 20,
	badgeText: text("700 9px x", "rgba(80, 80, 80, 1)", 9),
	badgeMinW: 18,
	badgeH: 18,
	accents: {
		// The CONFIRMED group — what `effectiveAccent` resolves for a plain, settled meeting since the
		// 2026-08-22 palette pass. The key has to be the token `buildSceneEvents` actually stamps, or
		// every card here resolves to `accentFallback` and the painter correctly draws nothing.
		"--cal-ev-confirmed": {
			fill: "rgba(70, 70, 70, 1)",
			fillHover: "rgba(71, 71, 71, 1)",
			fillMasked: "rgba(72, 72, 72, 1)",
			accent: "rgba(73, 73, 73, 1)",
			onAccent: "rgba(74, 74, 74, 1)",
			edge: "",
			edgeWidth: 0,
		},
		// `deadline`'s own accent (`core/kinds.ts`), resolved so the pin tests can assert that an
		// instant draws NO card box — against a real fill rather than against the empty fallback,
		// where the assertion would pass whether or not a box had been drawn.
		"--danger": {
			fill: "rgba(170, 70, 70, 1)",
			fillHover: "rgba(171, 71, 71, 1)",
			fillMasked: "rgba(172, 72, 72, 1)",
			accent: "rgba(173, 73, 73, 1)",
			onAccent: "rgba(174, 74, 74, 1)",
			edge: "",
			edgeWidth: 0,
		},
	},
	accentFallback: {
		fill: "",
		fillHover: "",
		fillMasked: "",
		accent: "",
		onAccent: "",
		edge: "",
		edgeWidth: 0,
	},
};

// Wide enough that "Design sync" never truncates against the mock's 6px/char `measureText` at any of
// the 7 columns `scene()` divides it into (2026-08-20: the card's own inline padding grew now that its
// content starts at a rounded edge rather than beside a leading bar — see `CARD` in `scene-paint.ts`).
const BOX: GridBox = { width: 900, height: 500, dpr: 1, rtl: false };
const HOUR = 3_600_000;
const MONDAY = Date.UTC(2026, 6, 13);

/** Lay out one day of events into scene cards, at a given zoom. */
function laid(
	events: CalendarEvent[],
	pxPerHour = 48,
	extra: Partial<BuildSceneEventsOptions> = {},
) {
	return buildSceneEvents(
		[{ column: 0, dayStart: MONDAY, top: 0 }],
		events,
		{ pxPerHour, tz: "UTC", hour12: false, ...extra },
	);
}

function cards(pxPerHour = 48) {
	return laid([{
		id: "a",
		title: "Design sync",
		kind: "sync",
		start: MONDAY + 2 * HOUR,
		end: MONDAY + 3 * HOUR,
	}], pxPerHour);
}

/** One INSTANT (`end === start`) — a deadline, which carries no height at all. */
function pin(pxPerHour = 48) {
	const at = MONDAY + 2 * HOUR;
	return laid([{ id: "d", title: "Handover", kind: "deadline", start: at, end: at }], pxPerHour);
}

/**
 * A properly CONTAINED pair at a zoom that affords the nest: the outer card's title clears
 * `NEST_HEADER_PX` and the inner one clears `NEST_MIN_H`, so the placement engine draws the review
 * inside the workshop rather than beside it. Same kind on purpose — same accent, same fill, which is
 * the case the nested card's own separation devices exist for.
 */
/**
 * A properly CONTAINED pair, laid out by the containment engine.
 *
 * `merge: false` is required since 2026-08-22: the resting default collapses any overlap cluster to
 * one card, so the default would give these tests a single merged card and nothing to nest.
 */
function nestedPair(pxPerHour = 96) {
	return laid(
		[
			{
				id: "outer",
				title: "Workshop",
				kind: "sync",
				start: MONDAY + HOUR,
				end: MONDAY + 4 * HOUR,
			},
			{
				id: "inner",
				title: "Review",
				kind: "sync",
				start: MONDAY + 2 * HOUR,
				end: MONDAY + 3 * HOUR,
			},
		],
		pxPerHour,
		{ merge: false },
	);
}

/**
 * A plain STRADDLE — neither event contains the other — which at rest stacks rather than splitting:
 * the earlier card is drawn and the later one folds under its `+N` chip.
 */
function foldedPair(pxPerHour = 48) {
	return laid([
		{ id: "first", title: "Standup", kind: "sync", start: MONDAY + HOUR, end: MONDAY + 3 * HOUR },
		{
			id: "second",
			title: "Retro",
			kind: "sync",
			start: MONDAY + 2 * HOUR,
			end: MONDAY + 4 * HOUR,
		},
	], pxPerHour);
}

function scene(extra: Partial<GridScene> = {}): GridScene {
	return {
		scrollTop: 0,
		columns: 7,
		gutter: 56,
		rules: [{ y: 0, boundary: true }, { y: 48, boundary: false }],
		hours: [{ y: 0, text: "00:00" }, { y: 48, text: "01:00" }],
		bands: [{ column: 0, y: 0, h: 100 }],
		blackouts: [],
		markers: [{ y: 0, text: "Mon, Jul 13 – Sun, Jul 19", today: true }],
		events: cards(),
		...extra,
	};
}
// #endregion

// #region The background-tab rule
Deno.test("paintScene — a complete frame with `requestAnimationFrame` removed from the environment", () => {
	const raf = globalThis.requestAnimationFrame;
	// Deleted outright, not stubbed: the assertion is that nothing in the path so much as reaches for
	// a frame. A hidden tab does not remove the function, it simply never calls back — which is the
	// same thing from the paint routine's side, and strictly harder to fake than to delete.
	// deno-lint-ignore no-explicit-any
	delete (globalThis as any).requestAnimationFrame;
	try {
		const { ctx, ops } = recorder();
		paintScene(ctx, scene(), PALETTE, BOX);
		// Every layer present: the band tint, an hour rule, the hour label, the card, its title.
		assert(ops.some((o) => o.op === "fillRect" && o.fill === PALETTE.bandFill), "no band");
		assert(ops.some((o) => o.op === "fillRect" && o.fill === PALETTE.boundary), "no day boundary");
		assert(ops.some((o) => o.op === "text:00:00"), "no hour label");
		assert(
			ops.some((o) => o.op === "fill" && o.fill === PALETTE.accents["--cal-ev-confirmed"].fill),
			"no card",
		);
		assert(ops.some((o) => o.op === "text:Design sync"), "no card title");
	} finally {
		// deno-lint-ignore no-explicit-any
		if (raf) (globalThis as any).requestAnimationFrame = raf;
	}
});

Deno.test("paintScene — the same scene paints the same frame twice, so nothing accumulates", () => {
	const a = recorder();
	paintScene(a.ctx, scene(), PALETTE, BOX);
	const b = recorder();
	paintScene(b.ctx, scene(), PALETTE, BOX);
	paintScene(b.ctx, scene(), PALETTE, BOX);
	// The second pass repeats the first exactly — a transform or a clip that outlived its frame would
	// show up here as a diverging tail.
	assertEquals(b.ops.slice(a.ops.length).map((o) => o.op), a.ops.map((o) => o.op));
});
// #endregion

// #region Order and culling
Deno.test("paintScene — the now-line is drawn AFTER the cards, so a card can never hide it", () => {
	const { ops } = paint(scene({ now: { y: 100, column: 0 } }));
	const card = ops.findIndex((o) =>
		o.op === "fill" && o.fill === PALETTE.accents["--cal-ev-confirmed"].fill
	);
	const now = ops.findIndex((o) => o.op === "fillRect" && o.fill === PALETTE.now);
	assert(card >= 0 && now > card, `expected the now-line after the card, got ${card} then ${now}`);
});

Deno.test("paintScene — the chrome is drawn last, in the order the hit test walks it backwards", () => {
	const { ops } = paint(scene({
		scrollbar: { progress: 0.5, frozen: null, opacity: 1, active: false, lever: null },
		present: { direction: "down", text: "Now", hover: false, focused: false },
	}));
	const bar = ops.findIndex((o) => o.op === "fill" && o.fill === PALETTE.barFill);
	const pill = ops.findIndex((o) => o.op === "fill" && o.fill === PALETTE.pillFill);
	assert(bar >= 0 && pill > bar, "the pill must draw over the gauge, as the hit test assumes");
});

Deno.test("paintScene — a card scrolled off the viewport is not drawn at all", () => {
	const off = scene({ scrollTop: 100_000 });
	const { ops } = paint(off);
	assertEquals(ops.some((o) => o.op === "text:Design sync"), false);
});

Deno.test("paintScene — a card with no resolvable accent draws nothing rather than a default colour", () => {
	const anon = cards().map((c) => ({ ...c, accent: "--nobody-declared-this" }));
	const { ops } = paint(scene({ events: anon }));
	// The fallback is empty on every channel, so the card's fill is an empty string — the canvas
	// ignores it and keeps its previous style rather than this package inventing a colour.
	assert(
		!ops.some((o) => o.op === "fill" && o.fill === PALETTE.accents["--cal-ev-confirmed"].fill),
	);
});

Deno.test("paintScene — a hovered card takes the hover fill, and only that card", () => {
	const list = cards();
	const { ops } = paint(scene({ events: list, hoverId: list[0].id }));
	assert(
		ops.some((o) => o.op === "fill" && o.fill === PALETTE.accents["--cal-ev-confirmed"].fillHover),
	);
});

Deno.test("paintScene — the focus ring follows the accessible layer's focus onto the canvas", () => {
	const list = cards();
	const { ops } = paint(scene({ events: list, focusId: list[0].id }));
	assert(
		ops.some((o) => o.op === "stroke" && o.stroke === PALETTE.focusRing),
		"a keyboard reader has no other way to see where they are",
	);
});
// #endregion

// #region Focus indicators (the accessible layer's only visible presentation)
Deno.test("paintScene — every focus ring is TWO-TONE, halo inside and ink outside", () => {
	/*
	 * A single tone cannot clear 3:1 against both the card's accent-tinted fill and the grid behind it
	 * across a generated palette (`theme-engine.ts` shows the arithmetic), and unlike a DOM ring this
	 * one cannot be corrected later by a cascade. So the pair is drawn here or the indicator is
	 * unreliable wherever the accent happens to land.
	 */
	const list = cards();
	const { ops } = paint(scene({ events: list, focusId: list[0].id }));
	const halo = ops.findIndex((o) => o.op === "stroke" && o.stroke === PALETTE.focusRingHalo);
	const ink = ops.findIndex((o) => o.op === "stroke" && o.stroke === PALETTE.focusRing);
	assert(halo >= 0, "the halo half of the indicator is missing");
	assert(ink > halo, "the ink must be drawn outside the halo, i.e. after it");
});

Deno.test("paintScene — the SCROLL REGION's own focus is drawn, because its element is clipped away", () => {
	/*
	 * The region is the only control that scrolls the grid, and it is a 1px `clip-path`ed box — its own
	 * `:focus-visible` outline is cropped to nothing. Without this a sighted keyboard reader tabs into
	 * the calendar and lands somewhere invisible (WCAG 2.4.7).
	 */
	const quiet = paint(scene({ hours: [], markers: [], events: [] }));
	const focused = paint(scene({ hours: [], markers: [], events: [], focusRegion: true }));
	const rings = (r: { ops: Op[] }) =>
		r.ops.filter((o) => o.op === "stroke" && o.stroke === PALETTE.focusRing).length;
	assertEquals(rings(quiet), 0);
	assertEquals(rings(focused), 1);
	// Drawn LAST, so a card can never be painted over the reader's own position marker.
	const last = focused.ops.filter((o) => o.op === "stroke").pop();
	assertEquals(last?.stroke, PALETTE.focusRing);
});

Deno.test("paintScene — the return-to-present pill draws a ring when its parallel control has focus", () => {
	const base = { direction: "down" as const, text: "Now", hover: false };
	const idle = paint(scene({ present: { ...base, focused: false } }));
	const held = paint(scene({ present: { ...base, focused: true } }));
	const rings = (r: { ops: Op[] }) =>
		r.ops.filter((o) => o.op === "stroke" && o.stroke === PALETTE.focusRing).length;
	assertEquals(rings(idle), 0);
	assertEquals(rings(held), 1);
});

Deno.test("paintScene — the pill's hover ring takes its weight from the palette, not a literal", () => {
	const base = { direction: "down" as const, text: "Now", hover: false, focused: false };
	const rest = paint(scene({ present: base }));
	const over = paint(scene({ present: { ...base, hover: true } }));
	const weight = (r: { ops: Op[] }, colour: string) =>
		r.ops.find((o) => o.op === "stroke" && o.stroke === colour)?.lineWidth;
	assertEquals(weight(rest, PALETTE.pillStroke), PALETTE.pillStrokeWidth);
	assertEquals(weight(over, PALETTE.pillAccent), PALETTE.pillStrokeWidthHover);
});
// #endregion

// #region Values that must come from the token layer
Deno.test("paintScene — the open-dyslexic overlay's TRACKING reaches canvas text", () => {
	/*
	 * The overlay is a family swap PLUS letter spacing, word spacing and leading — `styles/index.css`
	 * calls all three documented reading aids rather than a preference. Taking only the family would
	 * give a dyslexic reader a third of the accommodation on the canvas while every DOM label beside it
	 * widened.
	 */
	const { ops } = paint(scene());
	const title = ops.find((o) => o.op === "text:Design sync");
	const hour = ops.find((o) => o.op === "text:00:00");
	assertEquals(title?.tracking, PALETTE.titleText.letterSpacing);
	assertEquals(hour?.tracking, PALETTE.hourText.letterSpacing);
});

Deno.test("paintScene — a MASKED card's title is stepped down on the second channel too", () => {
	const masked = cards().map((c) => ({ ...c, masked: true, title: "Busy" }));
	const { ops } = paint(scene({ events: masked }));
	const title = ops.find((o) => o.op === "text:Busy");
	// The weaker FILL is one channel; the quieter type is the second. Riding the fill alone would put
	// the privacy treatment on a single channel, which is the mistake the kind axis was corrected for.
	assertEquals(title?.fill, PALETTE.maskedText.color);
});

Deno.test("paintScene — a cancelled card fades by the palette's alpha, never a literal", () => {
	const off = cards().map((c) => ({ ...c, cancelled: true }));
	const { ops } = paint(scene({ events: off }));
	assert(
		ops.some((o) => o.op === "fill" && o.alpha === PALETTE.cancelledAlpha),
		"the cancelled alpha must be the one `.cal-event--cancelled` declares",
	);
});

Deno.test("paintScene — the provenance count is drawn, and a masked card's is not", () => {
	// A ROOMY card, deliberately: the identity stack is metadata, and metadata is now drawn whole or
	// omitted (see the omit-not-clip suite). On a one-hour card at the default zoom the stack no
	// longer fits beside the time and there is no room below it for a row of its own, so the honest
	// answer there is nothing at all — which says something about the ladder, not about provenance.
	const synced = cards(96).map((c) => ({ ...c, sources: 3 }));
	const hidden = cards(96).map((c) => ({ ...c, sources: 0, masked: true }));
	const dots = (evs: typeof synced) =>
		paint(scene({ events: evs })).ops.filter((o) => o.op === "arc").length;
	assertEquals(dots(synced), 3);
	assertEquals(dots(hidden), 0);
});
// #endregion

// #region Omit, never clip
Deno.test("paintScene — metadata that does not fit is OMITTED, never ellipsised", () => {
	/*
	 * `09:0…` is not a time and `Meeting room 4, second…` is not a place: a truncated FACT still reads
	 * as a fact, so a reader spends attention on it and comes away with a wrong answer. The title is
	 * the one exception — it is the card's identity, and a card with no title is an unlabelled box.
	 */
	const long = cards(96).map((c) => ({
		...c,
		location: "Meeting room 4, second floor, east wing",
	}));
	const { ops } = paint(scene({ events: long }));
	const drawn = ops.filter((o) => o.op.startsWith("text:")).map((o) => o.op);
	assert(drawn.includes("text:02:00 – 03:00"), "the time fits whole and must still be drawn");
	assert(
		!drawn.some((t) => t.includes("…")),
		`a metadata item was truncated instead of dropped: ${drawn.join(" | ")}`,
	);
	assert(
		!drawn.some((t) => t.startsWith("text:Meeting room")),
		"the location did not fit, so no part of it may appear",
	);
});

Deno.test("paintScene — the same item IS drawn once it fits whole", () => {
	// The other half of the rule: omission has to be a measurement, not a policy of never drawing a
	// third line. Same card, same ladder, a location short enough to fit.
	const shortish = cards(96).map((c) => ({ ...c, location: "Room 4" }));
	const { ops } = paint(scene({ events: shortish }));
	assert(ops.some((o) => o.op === "text:Room 4"), "a location that fits must be drawn");
});

Deno.test("paintScene — a row with no vertical room left is dropped rather than clipped", () => {
	// A one-hour card at the default zoom has room for the title and the time and nothing else, so the
	// location's row is never taken — even though it would fit the card's WIDTH comfortably.
	const tight = cards(48).map((c) => ({ ...c, location: "Room 4" }));
	const { ops } = paint(scene({ events: tight }));
	assert(ops.some((o) => o.op === "text:Design sync"), "the title must survive");
	assertEquals(ops.some((o) => o.op === "text:Room 4"), false);
});

Deno.test("paintScene — the ladder is anchored to the TOP, not centred in the card", () => {
	/*
	 * Two cards that START together must put their titles on the same line however long they run, or a
	 * column of them has no alignment to scan down. Centring drifted with height — a three-hour card
	 * carried its title a full hour below its own start time — so the baseline is pinned to the card's
	 * top edge plus its padding, and only the rows BELOW it depend on how tall the card is.
	 */
	const at = MONDAY + 2 * HOUR;
	const one = laid([{ id: "s", title: "Design sync", kind: "sync", start: at, end: at + HOUR }]);
	const four = laid([{
		id: "t",
		title: "Design sync",
		kind: "sync",
		start: at,
		end: at + 4 * HOUR,
	}]);
	const titleY = (r: { ops: Op[] }) => r.ops.find((o) => o.op === "text:Design sync")?.args[1];
	const shallow = titleY(paint(scene({ events: one })));
	const deep = titleY(paint(scene({ events: four })));
	assert(shallow !== undefined, "the title must be drawn");
	assertEquals(shallow, deep);
});
// #endregion

// #region The instant pin
Deno.test("paintScene — an instant is drawn as a RULE, never as a card box", () => {
	/*
	 * `end === start` means the event occupies no minutes. Any box at all would give it a height the
	 * reader can measure off the hour scale and be wrong about, so the mark carries the one thing that
	 * is true — the moment — and nothing that implies a span.
	 */
	const slots = pin();
	assertEquals(slots[0].instant, true);
	assertEquals(slots[0].h, 0);
	const { ops } = paint(scene({ events: slots }));
	const danger = PALETTE.accents["--danger"];
	assert(
		ops.some((o) => o.op === "fillRect" && o.fill === PALETTE.pinInk),
		"the pin's rule is missing",
	);
	assert(
		!ops.some((o) => o.op === "fill" && (o.fill === danger.fill || o.fill === danger.fillHover)),
		"an instant must not fall through to the card path",
	);
});

Deno.test("paintScene — the pin's rule is the palette's thickness, snapped to the pixel grid", () => {
	const { ops } = paint(scene({ events: pin() }));
	const rule = ops.find((o) => o.op === "fillRect" && o.fill === PALETTE.pinInk);
	assert(rule, "no rule drawn");
	assertEquals(rule.args[3], PALETTE.pinThickness);
	assertEquals(
		rule.args[1],
		Math.round(rule.args[1]),
		"a hairline off the grid draws at half tone",
	);
});

Deno.test("paintScene — a pin carries its own START time, not the range every other card shows", () => {
	// `SceneEvent.time` is always a range because every other card needs one, and an instant's range
	// is the same instant twice — "14:00 – 14:00" states a duration the event does not have.
	const { ops } = paint(scene({ events: pin() }));
	assert(ops.some((o) => o.op === "text:02:00"), "the pin's timestamp is missing");
	assertEquals(ops.some((o) => o.op.startsWith("text:02:00 –")), false);
});

Deno.test("paintScene — an instant is never collapsed into the bubble treatment", () => {
	// The bubble threshold is a DURATION heuristic ("too short to be a card"), and a point in time has
	// no duration to be short. At any zoom the pin path answers, so no bubble pill is ever drawn.
	for (const zoom of [12, 48, 240]) {
		const { ops } = paint(scene({ events: pin(zoom) }));
		assertEquals(ops.filter((o) => o.op === "arc").length, 0, `a bubble was drawn at ${zoom}px/h`);
	}
});
// #endregion

// #region Nesting
Deno.test("paintScene — a nested card is drawn INSIDE its parent, and after it", () => {
	const slots = nestedPair();
	assertEquals(slots.find((s) => s.eventId === "inner")?.mode, "nested");
	const { ops } = paint(scene({ events: slots }));
	const primary = PALETTE.accents["--cal-ev-confirmed"];
	const parent = ops.findIndex((o) => o.op === "fill" && o.fill === primary.fill);
	const child = ops.findIndex((o) => o.op === "fill" && o.fill === primary.fillHover);
	assert(parent >= 0, "the containing card was not drawn");
	assert(child > parent, "a parent painted second would simply erase its own children");
});

Deno.test("paintScene — a nested card separates from its container on two channels", () => {
	/*
	 * Its parent is very often the same accent — a review inside a workshop is the same kind of thing
	 * — and two identical solids stacked are one solid. So the child takes the token layer's own
	 * "one step deeper" fill AND a hairline in its own verified ink. A card is interactive, which is
	 * what earns it a border under §B.4.
	 */
	const { ops } = paint(scene({ events: nestedPair() }));
	const primary = PALETTE.accents["--cal-ev-confirmed"];
	assert(
		ops.some((o) => o.op === "fill" && o.fill === primary.fillHover),
		"the nested card did not take the deeper surface",
	);
	assert(
		ops.some((o) => o.op === "stroke" && o.stroke === "rgba(74, 74, 74, 0.45)"),
		"the nested card's hairline is missing",
	);
});
// #endregion

// #region The stack
Deno.test("paintScene — a stack's silhouettes step DOWN only, never sideways", () => {
	/*
	 * A diagonal step put a slice of every silhouette outside its own column, where it read as a card
	 * in the NEXT column — and on a grid whose columns are days, a shadow leaning into tomorrow is a
	 * claim about tomorrow. Depth is expressed on the axis the cards are stacked along and nowhere
	 * else.
	 */
	const slots = foldedPair();
	const head = slots.find((s) => s.eventId === "first");
	assertEquals(head?.foldedCount, 1);
	const { ops } = paint(scene({ events: slots }));
	const primary = PALETTE.accents["--cal-ev-confirmed"];
	const traceOf = (i: number) => ops.slice(0, i).reverse().find((o) => o.op === "moveTo");
	const silhouette = ops.findIndex((o) =>
		o.op === "fill" && o.fill === primary.fill && o.alpha < 1
	);
	const card = ops.findIndex((o) => o.op === "fill" && o.fill === primary.fill && o.alpha === 1);
	assert(silhouette >= 0 && card > silhouette, "the silhouette must be drawn behind the card");
	const under = traceOf(silhouette);
	const over = traceOf(card);
	assertEquals(under?.args[0], over?.args[0], "the silhouette must not be offset horizontally");
	assert(
		(under?.args[1] ?? 0) > (over?.args[1] ?? 0),
		"the silhouette must sit BELOW the card it stands behind",
	);
});

Deno.test("paintScene — the `+N` chip is drawn into the box the hit test unfolds by", () => {
	/*
	 * It used to size itself from `measureText`, so the coin the reader could see and the coin they
	 * were pressing were two different rectangles. One rect now, resolved from the palette, so it
	 * exists without a frame having run and does not change size as `+9` becomes `+10`.
	 */
	const slots = foldedPair();
	const head = slots.find((s) => s.eventId === "first");
	assert(head);
	const geo = { gutter: 56, colW: (BOX.width - 56) / 7 };
	const target = badgeRect(head, eventRect(head, geo, 0), PALETTE);
	assert(target, "the fixture card is wide enough to carry a chip");
	const { ops } = paint(scene({ events: slots }));
	const chip = ops.findIndex((o) => o.op === "text:+1");
	assert(chip >= 0, "the chip's count is missing");
	const trace = ops.slice(0, chip).reverse().find((o) => o.op === "moveTo");
	assertEquals(trace?.args[1], target.y);
	assertEquals(trace?.args[0], target.x + target.h / 2);
});
// #endregion

// #region Hover: expansion and lift
Deno.test("hoverExpansionFor — nothing to reveal, nothing to grow", () => {
	// A one-hour card at the default zoom already shows its title and its time, and has no location,
	// no faces and no provenance to hide. Expanding it would be motion in exchange for nothing.
	const [ev] = cards(48);
	assertEquals(hoverExpansionFor(ev, PALETTE), 0);
});

Deno.test("hoverExpansionFor — a card hiding a row asks for exactly enough to show it", () => {
	/*
	 * The property that matters is not the NUMBER but that the painter agrees with it: a card expanded
	 * by what this returns must actually draw the row the expansion was for. Asserting the arithmetic
	 * instead would only restate the implementation, and would still pass on the day the two drifted.
	 */
	const [bare] = cards(48);
	const withPlace = { ...bare, location: "Room 4" };
	const extra = hoverExpansionFor(withPlace, PALETTE);
	assert(extra > 0, "a location the ladder cannot reach must be worth expanding for");

	const rest = paint(scene({ events: [withPlace] }));
	assertEquals(rest.ops.some((o) => o.op === "text:Room 4"), false, "hidden at rest");
	const grown = { ...withPlace, hoverExpandPx: extra };
	const open = paint(scene({ events: [grown], hoverId: grown.id }));
	assert(open.ops.some((o) => o.op === "text:Room 4"), "the expansion revealed nothing");
});

Deno.test("hoverExpansionFor — a pin never expands, having no ladder to lengthen", () => {
	const [instant] = pin();
	assertEquals(hoverExpansionFor(instant, PALETTE), 0);
});

Deno.test("hoverExpansionFor — is pure, and needs no canvas and no clock", () => {
	const raf = globalThis.requestAnimationFrame;
	// deno-lint-ignore no-explicit-any
	delete (globalThis as any).requestAnimationFrame;
	try {
		const [ev] = cards(48);
		const withPlace = { ...ev, location: "Room 4" };
		assertEquals(hoverExpansionFor(withPlace, PALETTE), hoverExpansionFor(withPlace, PALETTE));
	} finally {
		// deno-lint-ignore no-explicit-any
		if (raf) (globalThis as any).requestAnimationFrame = raf;
	}
});

Deno.test("paintScene — the hovered card is painted LAST, over every neighbour", () => {
	// A lift that its neighbours paint over is not a lift. The hovered card is lifted out of its own
	// bucket rather than reordered within it, so it clears pins and bubbles too.
	const list = [...cards(), ...pin()];
	const { ops } = paint(scene({ events: list, hoverId: list[0].id }));
	const primary = PALETTE.accents["--cal-ev-confirmed"];
	const hoveredCard = ops.findIndex((o) => o.op === "fill" && o.fill === primary.fillHover);
	const pinRule = ops.findIndex((o) => o.op === "fillRect" && o.fill === PALETTE.pinInk);
	assert(pinRule >= 0, "the pin must still be drawn");
	assert(hoveredCard > pinRule, "the hovered card must be raised above the pin beside it");
});

Deno.test("paintScene — the hovered card lifts with the palette's shadow, and only its body", () => {
	const list = cards();
	const { ops } = paint(scene({ events: list, hoverId: list[0].id }));
	const body = ops.find((o) =>
		o.op === "fill" && o.fill === PALETTE.accents["--cal-ev-confirmed"].fillHover
	);
	assertEquals(body?.shadow, PALETTE.liftShadow);
	assertEquals(body?.shadowBlur, PALETTE.liftBlur);
	// The card's CONTENT must not inherit it: a title with a drop shadow is a smear, and the lift
	// belongs to the silhouette.
	const title = ops.find((o) => o.op === "text:Design sync");
	assertEquals(title?.shadow ?? "", "");
});

Deno.test("paintScene — an unhovered card casts no shadow at all", () => {
	const { ops } = paint(scene());
	assert(
		!ops.some((o) => o.shadow === PALETTE.liftShadow),
		"the lift is a hover state, not a resting elevation",
	);
});
// #endregion

// #region The gauge's lever
Deno.test("paintScene — a grabbed handle morphs into the ball, and travels by the lever", () => {
	/*
	 * The lever is rate-based: it measures from where the pointer took hold, not from depth, so the
	 * handle's offset is clamped to the TRACK rather than to the scrollable range. `morph` arrives
	 * resolved — a frozen animation clock cannot strand the handle between two shapes it never drew.
	 */
	const bar = { progress: 0.5, frozen: 60, opacity: 1, active: true };
	const rest = paint(scene({ scrollbar: { ...bar, lever: null } }));
	const held = paint(scene({
		scrollbar: { ...bar, lever: { grabY: 100, displacement: 40, morph: 1 } },
	}));
	assertEquals(rest.ops.some((o) => o.op === "fill" && o.fill === PALETTE.barBallFill), false);
	const ball = held.ops.find((o) => o.op === "arc" && o.fill === PALETTE.barBallFill);
	assert(ball, "a grabbed handle must draw the ball the DOM twin draws");
	assertEquals(ball.args[2], PALETTE.barBallSize / 2, "the ball's size comes from the palette");
	// Depth alone puts the handle's centre at 250 on this track. The ball is drawn at the SATURATING
	// throw of the lever's raw travel, not at the travel itself — a stick that leaves its own socket
	// stops reading as a stick.
	assertEquals(ball.args[1], 250 + leverThrowPx(40));
	assert(leverThrowPx(40) > 0, "the lever must visibly answer the very first pixels of travel");
	assert(
		rest.ops.some((o) => o.op === "fill" && o.fill === PALETTE.barFillStrong),
		"the resting handle must still draw",
	);
});

Deno.test("paintScene — the lever's travel is clamped inside the viewport", () => {
	const held = paint(scene({
		scrollbar: {
			progress: 0.5,
			frozen: 60,
			opacity: 1,
			active: true,
			lever: { grabY: 100, displacement: 10_000, morph: 1 },
		},
	}));
	const ball = held.ops.find((o) => o.op === "arc" && o.fill === PALETTE.barBallFill);
	assert(ball, "no ball drawn");
	const cy = ball.args[1];
	assert(
		cy >= PALETTE.barInset && cy <= BOX.height - PALETTE.barInset,
		`the ball left the viewport at ${cy}`,
	);
});
// #endregion

// #region Cost
Deno.test("paintScene — a bar treatment costs the VIEWPORT, not the card it belongs to", () => {
	/*
	 * A masked all-day busy block at the island's top zoom is some 4,000px tall against a ~500px
	 * viewport. Iterating its full height issues hundreds of `fillRect`s or a couple of thousand path
	 * segments per frame, every one of them discarded by the clip a line above — the same failure
	 * `paintGrid`'s blackout hatch avoids by clamping to a visible slice.
	 */
	const tall = buildSceneEvents(
		[{ column: 0, dayStart: MONDAY, top: 0 }],
		[{
			id: "busy",
			title: "Busy",
			kind: "busy",
			start: MONDAY,
			end: MONDAY + 24 * HOUR,
		}],
		{ pxPerHour: 168, tz: "UTC", hour12: false },
	);
	assert(tall[0].h > 4000, `expected a card far taller than the viewport, got ${tall[0].h}`);
	// Scrolled so the card straddles the viewport: most of it is above, a slice is on screen.
	const { ops } = paint(scene({ events: tall, scrollTop: 3600, hours: [], markers: [] }));
	const segments = ops.filter((o) => o.op === "moveTo" || o.op === "lineTo").length;
	// Two ops per stripe over a slice at most `BOX.height` tall, plus the rounded-rect traces. The
	// unbounded version issued well over a thousand.
	assert(segments < 300, `hatch was not clamped to the visible slice: ${segments} path ops`);
});
// #endregion

// #region Mirroring
Deno.test("paintScene — under `dir=rtl` the first column is drawn at the trailing edge", () => {
	const ltr = paint(scene({ hours: [], markers: [] }), PALETTE, BOX);
	const rtl = paint(scene({ hours: [], markers: [] }), PALETTE, { ...BOX, rtl: true });
	const cardX = (r: { ops: Op[] }) => {
		const i = r.ops.findIndex((o) =>
			o.op === "fill" && o.fill === PALETTE.accents["--cal-ev-confirmed"].fill
		);
		// The rounded-rect path is traced immediately before its fill; `moveTo` carries its leading x.
		const move = r.ops.slice(0, i).reverse().find((o) => o.op === "moveTo");
		return move?.args[0] ?? NaN;
	};
	const a = cardX(ltr);
	const b = cardX(rtl);
	assert(a < BOX.width / 2, `expected column 0 near the leading edge in LTR, got ${a}`);
	assert(b > BOX.width / 2, `expected column 0 near the trailing edge in RTL, got ${b}`);
});

Deno.test("paintScene — text is never drawn through the mirror, or it would come out backwards", () => {
	const { ops } = paint(scene(), PALETTE, { ...BOX, rtl: true });
	const label = ops.find((o) => o.op === "text:00:00");
	assert(label, "the hour scale must still be drawn under RTL");
	// A mirrored context is applied as a NEGATIVE horizontal scale; the overlay pass resets to a
	// positive one and maps each box instead. A negative scale reaching the text pass is the failure.
	const scales = ops.filter((o) => o.op === "setTransform");
	assertEquals(scales[scales.length - 1].args[0] > 0, true);
});
// #endregion

function paint(s: GridScene, palette: ScenePalette = PALETTE, box: GridBox = BOX) {
	const r = recorder();
	paintScene(r.ctx, s, palette, box);
	return r;
}

Deno.test("sceneCost — counts what a frame will draw, without drawing it", () => {
	// The numbers feed a renderer-tier decision (root CLAUDE.md §8 Decision #1), so they have to mean
	// something specific rather than being a vague "complexity" score. Asserted against the shared
	// `scene()` fixture so the count tracks the real scene shape rather than a hand-built stand-in.
	const s = scene();
	const cost = sceneCost(s);

	const seams = s.columns - 1;
	const cardCount = s.events?.length ?? 0;
	const expectedShapes = s.rules.length + s.bands.length + s.blackouts.length + seams +
		cardCount * 2 + (s.markers?.length ?? 0) * 2;
	assertEquals(cost.shapes, expectedShapes);

	// Every card draws a title and a time line; every hour and marker draws one run.
	assertEquals(cost.textRuns, cardCount * 2 + (s.hours?.length ?? 0) + (s.markers?.length ?? 0));
});

Deno.test("sceneCost — an empty scene costs nothing but its lattice", () => {
	// A single column has no seams: a separator at either edge would be a border, and §B.4 reserves
	// those for interactive things.
	const cost = sceneCost({ scrollTop: 0, columns: 1, rules: [], bands: [], blackouts: [] });
	assertEquals(cost.shapes, 0);
	assertEquals(cost.textRuns, 0);
});

Deno.test("sceneCost — counting never depends on a frame, or on drawing", () => {
	// The whole point of costing separately from painting: it must be answerable with no canvas, no
	// context and no rAF, which is also why the numbers are trustworthy in a background tab.
	const rafBefore = globalThis.requestAnimationFrame;
	// deno-lint-ignore no-explicit-any
	delete (globalThis as any).requestAnimationFrame;
	try {
		assertEquals(sceneCost(scene()).shapes > 0, true);
	} finally {
		globalThis.requestAnimationFrame = rafBefore;
	}
});

// #region The 2026-08-22 interaction pass
/*
 * The channels the redesign added to a card and its chrome, each pinned against the PIXELS rather
 * than against the flag that produced them. Every one of these was found broken at least once by
 * measuring a real canvas in a browser, and none of the breaks were visible in the source.
 */

Deno.test("paintPin — a deadline's rule is a MARK, not a ruling across the column", () => {
	/*
	 * Drawn edge to edge, a deadline rule lands on the same horizontal an hour label occupies in the
	 * gutter and the eye joins the two — the mark stops reading as an event and starts reading as a
	 * grid line striking through "8:00 AM". `pinWidthFrac` is what keeps it short enough to be a mark.
	 */
	const widthOf = (frac: number) => {
		const { ops } = paint(scene({ events: pin(96) }), { ...PALETTE, pinWidthFrac: frac });
		// The rule is the pin's only `fillRect` — the chip and the stamp are rounded and go through
		// `roundRect`, which this harness records as `moveTo`/`arcTo`/`lineTo`, never `fillRect`.
		// Scoped to the pin's own INK: `paintGrid` runs first and draws every hour rule and band with
		// `fillRect` too, so an unscoped search finds a grid line and reports the same width for both.
		const rect = ops.find((o) => o.op === "fillRect" && o.fill === PALETTE.pinInk);
		return rect ? rect.args[2] : -1;
	};
	const half = widthOf(0.5);
	const full = widthOf(1);
	assert(half > 0 && full > 0, "the pin drew no rule at all");
	assert(Math.abs(half - full / 2) <= 1, `expected half of ${full}, got ${half}`);
});

Deno.test("paintPin — the rule is never shorter than the chip it carries", () => {
	// A chip with no rule under it is a sticker rather than a moment, so the fraction has a floor.
	const { ops } = paint(scene({ events: pin(96) }), { ...PALETTE, pinWidthFrac: 0.01 });
	const rect = ops.find((o) => o.op === "fillRect" && o.fill === PALETTE.pinInk);
	assert(rect, "the pin drew no rule");
	assert(
		rect.args[2] >= PALETTE.pinChipW,
		`rule ${rect.args[2]} is narrower than the ${PALETTE.pinChipW}px chip on it`,
	);
});

Deno.test("paintNow — the dot sits on the GUTTER axis, whichever column today is", () => {
	/*
	 * A horizontal position on this grid is read against ONE vertical scale — the hour gutter — so the
	 * mark that says "you are here" belongs on that axis rather than out at whichever column happens
	 * to be today. Pinned at column 5 precisely because that is where the two come apart.
	 */
	const { ops } = paint(scene({ now: { y: 100, column: 5 } }));
	const dot = ops.find((o) => o.op === "arc");
	assert(dot, "the current-time dot was not drawn");
	assertEquals(dot.args[0], 56, "the dot must be centred on the gutter axis");
});

Deno.test("paintNow — a lead-in joins the dot to a rule that is columns away", () => {
	const far = paint(scene({ now: { y: 100, column: 5 } })).ops
		.filter((o) => o.op === "fillRect" && o.fill === PALETTE.now);
	// Two runs: the day's own rule at full strength, and the quiet lead-in back to the gutter.
	assertEquals(far.length, 2, "expected the rule AND its lead-in");
	const lead = far.find((o) => (o.alpha ?? 1) < 1);
	assert(lead, "the lead-in must be drawn faint, or it reads as a fifth hour rule");
	assertEquals(lead.args[0], 56, "the lead-in starts at the gutter");
	assertEquals(lead.alpha, PALETTE.nowLeadAlpha);

	// In a single-column view the two are already the same place, so nothing extra is drawn.
	const near = paint(scene({ columns: 1, now: { y: 100, column: 0 } })).ops
		.filter((o) => o.op === "fillRect" && o.fill === PALETTE.now);
	assertEquals(near.length, 1, "a rule already at the gutter needs no lead-in");
});

Deno.test("paintCard — a BARE card draws its fill and its shape, and no text at all", () => {
	// The lattice is stripped: `paintGrid` draws the hour labels and the period marker with text of
	// its own, and this assertion is about the CARD's text.
	const bare_ = { hours: [], markers: [], rules: [], bands: [] };
	const plain = paint(scene({ ...bare_, events: cards() })).ops;
	const bare = paint(scene({ ...bare_, events: cards().map((c) => ({ ...c, bare: true })) })).ops;
	const isText = (o: { op: string }) => o.op.startsWith("text:");
	assert(plain.some(isText), "the fixture card should draw a title");
	assertEquals(
		bare.filter(isText).length,
		0,
		"a bare card must draw no text — its name is in the list popover beside it",
	);
	// It is still a card: the fill is spent, so the reader can still see WHERE it sits.
	assert(
		bare.some((o) => o.op === "fill" && o.fill === PALETTE.accents["--cal-ev-confirmed"].fill),
		"a bare card still paints its fill",
	);
});

Deno.test("paintEvents — a receded card is faded ONCE, over every part of itself", () => {
	/*
	 * A card's pixels are drawn in four places that do not share a save — the stack silhouettes run
	 * before `paintCard`'s own, the `+N` chip runs after its restore, and the pin and bubble paths
	 * have saves of their own. An alpha set inside any one of them leaves the other three at full
	 * strength, which is a card that has half receded.
	 */
	const dimmed = cards().map((c) => ({ ...c, recede: "focus" as const }));
	// Lattice stripped for the same reason: the grid is not a card and does not recede with one.
	const { ops } = paint(scene({ hours: [], markers: [], rules: [], bands: [], events: dimmed }));
	const painted = ops.filter((o) =>
		(o.op === "fill" || o.op.startsWith("text:")) && o.alpha !== undefined
	);
	assert(painted.length > 0, "nothing was drawn");
	assert(
		painted.every((o) => o.alpha === PALETTE.dimFocus),
		`every part of a receded card draws at ${PALETTE.dimFocus}`,
	);
});

Deno.test("paintEvents — recession COMPOSES with the cancelled fade, never replaces it", () => {
	// `globalAlpha` is absolute rather than cumulative, so a second assignment would silently discard
	// the first and a cancelled card in a dimmed background would come back to full strength.
	const both = cards().map((c) => ({ ...c, recede: "drag" as const, cancelled: true }));
	const { ops } = paint(scene({ hours: [], markers: [], rules: [], bands: [], events: both }));
	const fills = ops.filter((o) => o.op === "fill" && o.alpha !== undefined);
	assert(fills.length > 0);
	const want = PALETTE.dimDrag * PALETTE.cancelledAlpha;
	assert(
		fills.every((o) => Math.abs((o.alpha as number) - want) < 1e-6),
		`expected the product ${want}`,
	);
});

Deno.test("paintEvents — the highlighted card is ringed in its OWN verified ink", () => {
	const ink = PALETTE.accents["--cal-ev-confirmed"].onAccent;
	const ringed = (evs: SceneEvent[]) =>
		paint(scene({ events: evs })).ops.find((o) => o.op === "stroke" && o.stroke === ink);
	const ring = ringed(cards().map((c) => ({ ...c, highlighted: true })));
	assert(ring, "no highlight ring was drawn");
	assertEquals(ring.lineWidth, PALETTE.highlightRingWidth);
	// Nothing is ringed at rest — a ring that is always there says nothing.
	assert(!ringed(cards()), "an unhighlighted card must not be ringed");
});

Deno.test("paintSelection — a DRAFT is dashed and a live gesture is not", () => {
	/*
	 * A dash is the one shape channel that reads as "provisional" without spending a colour, and the
	 * palette has already given its four colours four meanings. A gesture still in flight stays SOLID:
	 * it is the direct shape of what the reader is doing right now, and calling that provisional would
	 * be describing the wrong thing.
	 */
	const sel = { column: 0, y: 40, h: 60, text: "09:00 – 10:00" };
	const p = { ...PALETTE, selectionDash: 5, selectionGap: 4 };
	const drafted = paint(scene({ selection: { ...sel, draft: true } }), p).ops;
	const live = paint(scene({ selection: sel }), p).ops;
	assert(
		drafted.some((o) => o.op === "setLineDash" && o.dash?.[0] === 5),
		"the draft block must be dashed",
	);
	assert(
		!live.some((o) => o.op === "setLineDash" && (o.dash?.length ?? 0) > 0),
		"a gesture in flight must stay solid",
	);
});

Deno.test("paintSelection — the DRAFT is mirrored exactly as a card is under `dir=rtl`", () => {
	/*
	 * The draft is the one new drawn thing the reader can also GRAB, so the two coordinate systems have
	 * to agree about it: `draftRect` (which the hit test resolves it through) answers in LOGICAL
	 * coordinates, and the painter maps that through `mapX` exactly once. If either side mirrored twice
	 * — or not at all — the block would be drawn in one column and grabbable in another, which is
	 * invisible in LTR and only ever wrong on a mirrored surface.
	 */
	const sel = { column: 0, y: 40, h: 60, text: "", draft: true };
	const s = scene({ hours: [], markers: [], rules: [], bands: [], events: [], selection: sel });
	const rectOf = (ops: { op: string; args: number[] }[]) => {
		// `roundRect` is recorded as its path ops; the leading `moveTo` is the box's start corner.
		const i = ops.findIndex((o) => o.op === "moveTo");
		return i < 0 ? null : ops[i].args[0];
	};
	const ltr = rectOf(paint(s, PALETTE, BOX).ops);
	const rtl = rectOf(paint(s, PALETTE, { ...BOX, rtl: true }).ops);
	assert(ltr !== null && rtl !== null, "the draft drew no box");
	// Column 0 starts at the gutter in LTR and ends at `width - gutter` in RTL: the two x positions are
	// reflections of each other about the drawable band, never the same number.
	assert(rtl! > ltr!, `expected the mirrored draft at the trailing edge; ltr ${ltr}, rtl ${rtl}`);
	assert(
		rtl! > BOX.width / 2,
		"under RTL the first column's draft belongs past the middle of the viewport",
	);
});

Deno.test("draftRect — the box the painter draws is the box the pointer grabs", () => {
	/*
	 * ONE RECTANGLE, TWO CALLERS. A box computed inside the painter and a box computed inside the hit
	 * test are two boxes, and the reader finds out by aiming at a resize edge a few pixels from the one
	 * they can see. `draftRect` is the single answer; this pins that the hit test actually consults it,
	 * including its three grab bands.
	 */
	const sel = { column: 0, y: 100, h: 60, text: "", draft: true };
	const s = scene({ events: [], selection: sel });
	const box = { width: BOX.width, height: BOX.height };
	const rect = draftRect(s, box, METRICS_D);
	assert(rect, "no draft rect");
	const mid = rect.x + rect.w / 2;
	assertEquals(hitTest(s, box, METRICS_D, mid, rect.y + rect.h / 2).kind, "draft");
	assertEquals(
		(hitTest(s, box, METRICS_D, mid, rect.y + 2) as { edge: string }).edge,
		"start",
	);
	assertEquals(
		(hitTest(s, box, METRICS_D, mid, rect.y + rect.h - 2) as { edge: string }).edge,
		"end",
	);
	assertEquals(
		(hitTest(s, box, METRICS_D, mid, rect.y + rect.h / 2) as { edge: string }).edge,
		"body",
	);
	// One pixel past the trailing edge is not the draft.
	assert(hitTest(s, box, METRICS_D, rect.x + rect.w + 2, rect.y + 10).kind !== "draft");
	// And a preview that is NOT a draft is not a target at all — a gesture in flight is already held.
	const live = scene({ events: [], selection: { ...sel, draft: false } });
	assertEquals(draftRect(live, box, METRICS_D), null);
});

/** The hit metrics the draft tests measure against — the palette's own numbers, restated once. */
const METRICS_D = {
	barWidth: PALETTE.barWidth,
	barInset: PALETTE.barInset,
	barHit: PALETTE.barHit,
	pillW: PALETTE.pillW,
	pillH: PALETTE.pillH,
	pillInset: PALETTE.pillInset,
	badgeMinW: PALETTE.badgeMinW,
	badgeH: PALETTE.badgeH,
	draftGrab: PALETTE.selectionGrab,
	draftInsetStart: PALETTE.selectionInsetStart,
	draftInsetEnd: PALETTE.selectionInsetEnd,
};
// #endregion
