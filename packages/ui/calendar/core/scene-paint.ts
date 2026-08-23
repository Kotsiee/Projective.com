/// <reference lib="dom" />
/**
 * @projective/ui/calendar — the ONE ordered pass that paints a whole time-grid viewport.
 *
 * WHY ONE PASS AND ONE CANVAS. Layered canvases are the usual reflex here, and they earn their
 * keep when the layers move independently — a static backdrop under a moving sprite sheet. Nothing
 * on this surface is static relative to anything else: a scroll of one pixel moves the rules, the
 * bands, the cards, the markers, the now-line and the gauge together, so N layers would mean N
 * clears, N transform resets and N composites for exactly the frames a single pass already redraws
 * in full. One canvas also means one backing store to keep honest against `devicePixelRatio`, and —
 * the part that actually bites — one z-order, decided here by statement order rather than by N
 * elements' stacking contexts.
 *
 * ORDER IS MEANING. Ground first (the lattice and its region tints), then the hour scale, then the
 * cards, then the things that must never be hidden BY a card: the now-line, the drag preview, the
 * period markers, the focus ring, the gauge, the pill. A card drawn over the now-line
 * would hide the one mark on the grid that says where the reader is in the day.
 *
 * NO FRAME IS EVER REQUIRED. Every routine below is a pure function of its arguments: given a scene
 * it draws the complete, final frame, with nothing interpolated and nothing scheduled. That is not a
 * testing convenience — `requestAnimationFrame`, CSS transitions and CSS `@keyframes` are all frozen
 * in a hidden or background tab, so a viewport whose pixels needed a frame would simply be blank
 * there. Where something fades (the idle gauge), the OPACITY arrives in the scene as a resolved
 * number rather than as an animation this file starts.
 *
 * THE MIRROR. The lattice pass mirrors the whole context under `dir="rtl"` (one negated horizontal
 * scale, see {@link paintGrid}) because it draws no text. This pass cannot: a mirrored context draws
 * mirrored glyphs. So it resets to an unmirrored transform and maps each logical box to a physical
 * one exactly once, in {@link mapX} — the paint code below stays written in logical coordinates,
 * where x grows from the inline start.
 */
import type {
	AccentPaint,
	GridBox,
	GridScene,
	SceneEvent,
	SceneFace,
	ScenePalette,
	TextStyle,
} from "./grid-paint.ts";
import { columnGeometry, paintGrid } from "./grid-paint.ts";
import { leverThrowPx } from "./chrome.ts";
import { CALENDAR_KIND_VIEWBOX } from "./kinds.ts";
import { resolveAvatar } from "./avatar-cache.ts";
import type { Rect } from "./scene-build.ts";
import {
	AVATAR_MAX,
	BADGE_PAD,
	badgeRect,
	DRAFT_MIN_H,
	EVENT_GAP_BLOCK,
	eventRect,
	presentRect,
	scrollbarRect,
	STACK_SHADOW_MAX,
} from "./scene-build.ts";

// #region Card metrics
/**
 * The card's internal spacing, in CSS px.
 *
 * These are the one family of numbers this module holds, and they are geometry rather than design
 * tokens: they are the canvas's restatement of `.cal-event`'s own padding and flex gaps, which are
 * authored in `calendar.css` as literal pixel gaps for the same reason (a 1px gap between two lines
 * inside a 20px card is not a step on the spacing scale). Every colour, font, radius, stroke, alpha
 * and glyph size comes from the palette.
 *
 * `padInline`/`padBlock` are the canvas's half of ONE declaration: `.cal-event` sets a uniform
 * `padding: var(--space-2)`, so the DOM card and the painted card must breathe by the same 8px or
 * the same event is drawn two ways in the two timed views. The pair was 8/5 while the ladder
 * CENTRED its text block, where a smaller block pad was invisible; anchoring the content to the top
 * makes it the card's actual top margin, and a 5px one reads cramped against an 8px inline one.
 */
const CARD = {
	padInline: 8,
	padBlock: 8,
	/**
	 * The smallest top pad a card may squeeze to.
	 *
	 * A card is drawn from {@link BUBBLE_MAX_H} px up, and 8px of pad above and below a 14px line
	 * needs 30 — so on a short card the generous pad has to give, or the title it exists to frame
	 * would be clipped by the very padding meant to protect it. See {@link padBlockFor}.
	 */
	padBlockMin: 3,
	/** Inline gap: glyph → title, and between the two halves of an identity stack. */
	gap: 5,
	/** Vertical gap between two stacked rows — `.cal-event`'s own `gap: 1px`, restated. */
	rowGap: 1,
	/** Fallback leading when `line-height` computed to `normal` and gave the palette no number. */
	lineGap: 1,
	/** Gap between two overlapped circles in a face/provider stack — see {@link paintFaceStack}. */
	faceOverlap: 0.32,
	/** Each shadow silhouette behind a stacked card steps this far DOWN (px) — never sideways. */
	shadowStep: 4,
	/**
	 * The hairline alpha separating a NESTED card from the card it is drawn inside.
	 *
	 * An alpha, not a colour: the tone it is applied to is the child's own verified ink, which the
	 * token layer already resolved. Composing an existing palette colour at a stated alpha is what
	 * {@link paintCircle} and {@link paintBadge} already do, and is the only form of colour maths
	 * this package allows itself — an alpha is a number, and a number is not a design token.
	 */
	nestEdgeAlpha: 0.45,
} as const;

/**
 * The instant marker's own geometry, in CSS px — everything about a pin that is NOT a palette value.
 *
 * The four drawing values a pin does take from the token layer (rule thickness, chip width, neutral
 * ink, chip radius) arrive on `palette.pin*`; these are the gaps and paddings between them, and they
 * are geometry for the same reason {@link CARD}'s are.
 */
const PIN = {
	/** Padding around the kind mark inside the pin's leading chip. */
	chipPad: 3,
	/** Gap between the chip and the timestamp pill. */
	gap: 4,
	/** The timestamp pill's inline padding. */
	stampPad: 5,
	/** How strongly the chip and the pill wash their own ink — the {@link paintBadge} convention. */
	chipAlpha: 0.22,
} as const;

/**
 * The separator {@link fmtRange} composes a time RANGE with.
 *
 * A pin marks one moment, and `SceneEvent.time` is always a range because every other card needs
 * one — so the leading half is taken here rather than a second time field being carried on every
 * card in the scene for the sake of the few that are instants. Read once, in {@link startStampOf},
 * against the ONE place the string is built.
 */
const RANGE_SEP = " – ";

/**
 * Below this drawn height a card has no room to be a card at all — not even its title survives a
 * legible font size — so it collapses to the Adaptive Bubble treatment (§Part 3): a small pill
 * hugging the card's trailing edge, carrying only the accent, the glyph, and — room permitting — the
 * start time. It is a canvas-space floor rather than a duration one on purpose: the same 10-minute
 * meeting is a full card at a deep zoom and a bubble at a shallow one, which is exactly the
 * information a fixed threshold on TIME could never express.
 */
const BUBBLE_MAX_H = 20;
/** A bubble's own diameter/thickness (px), and its horizontal inset from the column's trailing edge. */
const BUBBLE = { size: 14, inset: 3, gap: 3 } as const;
/**
 * How close (px, content space) two bubble-eligible cards in the SAME column have to be to read as
 * one moment rather than two — the "proximity cluster" half of §Part 3. Small enough that two cards
 * with real daylight between them (a free half hour) never merge, large enough that the few pixels a
 * hairline gutter leaves between back-to-back meetings do not read as a gap that isn't really there.
 */
const BUBBLE_CLUSTER_GAP = 3;

// #endregion

// #region Primitives
/** Map a LOGICAL box (x from the inline start) onto the physical axis. */
function mapX(x: number, w: number, box: GridBox): number {
	return box.rtl ? box.width - x - w : x;
}

/** Trace a rounded rectangle. Hand-rolled rather than `ctx.roundRect`, which is not universal. */
function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
): void {
	const rad = Math.max(0, Math.min(r, w / 2, h / 2));
	ctx.beginPath();
	ctx.moveTo(x + rad, y);
	ctx.lineTo(x + w - rad, y);
	ctx.arcTo(x + w, y, x + w, y + rad, rad);
	ctx.lineTo(x + w, y + h - rad);
	ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
	ctx.lineTo(x + rad, y + h);
	ctx.arcTo(x, y + h, x, y + h - rad, rad);
	ctx.lineTo(x, y + rad);
	ctx.arcTo(x, y, x + rad, y, rad);
	ctx.closePath();
}

/**
 * Apply a resolved text style to the context.
 *
 * `letterSpacing`/`wordSpacing` are set through a feature test rather than assumed: they are recent
 * additions to the 2D context, and a recording harness has no reason to carry them at all. Where
 * they exist the open-dyslexic overlay's tracking and word spacing reach the canvas — and
 * `measureText` accounts for both, so truncation stays honest — and where they do not, the type is
 * simply un-tracked rather than mis-measured.
 */
function useText(ctx: CanvasRenderingContext2D, style: TextStyle): void {
	ctx.font = style.font;
	ctx.fillStyle = style.color;
	ctx.textBaseline = "middle";
	if ("letterSpacing" in ctx) ctx.letterSpacing = style.letterSpacing || "normal";
	if ("wordSpacing" in ctx) ctx.wordSpacing = style.wordSpacing || "normal";
}

/** A text style's drawn line pitch (px): the resolved `line-height`, or a minimal fallback. */
function lineHeightOf(style: TextStyle): number {
	return style.lineHeight > 0 ? style.lineHeight : style.size + CARD.lineGap;
}

/**
 * A copy of `style` at a different pixel size (and, optionally, colour) — the `font` STRING has to be
 * regenerated too, because {@link useText} reads the rendered size from it rather than from
 * `style.size` (which exists for the *caller's* line-height maths, not as a second source of truth
 * `ctx.font` could drift from). Used to draw a badge/initials label a step smaller than the card's own
 * meta text without a second swatch — the avatar/badge circles are sized off the engine's own
 * geometry (`palette.avatarSize`), not off a token, so the text inside them has to follow the circle.
 */
function scaledText(style: TextStyle, size: number, color?: string): TextStyle {
	return {
		...style,
		size,
		color: color ?? style.color,
		font: style.font.replace(/[\d.]+px/, `${size}px`),
	};
}

/**
 * Truncate to fit, with a real ellipsis.
 *
 * A binary search rather than a character walk: a long location string against a 40px column would
 * otherwise cost one `measureText` per character, on every card, on every frame.
 */
export function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
	if (max <= 0) return "";
	if (ctx.measureText(text).width <= max) return text;
	const ell = "…";
	if (ctx.measureText(ell).width > max) return "";
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (ctx.measureText(text.slice(0, mid) + ell).width <= max) lo = mid;
		else hi = mid - 1;
	}
	return text.slice(0, lo) + ell;
}

/**
 * Draw one line of text inside a LOGICAL box, aligned logically and clipped by truncation.
 *
 * Returns the drawn width, which the card layout uses to place whatever follows the title.
 */
function drawText(
	ctx: CanvasRenderingContext2D,
	text: string,
	x: number,
	y: number,
	maxW: number,
	box: GridBox,
	align: "start" | "end" | "center" = "start",
): number {
	const shown = fitText(ctx, text, maxW);
	if (!shown) return 0;
	const w = ctx.measureText(shown).width;
	const logicalX = align === "start" ? x : align === "end" ? x + maxW - w : x + (maxW - w) / 2;
	ctx.textAlign = "left";
	ctx.fillText(shown, mapX(logicalX, w, box), y);
	return w;
}

/**
 * Whether the WHOLE of `text` fits in `max` px at the context's current font.
 *
 * THE RULE THIS EXISTS FOR. A card's TITLE may ellipsise: it is the card's identity, and "Quarterly
 * planning revi…" is still the thing the reader is looking for, whereas a card with no title at all
 * is an unlabelled box. Every other item on a card is METADATA, and metadata does not degrade that
 * way — `09:0…` is not a time, `Meeting room 4…` is not a place, and a face stack cut off mid-circle
 * is not a roster. A truncated fact reads as a fact, so a reader spends attention on it and gets a
 * wrong answer; an absent one reads as absent, and the card is simply quieter. So metadata is drawn
 * whole or not at all, which is what this predicate and {@link drawWhole} enforce.
 *
 * Exported because it is the pure half of that rule and is worth asserting directly.
 */
export function fitsWhole(ctx: CanvasRenderingContext2D, text: string, max: number): boolean {
	if (!text || max <= 0) return false;
	return ctx.measureText(text).width <= max;
}

/**
 * Draw one metadata item, or draw nothing — never a truncation. Returns whether it was drawn, so a
 * caller can advance its ladder only for the rows that actually landed.
 */
function drawWhole(
	ctx: CanvasRenderingContext2D,
	text: string,
	x: number,
	y: number,
	maxW: number,
	box: GridBox,
): boolean {
	if (!fitsWhole(ctx, text, maxW)) return false;
	drawText(ctx, text, x, y, maxW, box);
	return true;
}

/**
 * Snap a coordinate to a whole CSS pixel, so a thin rule lands ON the device grid rather than
 * straddling two rows of it at half intensity — the same crispness {@link paintNow} gives the
 * current-time rule, and a whole CSS pixel is a whole device pixel at every integer `dpr`.
 */
function crisp(v: number): number {
	return Math.round(v);
}

/** The START half of a `fmtRange` string — see {@link RANGE_SEP}. Passes an unseparated value
 *  through untouched, so a single-time label from anywhere else survives. */
function startStampOf(time: string): string {
	const cut = time.indexOf(RANGE_SEP);
	return cut < 0 ? time : time.slice(0, cut);
}

/**
 * Stroke an SVG path from {@link CALENDAR_KIND_PATH}, scaled into a `size`-px logical box.
 *
 * `strokePx` is the RENDERED weight, so it is divided by the path's own scale before it is set —
 * which is precisely what `vector-effect: non-scaling-stroke` does for the DOM twin of the same
 * mark, and is what lets one `--icon-stroke` govern both (§B.7).
 */
function drawGlyph(
	ctx: CanvasRenderingContext2D,
	d: string,
	x: number,
	y: number,
	size: number,
	strokePx: number,
	colour: string,
	box: GridBox,
): void {
	// `Path2D` is the whole reason the kind marks are stored as path DATA — but it is a DOM API, so a
	// context handed in by a test harness has no reason to have one, and a mark is decoration.
	if (typeof Path2D === "undefined" || size <= 0) return;
	const scale = size / CALENDAR_KIND_VIEWBOX;
	ctx.save();
	ctx.translate(mapX(x, size, box), y);
	ctx.scale(scale, scale);
	ctx.strokeStyle = colour;
	ctx.lineWidth = Math.max(strokePx, 1 / box.dpr) / scale;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.stroke(new Path2D(d));
	ctx.restore();
}
// #endregion

// #region The pass
/**
 * Paint one complete frame: the lattice backdrop and every overlay layer, in order.
 *
 * `paintGrid` is called first and untouched — the hybrid Day timeline still calls it directly with a
 * scene that carries no overlay layers, so the two views share one lattice renderer instead of two
 * that can drift by a rounding step.
 */
export function paintScene(
	ctx: CanvasRenderingContext2D,
	scene: GridScene,
	palette: ScenePalette,
	box: GridBox,
): void {
	paintGrid(ctx, scene, palette, box);
	const { width, height, dpr } = box;
	if (width <= 0 || height <= 0) return;

	// Unmirrored from here: this pass draws glyphs, and a mirrored context draws them backwards.
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	const geo = columnGeometry(scene, width);

	paintHours(ctx, scene, palette, box, geo.gutter);
	paintEvents(ctx, scene, palette, box, geo);
	paintNow(ctx, scene, palette, box, geo);
	paintSelection(ctx, scene, palette, box, geo);
	paintMarkers(ctx, scene, palette, box, geo);
	paintFocus(ctx, scene, palette, box, geo);
	paintScrollbar(ctx, scene, palette, box);
	paintPresent(ctx, scene, palette, box);
	// LAST, and around everything: the region ring must not be drawn under a card, and it is the only
	// thing on screen telling a sighted keyboard reader they have landed on the control that scrolls.
	paintRegionFocus(ctx, scene, palette, box);
}

/**
 * The two-tone ring every canvas-painted focus indicator uses.
 *
 * Traced twice around one box: the HALO touching the control and the INK outside it, the same
 * composition `--focus-ring-shadow` makes for a DOM control. A single tone cannot clear 3:1 against
 * both the card's accent-tinted fill and the grid behind it across a generated palette, and unlike a
 * DOM ring this one cannot be corrected later by a cascade.
 *
 * Both tones are drawn INSIDE the given box rather than spreading outward as a `box-shadow` does. A
 * ring that grew outward would cross the inter-card gutter into the neighbouring card of an overlap
 * cluster, and — for the region ring — would land outside the canvas, where `.cal`'s own
 * `overflow: hidden` crops it away exactly where it matters.
 */
function strokeFocusRing(
	ctx: CanvasRenderingContext2D,
	palette: ScenePalette,
	box: GridBox,
	x: number,
	y: number,
	w: number,
	h: number,
	radius: number,
): void {
	if (!palette.focusRing || w <= 0 || h <= 0) return;
	const lw = Math.max(1 / box.dpr, palette.focusRingWidth);
	/** One ring at `inset` from the box edge. */
	const ring = (colour: string, inset: number) => {
		const half = inset + lw / 2;
		roundRect(
			ctx,
			x + half,
			y + half,
			Math.max(0, w - half * 2),
			Math.max(0, h - half * 2),
			Math.max(0, radius - inset),
		);
		ctx.strokeStyle = colour;
		ctx.lineWidth = lw;
		ctx.stroke();
	};
	// Halo first, one weight further in, so it is the tone touching the control.
	if (palette.focusRingHalo) ring(palette.focusRingHalo, lw);
	ring(palette.focusRing, 0);
}

/** The ring drawn while the accessible layer's scroll REGION itself holds focus. */
function paintRegionFocus(
	ctx: CanvasRenderingContext2D,
	scene: GridScene,
	palette: ScenePalette,
	box: GridBox,
): void {
	if (!scene.focusRegion) return;
	strokeFocusRing(ctx, palette, box, 0, 0, box.width, box.height, palette.eventRadius);
}

/** The hour scale. Each label is centred ON its rule, exactly as the DOM gutter's translate did. */
function paintHours(
	ctx: CanvasRenderingContext2D,
	scene: GridScene,
	palette: ScenePalette,
	box: GridBox,
	gutter: number,
): void {
	const hours = scene.hours;
	if (!hours || hours.length === 0 || gutter <= 0) return;
	useText(ctx, palette.hourText);
	const maxW = Math.max(0, gutter - CARD.gap * 2);
	for (const row of hours) {
		const y = row.y - scene.scrollTop;
		// Half a line of slack each side: a label centred on a rule one pixel off the edge is still
		// half visible, and clipping it at exactly the edge makes the scale flicker as it scrolls.
		if (y < -palette.hourText.size || y > box.height + palette.hourText.size) continue;
		drawText(ctx, row.text, CARD.gap, y, maxW, box, "end");
	}
}

/** One laid-out card that survived the cull, with the box it will be drawn in. */
interface Visible {
	ev: SceneEvent;
	rect: Rect;
}

/**
 * The event cards, in four ordered passes over the culled+visible set.
 *
 * ORDER IS THE WHOLE JOB HERE, because this surface now draws cards INSIDE other cards:
 *
 *  1. **Full cards, parents before children.** A nested card is painted on top of the card that
 *     contains it, so a parent drawn second would simply erase its own children. `packDayEvents`
 *     already emits a container before anything it contains — it sorts by start ascending then end
 *     descending precisely so it can — and the stable sort by nest depth below makes that a fact of
 *     THIS pass rather than an assumption about another module that a future edit could quietly
 *     break.
 *  2. **Pins.** An instant has no height, so it cannot be culled by one and cannot be stacked under
 *     one; it is a mark ACROSS its band and belongs over whatever card it marks a moment inside.
 *  3. **Bubbles, and their PROXIMITY CLUSTERS** (§Part 3) — consecutive bubble-eligible cards in the
 *     same column, close enough that drawing each as its own pill would still be a wall of dots. A
 *     forward scan is enough because the list is already in scene order (column, then start time).
 *  4. **The hovered card, last of all.** Hover expands and LIFTS a card, and a lift that neighbours
 *     paint over is not a lift. It is lifted out of its own bucket above rather than reordered
 *     within it, so it clears pins and bubbles too — and a hovered bubble consequently never merges
 *     into a proximity cluster, which is right: the reader has singled it out.
 */
function paintEvents(
	ctx: CanvasRenderingContext2D,
	scene: GridScene,
	palette: ScenePalette,
	box: GridBox,
	geo: { gutter: number; colW: number },
): void {
	const events = scene.events;
	if (!events || events.length === 0) return;

	const cards: Visible[] = [];
	const pins: Visible[] = [];
	const bubbles: Visible[] = [];
	/*
	 * Every card that survived the cull, by id — what a nested PIN reads its ink off (see
	 * {@link pinInkFor}). A parent's box strictly contains its child's, so a visible child always has
	 * a visible parent and this map is never missing an entry a pin actually needs.
	 */
	const visibleById = new Map<string, SceneEvent>();
	let hovered: Visible | null = null;

	for (const ev of events) {
		// See `SceneEvent.drawn` — the one flag this pass and `hitTest` both read, so the pixels and
		// the pointer targets cannot disagree about which cards exist.
		if (!ev.drawn) continue;
		const rect = eventRect(ev, geo, scene.scrollTop);
		// The spatial cull. One Week block is 24 hours tall — some 4000px at maximum zoom against a
		// ~600px viewport — so without this every card in every rendered block would be stroked, text
		// measured and all, for pixels nobody can see.
		if (rect.y + rect.h < 0 || rect.y > box.height) continue;
		visibleById.set(ev.id, ev);
		const entry: Visible = { ev, rect };
		if (scene.hoverId === ev.id) hovered = entry;
		else if (ev.instant) pins.push(entry);
		else if (rect.h < BUBBLE_MAX_H) bubbles.push(entry);
		else cards.push(entry);
	}

	cards.sort((a, b) => a.ev.nestDepth - b.ev.nestDepth);
	for (const entry of cards) paintEntry(ctx, entry, scene, palette, box, visibleById);
	for (const entry of pins) paintEntry(ctx, entry, scene, palette, box, visibleById);

	let i = 0;
	while (i < bubbles.length) {
		let j = i + 1;
		while (
			j < bubbles.length &&
			bubbles[j].ev.column === bubbles[i].ev.column &&
			bubbles[j].rect.y - (bubbles[j - 1].rect.y + bubbles[j - 1].rect.h) <= BUBBLE_CLUSTER_GAP
		) j++;
		const run = bubbles.slice(i, j);
		// A cluster is several events drawn as one pip, so it recedes only as far as its LEAST receded
		// member: if any of them is the card the reader is pointing at, the pip is not background.
		const runAlpha = Math.max(...run.map((r) => recedeAlpha(r.ev.recede, palette)));
		const runFaded = runAlpha < 1;
		if (runFaded) {
			ctx.save();
			ctx.globalAlpha = runAlpha;
		}
		if (run.length === 1) paintBubble(ctx, run[0].ev, run[0].rect, palette, box);
		else paintBubbleCluster(ctx, run, palette, box);
		if (runFaded) ctx.restore();
		i = j;
	}

	if (hovered) paintEntry(ctx, hovered, scene, palette, box, visibleById);
}

/**
 * Route one card to the treatment its own geometry asks for.
 *
 * The three are mutually exclusive and the ORDER of the tests is load-bearing. An instant is checked
 * FIRST because its height is zero: falling through to the bubble test — which is a duration
 * heuristic, "this event is too short to be drawn as a card" — would file a point in time under
 * "very brief", which is exactly the confusion `SceneEvent.instant` exists to prevent. A deadline is
 * not a short meeting.
 */
function paintEntry(
	ctx: CanvasRenderingContext2D,
	entry: Visible,
	scene: GridScene,
	palette: ScenePalette,
	box: GridBox,
	visibleById: ReadonlyMap<string, SceneEvent>,
): void {
	const { ev, rect } = entry;
	/*
	 * THE SINGLE PLACE A CARD'S OPACITY IS ESTABLISHED.
	 *
	 * It has to be here rather than inside the three treatments, because a card's pixels are drawn in
	 * four places that do not share a save: the stack silhouettes run BEFORE `paintCard`'s own save,
	 * the `+N` chip runs AFTER its restore, and the pin and bubble paths have saves of their own. An
	 * alpha set in any one of them would leave the other three at full strength, which is a card that
	 * has half receded — the least readable of the three possible states.
	 *
	 * Everything downstream COMPOSES (`*=`) rather than assigns, so a cancelled card inside a dimmed
	 * background is drawn at the product of the two.
	 */
	const alpha = recedeAlpha(ev.recede, palette);
	const faded = alpha < 1;
	if (faded) {
		ctx.save();
		ctx.globalAlpha = alpha;
	}
	if (ev.instant) paintPin(ctx, ev, rect, palette, box, pinInkFor(ev, palette, visibleById));
	else if (rect.h < BUBBLE_MAX_H) paintBubble(ctx, ev, rect, palette, box);
	else paintCard(ctx, ev, rect, scene, palette, box);
	if (faded) ctx.restore();
	if (ev.highlighted && !ev.instant) paintHighlightRing(ctx, ev, rect, palette, box);
}

/**
 * Resolve a recession state to the opacity the token layer says it is.
 *
 * The two depths are palette values, never numbers this package holds: `--cal-dim-drag` and
 * `--cal-dim-focus` are the same declarations the DOM day timeline reads, so the two renderings of one
 * card recede by one number rather than by two that happen to agree today. A palette that did not
 * resolve (`0`) means "the stylesheet is not there" rather than "invisible", so it falls back to full
 * strength — a layer this package cannot draw honestly is a layer it draws unchanged.
 */
function recedeAlpha(recede: SceneEvent["recede"], palette: ScenePalette): number {
	const v = recede === "drag" ? palette.dimDrag : recede === "focus" ? palette.dimFocus : 1;
	return v > 0 && v < 1 ? v : 1;
}

/**
 * Ring the one card the reader is pointing at, from a list that is not on the grid.
 *
 * INSIDE the card's own edge, in the card's own verified `onAccent` ink. A ring drawn AROUND a card
 * abuts the grid on one side and the fill on the other and would need the same two-tone construction
 * `focusRing` documents; an inset ring has exactly one background — the fill it sits on — and the
 * theme engine has already verified that pair. It is drawn after the card and outside its clip, so a
 * card that clipped its own contents cannot clip its own ring.
 *
 * A PIN is exempt: it has no box to ring, and a rectangle drawn round a 2px rule would be a mark for
 * a shape that is not there. Its own full-strength ink against dimmed neighbours is the signal.
 */
function paintHighlightRing(
	ctx: CanvasRenderingContext2D,
	ev: SceneEvent,
	rect: Rect,
	palette: ScenePalette,
	box: GridBox,
): void {
	const w = Math.max(1 / box.dpr, palette.highlightRingWidth);
	if (w <= 0 || rect.w <= w * 2 || rect.h <= w * 2) return;
	const accent = palette.accents[ev.accent] ?? palette.accentFallback;
	const ink = ev.masked ? (palette.maskedText.color || palette.titleText.color) : accent.onAccent;
	if (!ink) return;
	ctx.save();
	roundRect(
		ctx,
		mapX(rect.x + w / 2, rect.w - w, box),
		rect.y + w / 2,
		rect.w - w,
		rect.h - w,
		Math.max(0, palette.eventRadius - w / 2),
	);
	ctx.strokeStyle = ink;
	ctx.lineWidth = w;
	ctx.stroke();
	ctx.restore();
}

/**
 * The card's top pad for a given drawn height.
 *
 * {@link CARD.padBlock} is what the card ASKS for and what it gets at any ordinary size. A card is
 * drawn from {@link BUBBLE_MAX_H} px upward, though, and 8px above and below a 14px line needs 30 —
 * so on a short card the pad has to give, or the padding meant to frame the title would be the thing
 * clipping it. It gives symmetrically and stops at {@link CARD.padBlockMin}, below which the title
 * simply overflows into the card's own rounded corners, which is the honest end of the line.
 */
function padBlockFor(h: number, titleH: number): number {
	return Math.max(CARD.padBlockMin, Math.min(CARD.padBlock, (h - titleH) / 2));
}

/**
 * The hovered card's LIFT: an ambient drop shadow, and a small scale about the card's own TOP-CENTRE.
 *
 * Top-centre rather than the middle so the growth still reads as the card expanding DOWNWARD into the
 * time it occupies — scaling about the centre would push the card's top edge up past its own start
 * time, which on a time axis is a false statement about when the thing begins.
 *
 * Both numbers come from the palette (`.cal-grid__swatch--lift` restates `--elevation-medium`'s three
 * components plus the scale, so the contrast overlay that flattens shadows product-wide flattens this
 * one too). Neither is interpolated here: the card's EXTRA HEIGHT arrives on the scene already
 * resolved by the caller's spring, and this is the static presentation of the state it resolved to.
 */
function applyLift(
	ctx: CanvasRenderingContext2D,
	palette: ScenePalette,
	box: GridBox,
	rect: Rect,
): void {
	if (palette.liftShadow && palette.liftBlur > 0) {
		ctx.shadowColor = palette.liftShadow;
		ctx.shadowBlur = palette.liftBlur;
		ctx.shadowOffsetY = palette.liftOffsetY;
	}
	const scale = palette.liftScale;
	if (!(scale > 0) || scale === 1) return;
	const cx = mapX(rect.x + rect.w / 2, 0, box);
	ctx.translate(cx, rect.y);
	ctx.scale(scale, scale);
	ctx.translate(-cx, -rect.y);
}

/** Drop the shadow before the card's CONTENT is drawn — a title with a drop shadow is a smear, and
 *  the lift belongs to the card's silhouette, not to every glyph inside it. */
function clearShadow(ctx: CanvasRenderingContext2D): void {
	ctx.shadowColor = "transparent";
	ctx.shadowBlur = 0;
	ctx.shadowOffsetY = 0;
}

function paintCard(
	ctx: CanvasRenderingContext2D,
	ev: SceneEvent,
	rect: Rect,
	scene: GridScene,
	palette: ScenePalette,
	box: GridBox,
): void {
	const accent = palette.accents[ev.accent] ?? palette.accentFallback;
	// `rect` is already the DRAWN box: the inter-card gutter is taken off inside `eventRect`, which
	// the hit test calls too, so what is clicked and what is painted cannot come apart.
	const w = rect.w;
	if (w <= 0) return;
	const x = mapX(rect.x, w, box);

	/*
	 * The stack's shadow silhouettes, BEHIND the primary — capped at `STACK_SHADOW_MAX` regardless of
	 * the true depth (a cluster of nine still reads as "a stack", not nine visible steps). Drawn in
	 * the primary's own fill, one step fainter per layer, so the read is "more of the same card" —
	 * exactly what is true — rather than a mismatched decoration.
	 *
	 * They step DOWN only. The diagonal step they used to take put a slice of every silhouette
	 * outside the card's own column, where it read as a card in the next column rather than as depth
	 * under this one — and on a grid whose columns are days, a shadow that leans into tomorrow is a
	 * claim about tomorrow. Depth is expressed on the axis the cards are stacked along and nowhere
	 * else.
	 *
	 * `foldedCount`, not `clusterSize`: what a silhouette stands for is a card HIDDEN under this one,
	 * and since the placement engine draws nested and split members at their own true positions, a
	 * cluster of three can easily have nothing hidden at all. Keying off the cluster would have this
	 * card claim depth it does not have.
	 */
	if (ev.foldedCount > 0) {
		const layers = Math.min(STACK_SHADOW_MAX, ev.foldedCount);
		const fill = ev.masked ? accent.fillMasked : accent.fill;
		if (fill) {
			for (let s = layers; s >= 1; s--) {
				ctx.save();
				// Composed with whatever the caller established, for the same reason as above.
				ctx.globalAlpha *= Math.max(0.14, 0.42 - s * 0.14);
				roundRect(ctx, x, rect.y + CARD.shadowStep * s, w, rect.h, palette.eventRadius);
				ctx.fillStyle = fill;
				ctx.fill();
				ctx.restore();
			}
		}
	}

	const hovered = scene.hoverId === ev.id;
	const nested = ev.mode === "nested";

	ctx.save();
	// `*=`, never `=`: a card can be cancelled AND receded behind an interaction, and `globalAlpha` is
	// absolute rather than cumulative, so a second assignment would silently discard the first.
	if (ev.cancelled && palette.cancelledAlpha > 0) ctx.globalAlpha *= palette.cancelledAlpha;
	if (hovered) applyLift(ctx, palette, box, rect);
	roundRect(ctx, x, rect.y, w, rect.h, palette.eventRadius);
	/*
	 * A NESTED card takes the hovered — i.e. one step DEEPER — fill at rest, because it is drawn on
	 * top of a card that is very often the same accent (a review inside a workshop is usually the same
	 * kind of thing), and two identical solids stacked are one solid. The step is authored in
	 * `calendar.css` as `color-mix(… var(--cal-accent) 88%, black)`, so it is a token decision rather
	 * than one this file makes; and hover keeps its own channel regardless, since the lift and the
	 * expansion are what a hovered card actually announces itself with now.
	 */
	const fill = ev.masked ? accent.fillMasked : hovered || nested ? accent.fillHover : accent.fill;
	ctx.fillStyle = fill;
	ctx.fill();
	clearShadow(ctx);

	// A MASKED card is stepped down on TWO axes, exactly as `.cal-event--masked .cal-event__title` is:
	// the quiet wash above (never the solid accent) and a quieter ink here, both unrelated to any
	// particular accent. A REAL card's ink is the accent's own verified "on-" pair — the fill is now
	// the accent at full strength, so `--on-surface` would not reliably clear contrast against it the
	// way it did against the old 16% wash.
	const ink = ev.masked ? (palette.maskedText.color || palette.titleText.color) : accent.onAccent;
	/*
	 * The nested card's second separation device, and the reason it is allowed a second one at all:
	 * §B.4 reserves full borders for INTERACTIVE things, and a card is a button. It is stroked on the
	 * fill's own path, before the clip, so half the hairline lands outside the card — which is what an
	 * edge is. One hairline in the card's own verified ink, at a stated alpha; no new colour.
	 */
	if (nested && ink) {
		ctx.strokeStyle = `rgba(${hexToRgbTriplet(ink)}, ${CARD.nestEdgeAlpha})`;
		ctx.lineWidth = Math.max(1 / box.dpr, 1);
		ctx.stroke();
	}
	/*
	 * The accent's own OPTIONAL edge — the Tentative group's border, and nothing else in the shipped
	 * palette. It is drawn on the same path, AFTER the nested hairline, because the two say different
	 * things and the more specific one has to survive: a nested tentative card is still tentative, and
	 * a containment hairline drawn over its identity border would erase the only channel a pale wash
	 * has. `edgeWidth === 0` is the palette's "draw nothing", so an unbordered accent costs one
	 * comparison and no pixels.
	 *
	 * A MASKED card is deliberately exempt. Its fill is already the quiet wash, and a bordered masked
	 * block would advertise "this one is different" about an entry the viewer is not entitled to
	 * identify at all (§Part 1.4).
	 */
	if (!ev.masked && accent.edgeWidth > 0 && accent.edge) {
		ctx.strokeStyle = accent.edge;
		ctx.lineWidth = Math.max(1 / box.dpr, accent.edgeWidth);
		ctx.stroke();
	}
	ctx.clip();

	/*
	 * A BARE CARD STOPS HERE — fill, shape, edge, and nothing else.
	 *
	 * It is a member of an EXPANDED overlap cluster (see `SceneEvent.bare`), which means it is one of
	 * N narrow lanes drawn so the reader can see WHERE each of them sits. Six titles clipped to three
	 * characters is not six titles; the names are in the list popover the expansion opened with, at a
	 * full line each, and hovering a row there rings the block this one is.
	 *
	 * The `+N` chip is skipped with the rest, and that is not an oversight: an expanded cluster has
	 * nothing folded under it, so `foldedCount` is already 0 and the chip would print `+0`.
	 */
	if (ev.bare) {
		ctx.restore();
		return;
	}

	const titleStyle: TextStyle = { ...palette.titleText, color: ink || palette.titleText.color };
	const metaStyle: TextStyle = {
		...palette.metaText,
		color: ev.masked ? palette.metaText.color : (ink || palette.metaText.color),
	};
	const markColour = ink || accent.accent;
	const titleH = lineHeightOf(titleStyle);
	const metaH = lineHeightOf(metaStyle);

	/*
	 * THE LADDER RUNS FROM THE TOP. It used to centre its whole text block in the card, which reads
	 * tolerably at exactly one height and drifts at every other — two cards of different durations put
	 * their titles on two different lines, so a column of them has no alignment to scan down at all.
	 * A calendar card's title belongs at its start time, which is its top edge.
	 *
	 * Each rung below is offered a row and takes it only if the row FITS on both axes: vertically
	 * inside the card's own padded box, and horizontally at the item's full length. Nothing is
	 * ellipsised but the title — see {@link fitsWhole} for why metadata may not be.
	 */
	const pad = padBlockFor(rect.h, titleH);
	const contentTop = rect.y + pad;
	const contentBottom = rect.y + rect.h - pad;
	const contentX = rect.x + CARD.padInline;
	const contentW = rect.w - CARD.padInline * 2;
	if (contentW <= 0) {
		ctx.restore();
		return;
	}

	/*
	 * The `+N` chip sits ON the card's top-trailing corner, so the rows it overlaps are narrower by
	 * its box. Rows BELOW it get the full width back — reserving the whole card's width for a chip
	 * that occupies one corner would cost every line on the card for the sake of one.
	 */
	const badge = badgeRect(ev, rect, palette);
	const badgeBottom = badge ? badge.y + badge.h : rect.y;
	const rowW = (top: number): number =>
		Math.max(0, contentW - (badge && top < badgeBottom ? badge.w + BADGE_PAD * 2 : 0));

	// #region The ladder
	let rowTop = contentTop;

	// Rung 1 — the kind mark and the title, the one item allowed to ellipsise.
	const titleMid = rowTop + titleH / 2;
	const glyphSize = Math.min(palette.glyphSize, Math.max(0, contentW));
	drawGlyph(
		ctx,
		ev.glyph,
		contentX,
		titleMid - glyphSize / 2,
		glyphSize,
		palette.glyphStroke,
		markColour,
		box,
	);
	const titleX = contentX + glyphSize + CARD.gap;
	const titleW = Math.max(0, rowW(rowTop) - glyphSize - CARD.gap);
	useText(ctx, titleStyle);
	const drawn = drawText(ctx, ev.title, titleX, titleMid, titleW, box);
	if (ev.cancelled && drawn > 0) {
		// The cancelled state rides two channels, exactly as `.cal-event--cancelled` does: the alpha
		// above, and this line through the title. Colour alone would not survive a CVD overlay.
		ctx.fillRect(mapX(titleX, drawn, box), crisp(titleMid), drawn, Math.max(1, 1 / box.dpr));
	}
	rowTop += titleH;

	/** The top of the next row, or null when the card has no vertical room left for one. */
	const takeRow = (h: number): number | null => {
		const top = rowTop + CARD.rowGap;
		return top + h > contentBottom ? null : top;
	};

	const hasIdentity = ev.faces.length > 0 || ev.sources > 0;
	const stackW = hasIdentity ? identityStackWidth(ev, palette) : 0;
	let identityDrawn = false;

	// Rung 2 — the time, the attendee counter beside it, and the identity stack on the trailing edge.
	// Three separate metadata ITEMS sharing one row, each admitted or omitted on its own.
	const timeTop = ev.time ? takeRow(metaH) : null;
	if (timeTop !== null) {
		const mid = timeTop + metaH / 2;
		const maxW = rowW(timeTop);
		useText(ctx, metaStyle);
		/*
		 * The stack rides the trailing edge only where the TIME still fits whole beside it, and only
		 * where a circle that overhangs the row would not overhang the CARD. The time wins the
		 * tie-break because the row exists for it; the stack's fallback is a row of its own further
		 * down, and failing that the hover expansion, which {@link hoverExpansionFor} sizes for exactly
		 * this case.
		 */
		const fitsBeside = stackW > 0 && stackW <= maxW &&
			mid - palette.avatarSize / 2 >= rect.y &&
			mid + palette.avatarSize / 2 <= rect.y + rect.h &&
			fitsWhole(ctx, ev.time, maxW - stackW - CARD.gap);
		const textW = fitsBeside ? maxW - stackW - CARD.gap : maxW;
		const withCount = ev.attendees ? `${ev.time} · ${ev.attendees}` : "";
		if (!withCount || !drawWhole(ctx, withCount, contentX, mid, textW, box)) {
			drawWhole(ctx, ev.time, contentX, mid, textW, box);
		}
		if (fitsBeside) {
			paintIdentityStack(
				ctx,
				ev,
				contentX + maxW - stackW,
				mid,
				accent,
				ink || accent.accent,
				palette,
				box,
			);
			identityDrawn = true;
		}
		rowTop = timeTop + metaH;
	}

	// Rung 3 — the location.
	const locTop = ev.location ? takeRow(metaH) : null;
	if (locTop !== null) {
		useText(ctx, metaStyle);
		if (drawWhole(ctx, ev.location, contentX, locTop + metaH / 2, rowW(locTop), box)) {
			rowTop = locTop + metaH;
		}
	}

	// Rung 4 — the identity row: host + participants leading, synced-calendar provenance trailing.
	if (hasIdentity && !identityDrawn && palette.avatarSize > 0) {
		const top = takeRow(palette.avatarSize);
		if (top !== null && stackW > 0 && stackW <= rowW(top)) {
			paintIdentityStack(
				ctx,
				ev,
				contentX,
				top + palette.avatarSize / 2,
				accent,
				ink || accent.accent,
				palette,
				box,
			);
			rowTop = top + palette.avatarSize;
		}
	}
	// #endregion

	ctx.restore();

	// The stack's `+N` chip — drawn OUTSIDE the clip, into the SAME box `hitTest` resolves it to, so
	// the target that unfolds a cluster is exactly the coin the reader is aiming at.
	if (badge) paintBadge(ctx, `+${ev.foldedCount}`, badge, ink || accent.accent, fill, palette, box);
}

/**
 * How many EXTRA pixels this card needs to show everything it is currently hiding — `0` when it hides
 * nothing. Pure, clockless and canvas-free, so the caller's hover spring can be sized from it before
 * a single frame has run.
 *
 * IT IS DERIVED FROM THE PAINTER'S OWN LADDER, rung for rung, which is the only way the two can be
 * kept from disagreeing: a card that expanded by a number computed somewhere else would grow to a
 * height at which the painter still declines to draw the row the growth was for, and the reader would
 * watch a card get taller and reveal nothing.
 *
 * TWO DELIBERATE APPROXIMATIONS, both in the direction of promising less than it delivers:
 *
 *  - **It counts rows, not widths.** A column's pixel width is not a property of the card and is not
 *    knowable here; an item that still will not fit horizontally once the card is taller is simply
 *    omitted, exactly as rule {@link fitsWhole} says. So this is a lower bound on what the expansion
 *    reveals, never an overstatement.
 *  - **The identity stack is costed as its own ROW whenever the card has one**, even though at rest
 *    it may already be riding the meta line's trailing edge. Riding that edge is the CONSTRAINED
 *    presentation — it is what a card does when it cannot afford the row — and asking the expansion
 *    to preserve a constraint would be asking it to reveal nothing.
 *
 * An INSTANT returns `0`: a pin has no height, so there is no ladder to lengthen and nothing an extra
 * pixel could buy it.
 */
export function hoverExpansionFor(ev: SceneEvent, palette: ScenePalette): number {
	if (ev.instant) return 0;
	const titleH = lineHeightOf(palette.titleText);
	const metaH = lineHeightOf(palette.metaText);
	// The full pad, not `padBlockFor`'s squeezed one: what is being sized here is the card the reader
	// gets AFTER the expansion, and a card tall enough to want another row is tall enough to breathe.
	let wanted = CARD.padBlock * 2 + titleH;
	if (ev.time) wanted += CARD.rowGap + metaH;
	if (ev.location) wanted += CARD.rowGap + metaH;
	if (ev.faces.length > 0 || ev.sources > 0) wanted += CARD.rowGap + palette.avatarSize;
	// The RESTING drawn height, with the inter-card gutter already taken off — the same subtraction
	// `eventRect` makes. It deliberately excludes `hoverExpandPx`: measuring against the box as it is
	// currently drawn would shrink the target as the spring approached it, and the card would creep
	// toward a height it never reached.
	const rest = Math.max(0, ev.h - EVENT_GAP_BLOCK);
	return Math.max(0, wanted - rest);
}

/**
 * A pin's ink.
 *
 * A pin drawn INSIDE a card is a mark on that card's fill, so it takes the card's own verified "on-"
 * ink and is exactly as legible as the container's title. A pin standing on the grid takes the
 * neutral one the pin swatch declares. The event's own accent is the last resort, for a consumer
 * whose stylesheet did not reach the pin swatch at all.
 */
function pinInkFor(
	ev: SceneEvent,
	palette: ScenePalette,
	visibleById: ReadonlyMap<string, SceneEvent>,
): string {
	const parent = ev.parentCardId ? visibleById.get(ev.parentCardId) : undefined;
	const onParent = parent
		? (palette.accents[parent.accent] ?? palette.accentFallback).onAccent
		: "";
	const own = (palette.accents[ev.accent] ?? palette.accentFallback).accent;
	return onParent || palette.pinInk || own;
}

/**
 * The INSTANT marker (`end === start`): a deadline, a hand-off, a submission cut-off.
 *
 * It is drawn as a rule with a chip on it and NOT as a box, and that is the whole point of the
 * routine existing. `CalendarEvent.end === start` means the event occupies no minutes; a card drawn
 * for it would have to invent a height, and any height at all is a duration the reader can measure
 * off the axis and be wrong about. So the mark carries the one thing that is true — the moment —
 * across the full width of its band, with its kind on a chip at the leading edge and its timestamp on
 * a pill beside that.
 *
 * The pointer target is elsewhere and is deliberately larger: `eventRect` returns an `INSTANT_HIT_H`
 * band centred on the moment, so a two-pixel rule is still a pressable thing without the drawing
 * being thickened to meet a target floor — the same split the depth gauge makes between what it
 * draws and what it can be grabbed by.
 */
function paintPin(
	ctx: CanvasRenderingContext2D,
	ev: SceneEvent,
	rect: Rect,
	palette: ScenePalette,
	box: GridBox,
	ink: string,
): void {
	const w = rect.w;
	if (w <= 0 || !ink) return;
	// The rect is the HIT band, centred on the moment; the moment itself is its centre line.
	const y = rect.y + rect.h / 2;
	const thickness = Math.max(1 / box.dpr, palette.pinThickness);

	ctx.save();
	// `*=`, never `=`: a card can be cancelled AND receded behind an interaction, and `globalAlpha` is
	// absolute rather than cumulative, so a second assignment would silently discard the first.
	if (ev.cancelled && palette.cancelledAlpha > 0) ctx.globalAlpha *= palette.cancelledAlpha;

	/*
	 * THE RULE IS DELIBERATELY SHORTER THAN ITS BAND.
	 *
	 * Drawn edge to edge, a deadline rule sits on exactly the horizontal an hour label occupies in the
	 * gutter beside it, and the eye joins the two: the mark stops reading as an event and starts
	 * reading as a grid line that happens to strike through "8:00 AM". At `pinWidthFrac` of the band
	 * it starts where every card in that column starts — so the alignment that says "this belongs to
	 * this day" is kept — and stops well short of the far edge, which is what makes it a mark rather
	 * than a ruling.
	 *
	 * The floor is the CHIP: whatever the fraction, the rule is never shorter than the leading chip it
	 * carries, because a chip with no rule under it is a sticker rather than a moment. The HIT band
	 * (`rect`) is untouched — the target stays the full band, exactly as `INSTANT_HIT_H` keeps a 2px
	 * mark a 20px target vertically.
	 */
	const ruleW = Math.max(
		Math.min(palette.pinChipW, w),
		Math.min(w, w * (palette.pinWidthFrac > 0 ? palette.pinWidthFrac : 1)),
	);

	ctx.fillStyle = ink;
	ctx.fillRect(mapX(rect.x, ruleW, box), crisp(y - thickness / 2), ruleW, thickness);

	// The chip: the kind mark, at the leading edge, washed in its own ink so the rule reads through it
	// as one mark rather than as a rule that has been interrupted by a sticker.
	const chipW = Math.min(palette.pinChipW, w);
	const glyphSize = Math.min(palette.glyphSize, Math.max(0, chipW - PIN.chipPad * 2));
	const chipH = glyphSize + PIN.chipPad * 2;
	if (chipW > 0 && glyphSize > 0) {
		roundRect(ctx, mapX(rect.x, chipW, box), y - chipH / 2, chipW, chipH, palette.pinRadius);
		ctx.fillStyle = `rgba(${hexToRgbTriplet(ink)}, ${PIN.chipAlpha})`;
		ctx.fill();
		drawGlyph(
			ctx,
			ev.glyph,
			rect.x + (chipW - glyphSize) / 2,
			y - glyphSize / 2,
			glyphSize,
			palette.glyphStroke,
			ink,
			box,
		);
	}

	// The timestamp pill. Metadata, so it is drawn whole or not at all — a pin whose stamp ran past
	// the band would be a time the reader could misread, and a pin with no stamp is still a pin at a
	// position they can read off the hour scale.
	const stamp = startStampOf(ev.time);
	if (stamp && palette.metaText.font) {
		const stampStyle: TextStyle = { ...palette.metaText, color: ink };
		useText(ctx, stampStyle);
		const textW = ctx.measureText(stamp).width;
		const pillW = textW + PIN.stampPad * 2;
		const pillH = Math.max(palette.metaText.size + PIN.chipPad, chipH);
		const pillX = rect.x + chipW + PIN.gap;
		if (textW > 0 && pillX + pillW <= rect.x + ruleW) {
			roundRect(ctx, mapX(pillX, pillW, box), y - pillH / 2, pillW, pillH, pillH / 2);
			ctx.fillStyle = `rgba(${hexToRgbTriplet(ink)}, ${PIN.chipAlpha})`;
			ctx.fill();
			useText(ctx, stampStyle);
			drawText(ctx, stamp, pillX + PIN.stampPad, y, textW, box);
		}
	}
	ctx.restore();
}

/**
 * The width (px) {@link paintIdentityStack} needs for `ev`'s faces + provenance — what a caller
 * reserves out of a text line's own width before drawing it, the same way the pre-2026-08-20 card
 * reserved room for its provenance dots on the title line.
 */
function identityStackWidth(ev: SceneEvent, palette: ScenePalette): number {
	const d = palette.avatarSize;
	if (d <= 0) return 0;
	const step = d * (1 - CARD.faceOverlap);
	const stackW = (count: number) => {
		if (count <= 0) return 0;
		const shown = Math.min(count, AVATAR_MAX);
		return d + (shown - 1) * step + (count > shown ? step + CARD.gap : 0);
	};
	const facesW = stackW(ev.faces.length);
	const sourcesW = stackW(ev.sources);
	return facesW + sourcesW + (facesW > 0 && sourcesW > 0 ? CARD.gap : 0);
}

/**
 * The identity row: host + participants, then synced-calendar provenance, drawn left to right from
 * `x` — the SAME "overlapping circles, max {@link AVATAR_MAX}, then a `+N` chip" convention for both,
 * because a face and a provider dot are both answering "who/what else is on this", just on different
 * axes. One function for both call sites in `paintCard` (the dedicated bottom row on a spacious card,
 * and the trailing share of the meta line on an ordinary one), so the two can never draw it two ways.
 */
function paintIdentityStack(
	ctx: CanvasRenderingContext2D,
	ev: SceneEvent,
	x: number,
	cy: number,
	accent: AccentPaint,
	ink: string,
	palette: ScenePalette,
	box: GridBox,
): void {
	let cursor = x;
	if (ev.faces.length > 0) {
		cursor = paintFaceStack(ctx, ev.faces, cursor, cy, accent, ink, palette, box);
	}
	if (ev.sources > 0) {
		if (ev.faces.length > 0) cursor += CARD.gap;
		paintProviderStack(ctx, ev.sources, cursor, cy, accent, ink, palette, box);
	}
}

/**
 * The overlapping face stack: up to {@link AVATAR_MAX} circles (a loaded photo, or an initials
 * fallback drawn synchronously — see `core/avatar-cache.ts`), then a `+N` overflow pip. Returns the
 * x one step past the LAST circle drawn, so a trailing provider stack knows where it may start.
 */
function paintFaceStack(
	ctx: CanvasRenderingContext2D,
	faces: readonly SceneFace[],
	x: number,
	cy: number,
	accent: AccentPaint,
	ring: string,
	palette: ScenePalette,
	box: GridBox,
): number {
	const d = palette.avatarSize;
	if (d <= 0) return x;
	const step = d * (1 - CARD.faceOverlap);
	const shown = faces.slice(0, AVATAR_MAX);
	let cx = x + d / 2;
	for (const face of shown) {
		paintCircle(ctx, cx, cy, d, face.photoUrl, face.initials, accent, ring, palette, box);
		cx += step;
	}
	if (faces.length > shown.length) {
		paintBadgeChip(
			ctx,
			`+${faces.length - shown.length}`,
			cx - step + d / 2 + CARD.gap,
			cy,
			ring,
			palette,
			box,
		);
		cx += d + CARD.gap;
	}
	return cx - step + d / 2;
}

/** The provider stack — the same overlapping-circle convention, drawing a COUNT (canvas has no brand
 *  artwork of its own; see `SceneEvent.sources`'s own doc for why). */
function paintProviderStack(
	ctx: CanvasRenderingContext2D,
	count: number,
	x: number,
	cy: number,
	accent: AccentPaint,
	ring: string,
	palette: ScenePalette,
	box: GridBox,
): void {
	const d = palette.avatarSize;
	if (d <= 0 || count <= 0) return;
	const step = d * (1 - CARD.faceOverlap);
	const shown = Math.min(count, AVATAR_MAX);
	let cx = x + d / 2;
	for (let i = 0; i < shown; i++) {
		paintCircle(ctx, cx, cy, d, undefined, "", accent, ring, palette, box);
		cx += step;
	}
	if (count > shown) {
		paintBadgeChip(ctx, `+${count - shown}`, cx - step + d / 2 + CARD.gap, cy, ring, palette, box);
	}
}

/** One circle: a decoded photo if {@link resolveAvatar} already has one, else a ring + initials. */
function paintCircle(
	ctx: CanvasRenderingContext2D,
	cx: number,
	cy: number,
	d: number,
	photoUrl: string | undefined,
	initials: string,
	accent: AccentPaint,
	ring: string,
	palette: ScenePalette,
	box: GridBox,
): void {
	const img = resolveAvatar(photoUrl);
	const px = mapX(cx, 0, box);
	ctx.save();
	ctx.beginPath();
	ctx.arc(px, cy, d / 2, 0, Math.PI * 2);
	if (img) {
		ctx.save();
		ctx.clip();
		ctx.drawImage(img, px - d / 2, cy - d / 2, d, d);
		ctx.restore();
	} else {
		ctx.fillStyle = ring
			? `rgba(${hexToRgbTriplet(ring)}, 0.22)`
			: (accent.fillHover || accent.fill || "rgba(0,0,0,0.16)");
		ctx.fill();
		if (initials && palette.badgeText.font) {
			useText(
				ctx,
				scaledText(palette.badgeText, Math.max(8, d * 0.42), ring || palette.badgeText.color),
			);
			ctx.textAlign = "center";
			ctx.fillText(initials, px, cy + 0.5);
			ctx.textAlign = "left";
		}
	}
	ctx.lineWidth = Math.max(1 / box.dpr, 1);
	ctx.strokeStyle = ring ? `rgba(${hexToRgbTriplet(ring)}, 0.55)` : "rgba(0,0,0,0.3)";
	ctx.stroke();
	ctx.restore();
}

/**
 * Best-effort `"r, g, b"` for a resolved colour string, so a circle's translucent fill/ring can be
 * mixed at an alpha the source colour did not necessarily carry. Falls back to a neutral mid-grey
 * triplet for a notation this quick parse does not recognise (a named colour, `color(srgb …)` with
 * unusual spacing) — never throws, because a decorative ring is not worth a broken frame over.
 */
function hexToRgbTriplet(colour: string): string {
	const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(colour);
	if (m) return `${m[1]}, ${m[2]}, ${m[3]}`;
	const hex = /^#([0-9a-f]{6})$/i.exec(colour.trim());
	if (hex) {
		const n = parseInt(hex[1], 16);
		return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
	}
	return "128, 128, 128";
}

/** A small round `+N` pip, used both inline (stack/avatar overflow) and standalone (the card badge). */
function paintBadgeChip(
	ctx: CanvasRenderingContext2D,
	text: string,
	cx: number,
	cy: number,
	ink: string,
	palette: ScenePalette,
	box: GridBox,
): void {
	if (!palette.badgeText.font) return;
	const d = palette.avatarSize;
	const px = mapX(cx, 0, box);
	ctx.save();
	ctx.beginPath();
	ctx.arc(px, cy, d / 2, 0, Math.PI * 2);
	ctx.fillStyle = ink ? `rgba(${hexToRgbTriplet(ink)}, 0.3)` : "rgba(0,0,0,0.3)";
	ctx.fill();
	useText(ctx, scaledText(palette.badgeText, Math.max(8, d * 0.4), ink || palette.badgeText.color));
	ctx.textAlign = "center";
	ctx.fillText(text, px, cy + 0.5);
	ctx.textAlign = "left";
	ctx.restore();
}

/**
 * The stack-size badge, drawn INTO the box `badgeRect` resolved.
 *
 * It used to size itself from `ctx.measureText`, which made the drawn chip and the chip the hit test
 * unfolds a cluster by two different rectangles — a target the reader can see is not the target they
 * are pressing. Taking the rect as an argument is what collapses them to one: the box comes from the
 * palette (so it exists without a frame having run, and does not change size as a cluster grows from
 * `+9` to `+10`), and the count is fitted into it.
 */
function paintBadge(
	ctx: CanvasRenderingContext2D,
	text: string,
	rect: Rect,
	ink: string,
	cardFill: string,
	palette: ScenePalette,
	box: GridBox,
): void {
	if (!palette.badgeText.font || rect.w <= 0 || rect.h <= 0) return;
	roundRect(ctx, mapX(rect.x, rect.w, box), rect.y, rect.w, rect.h, rect.h / 2);
	// The chip is the card's OWN fill, one notch toward its ink — a coin punched from the same metal,
	// not a foreign sticker — so it reads as "more of this card" rather than a system notification.
	ctx.fillStyle = ink ? `rgba(${hexToRgbTriplet(ink)}, 0.22)` : cardFill;
	ctx.fill();
	useText(ctx, { ...palette.badgeText, color: ink || palette.badgeText.color });
	drawText(ctx, text, rect.x, rect.y + rect.h / 2, rect.w, box, "center");
}

/**
 * The Adaptive Bubble treatment (§Part 3): a card too short to be a card collapses to a small pill
 * hugging the column's trailing edge — the accent and the kind mark — rather than a sliver of
 * unreadable text.
 *
 * It resolves its own accent rather than taking one, because both of its callers now reach it through
 * the same dispatcher ({@link paintEntry}) and a parameter only one path could fill is a parameter
 * the other path can get wrong. A bubble is NEVER how an instant is drawn: the bubble threshold is a
 * duration heuristic, and a point in time has no duration to be short — see {@link paintPin}.
 */
function paintBubble(
	ctx: CanvasRenderingContext2D,
	ev: SceneEvent,
	rect: Rect,
	palette: ScenePalette,
	box: GridBox,
): void {
	const a = palette.accents[ev.accent] ?? palette.accentFallback;
	const fill = ev.masked ? a.fillMasked : a.fill;
	if (!fill) return;
	const cy = Math.max(
		rect.y + BUBBLE.size / 2,
		Math.min(rect.y + rect.h / 2, rect.y + rect.h - BUBBLE.size / 2),
	);
	const cx = rect.x + rect.w - BUBBLE.inset - BUBBLE.size / 2;
	const px = mapX(cx, 0, box);
	ctx.save();
	// `*=`, never `=`: a card can be cancelled AND receded behind an interaction, and `globalAlpha` is
	// absolute rather than cumulative, so a second assignment would silently discard the first.
	if (ev.cancelled && palette.cancelledAlpha > 0) ctx.globalAlpha *= palette.cancelledAlpha;
	ctx.beginPath();
	ctx.arc(px, cy, BUBBLE.size / 2, 0, Math.PI * 2);
	ctx.fillStyle = fill;
	ctx.fill();
	const ink = ev.masked ? "" : a.onAccent;
	const glyphSize = Math.min(palette.glyphSize, BUBBLE.size * 0.6);
	drawGlyph(
		ctx,
		ev.glyph,
		cx - glyphSize / 2,
		cy - glyphSize / 2,
		glyphSize,
		palette.glyphStroke,
		ink || a.accent,
		box,
	);
	ctx.restore();
}

/**
 * A run of proximity-close bubble cards in one column (§Part 3, "cluster into a singular compact
 * bubble"). Drawn as one slightly larger pill carrying a COUNT rather than N individually
 * indistinguishable dots — the useful fact at this density is "several things happened here", and
 * `eventAccessibleName` already puts every one of them, individually, in the accessible layer.
 */
function paintBubbleCluster(
	ctx: CanvasRenderingContext2D,
	run: readonly { ev: SceneEvent; rect: Rect }[],
	palette: ScenePalette,
	box: GridBox,
): void {
	if (run.length === 0) return;
	const top = Math.min(...run.map((r) => r.rect.y));
	const bottom = Math.max(...run.map((r) => r.rect.y + r.rect.h));
	const colRect = run[0].rect;
	const size = Math.min(BUBBLE.size + 4, Math.max(BUBBLE.size, bottom - top));
	const cy = (top + bottom) / 2;
	const cx = colRect.x + colRect.w - BUBBLE.inset - size / 2;
	const px = mapX(cx, 0, box);
	const accent = palette.accents[run[0].ev.accent] ?? palette.accentFallback;
	ctx.save();
	ctx.beginPath();
	ctx.arc(px, cy, size / 2, 0, Math.PI * 2);
	ctx.fillStyle = accent.fill || "rgba(0,0,0,0.2)";
	ctx.fill();
	ctx.strokeStyle = accent.onAccent
		? `rgba(${hexToRgbTriplet(accent.onAccent)}, 0.4)`
		: "rgba(0,0,0,0.3)";
	ctx.lineWidth = Math.max(1 / box.dpr, 1);
	ctx.stroke();
	if (palette.badgeText.font) {
		const text = String(run.length);
		useText(ctx, { ...palette.badgeText, color: accent.onAccent || palette.badgeText.color });
		ctx.textAlign = "center";
		ctx.fillText(text, px, cy + 0.5);
		ctx.textAlign = "left";
	}
	ctx.restore();
}

/** The live current-time rule. */
function paintNow(
	ctx: CanvasRenderingContext2D,
	scene: GridScene,
	palette: ScenePalette,
	box: GridBox,
	geo: { gutter: number; colW: number },
): void {
	const now = scene.now;
	if (!now || !palette.now) return;
	const y = now.y - scene.scrollTop;
	if (y < 0 || y > box.height) return;
	const x = now.column == null ? geo.gutter : geo.gutter + now.column * geo.colW;
	const w = now.column == null ? box.width - geo.gutter : geo.colW;
	const thickness = Math.max(1 / box.dpr, palette.nowWidth);
	const ty = Math.round(y);
	ctx.fillStyle = palette.now;
	ctx.fillRect(mapX(x, w, box), ty, w, thickness);

	/*
	 * THE LEAD-IN, and why the dot does not simply sit at the rule's own start.
	 *
	 * A horizontal position on this grid is read against ONE vertical scale — the hour gutter — so the
	 * mark that says "you are here" belongs on that axis, not out at whichever column happens to be
	 * today. In a Day view the two are the same place and this draws nothing. In a Week view today may
	 * be four columns away, and the run between is what keeps the dot and the rule one continuous mark
	 * instead of two unrelated ones. It is drawn at `nowLeadAlpha` so it cannot be mistaken for a
	 * fifth hour rule crossing four other days: strong enough to follow, faint enough to ignore.
	 */
	if (x > geo.gutter && palette.nowLeadAlpha > 0) {
		ctx.save();
		ctx.globalAlpha = palette.nowLeadAlpha;
		const lead = x - geo.gutter;
		ctx.fillRect(mapX(geo.gutter, lead, box), ty, lead, thickness);
		ctx.restore();
	}

	// The dot is what makes the rule findable at a glance on a grid full of hairlines. Its DIAMETER is
	// the same declaration `.cal-daycol__now-dot` carries, rather than a multiple of the rule's own
	// thickness — a ratio would drift from the DOM twin the moment either token moved. It is CENTRED
	// on the gutter axis, half overhanging into the hour scale, so it straddles exactly the junction
	// it exists to bridge — the same offset `.cal-daycol__now-dot` computes from its own diameter.
	if (palette.nowDotSize > 0) {
		ctx.beginPath();
		ctx.arc(mapX(geo.gutter, 0, box), ty + thickness / 2, palette.nowDotSize / 2, 0, Math.PI * 2);
		ctx.fill();
	}
}

/** The drag-to-create / drag-to-move preview. */
function paintSelection(
	ctx: CanvasRenderingContext2D,
	scene: GridScene,
	palette: ScenePalette,
	box: GridBox,
	geo: { gutter: number; colW: number },
): void {
	const sel = scene.selection;
	if (!sel) return;
	const y = sel.y - scene.scrollTop;
	const h = Math.max(sel.h, DRAFT_MIN_H);
	if (y + h < 0 || y > box.height) return;
	// Both insets come from the swatch as real lengths. They were a percentage of the column, which
	// resolves to sub-pixel on a narrow column and to six pixels on a wide one — an inset that changes
	// with the zoom is not the same design at two zooms.
	const start = palette.selectionInsetStart;
	const w = Math.max(0, geo.colW - start - palette.selectionInsetEnd);
	const logicalX = geo.gutter + sel.column * geo.colW + start;
	const x = mapX(logicalX, w, box);
	ctx.save();
	// A DRAFT is drawn at the palette's own subtlety; a preview mid-drag is not, because it is the
	// live shape of the gesture the reader's hand is making and has to keep up with them.
	if (sel.draft && palette.selectionAlpha > 0 && palette.selectionAlpha < 1) {
		ctx.globalAlpha = palette.selectionAlpha;
	}
	roundRect(ctx, x, y, w, h, palette.eventRadius);
	ctx.fillStyle = palette.selectionFill;
	ctx.fill();
	ctx.strokeStyle = palette.selectionStroke;
	ctx.lineWidth = Math.max(1 / box.dpr, palette.selectionStrokeWidth);
	/*
	 * DASHED, but only for a draft.
	 *
	 * A dash is the one shape channel that reads as "this is not settled yet" without spending a
	 * colour — and the palette has already given its four colours four meanings, so there is none
	 * left to spend. A gesture still in flight stays SOLID: it is the direct shape of what the reader
	 * is doing right now, and a dashed rectangle under their own moving finger would be describing
	 * that action as provisional rather than describing the thing it produces.
	 */
	if (sel.draft && palette.selectionDash > 0) {
		ctx.setLineDash([palette.selectionDash, Math.max(1, palette.selectionGap)]);
	}
	ctx.stroke();
	ctx.setLineDash([]);
	if (sel.text && h >= palette.metaText.size * 1.6) {
		useText(ctx, palette.metaText);
		drawText(ctx, sel.text, logicalX + CARD.gap, y + h / 2, w - CARD.gap * 2, box);
	}
	ctx.restore();
}

/** The period markers that label each block seam. */
function paintMarkers(
	ctx: CanvasRenderingContext2D,
	scene: GridScene,
	palette: ScenePalette,
	box: GridBox,
	geo: { gutter: number },
): void {
	const markers = scene.markers;
	if (!markers || markers.length === 0) return;
	useText(ctx, palette.markerText);
	const h = palette.markerText.size + CARD.gap;
	for (const m of markers) {
		const y = m.y - scene.scrollTop;
		if (y + h < 0 || y > box.height) continue;
		const text = fitText(ctx, m.text, box.width - geo.gutter - CARD.gap * 4);
		if (!text) continue;
		const w = ctx.measureText(text).width;
		const x = geo.gutter + CARD.gap * 2;
		// A wash behind it, because the marker sits ON a day-boundary rule and would otherwise be read
		// through it. The same `color-mix` the DOM marker carried, resolved through the probe.
		ctx.fillStyle = palette.markerFill;
		ctx.fillRect(mapX(x - CARD.gap / 2, w + CARD.gap, box), y + 1, w + CARD.gap, h);
		ctx.fillStyle = m.today ? palette.pillAccent : palette.markerText.color;
		drawText(ctx, text, x, y + 1 + h / 2, w, box);
	}
}

/**
 * The focus ring for whatever the accessible layer currently has focus on.
 *
 * This is the whole reason a canvas viewport can still be operated from a keyboard: the focus lives
 * on a real element in the sibling layer, and this is where a SIGHTED keyboard reader is shown it.
 */
function paintFocus(
	ctx: CanvasRenderingContext2D,
	scene: GridScene,
	palette: ScenePalette,
	box: GridBox,
	geo: { gutter: number; colW: number },
): void {
	if (!scene.focusId || !palette.focusRing) return;
	const ev = scene.events?.find((e) => e.id === scene.focusId);
	if (!ev) return;
	const rect = eventRect(ev, geo, scene.scrollTop);
	if (rect.y + rect.h < 0 || rect.y > box.height) return;
	strokeFocusRing(
		ctx,
		palette,
		box,
		mapX(rect.x, rect.w, box),
		rect.y,
		rect.w,
		rect.h,
		palette.eventRadius,
	);
}

/**
 * The overlay depth gauge — the DOM twin of `useOverlayScrollbar`'s bar, §Part 4.
 *
 * THE LEVER. At rest the handle is a pill at its depth offset. Grabbed, it MORPHS into the ball
 * `.cal-bar__handle::before` draws for the same control in the DOM, and deflects from where it was
 * taken hold of rather than tracking depth.
 *
 * `lever.displacement` is the RAW signed travel of the pointer, which is deliberately NOT the drawn
 * offset: the throttle keeps ramping with it while the stick's throw saturates, exactly as a physical
 * joystick's does, so `core/chrome.ts`'s `leverThrowPx` is what converts one into the other. Drawing
 * the raw travel would send the ball off across the viewport, detached from the handle it grew out
 * of, and a stick that leaves its own socket stops reading as a stick at all. The clamp below is a
 * second, independent guard: the saturated throw already keeps the ball on the bar, and this keeps it
 * on the SCREEN whatever a future throw ceiling is set to.
 *
 * `morph` arrives RESOLVED, like every other animated quantity this pass takes. The shape is
 * interpolated from it here — geometry, written directly — while the two FILLS crossfade by alpha,
 * because two resolved colour strings cannot be mixed without parsing them and this package does not
 * parse a colour to draw one. At `morph` 1 the interpolated shape IS the ball's circle and the
 * crossfade is complete, so the handle has become the ball rather than acquired one.
 */
function paintScrollbar(
	ctx: CanvasRenderingContext2D,
	scene: GridScene,
	palette: ScenePalette,
	box: GridBox,
): void {
	const bar = scene.scrollbar;
	const rect = scrollbarRect(scene, box, palette);
	if (!bar || !rect || bar.opacity <= 0) return;
	// The fade arrives as a resolved number, never as a CSS transition: a frozen animation clock must
	// not be able to strand the one control that says how deep the reader is.
	const alpha = Math.min(1, Math.max(0, bar.opacity));
	const lever = bar.lever;
	const ballD = palette.barBallSize;
	const morph = lever && ballD > 0 ? Math.min(1, Math.max(0, lever.morph)) : 0;

	const w = rect.w + (ballD - rect.w) * morph;
	const h = rect.h + (ballD - rect.h) * morph;
	const half = h / 2;
	const lo = palette.barInset + half;
	const hi = box.height - palette.barInset - half;
	const cx = rect.x + rect.w / 2;
	const throwPx = lever ? leverThrowPx(lever.displacement) : 0;
	const cy = Math.min(Math.max(rect.y + rect.h / 2 + throwPx, lo), Math.max(lo, hi));

	ctx.save();
	ctx.globalAlpha = alpha;
	roundRect(ctx, mapX(cx - w / 2, w, box), cy - half, w, h, palette.barRadius);
	ctx.fillStyle = bar.active ? palette.barFillStrong : palette.barFill;
	ctx.fill();
	if (palette.barEdge && palette.barEdgeWidth > 0) {
		ctx.strokeStyle = palette.barEdge;
		ctx.lineWidth = Math.max(1 / box.dpr, palette.barEdgeWidth);
		ctx.stroke();
	}
	if (morph > 0 && palette.barBallFill) {
		ctx.globalAlpha = alpha * morph;
		ctx.fillStyle = palette.barBallFill;
		ctx.beginPath();
		ctx.arc(mapX(cx, 0, box), cy, ballD / 2, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.restore();
}

/** The return-to-present pill. */
function paintPresent(
	ctx: CanvasRenderingContext2D,
	scene: GridScene,
	palette: ScenePalette,
	box: GridBox,
): void {
	const present = scene.present;
	const rect = presentRect(scene, box, palette);
	if (!present || !rect) return;
	const px = mapX(rect.x, rect.w, box);
	roundRect(ctx, px, rect.y, rect.w, rect.h, rect.h / 2);
	ctx.fillStyle = palette.pillFill;
	ctx.fill();
	// Hover is the pill's only pre-press affordance — a canvas control has no `:hover` of its own, so
	// the ring thickens instead, to the width the swatch's own `outline` declares.
	ctx.strokeStyle = present.hover ? palette.pillAccent : palette.pillStroke;
	ctx.lineWidth = Math.max(
		1 / box.dpr,
		present.hover ? palette.pillStrokeWidthHover : palette.pillStrokeWidth,
	);
	ctx.stroke();
	useText(ctx, palette.pillText);
	ctx.fillStyle = palette.pillAccent;
	drawText(ctx, present.text, rect.x, rect.y + rect.h / 2, rect.w, box, "center");
	// The DOM control this replaced carried its own `:focus-visible`; its parallel control lives in
	// the visually-hidden layer, where a ring would be clipped away. This is where it survives.
	if (present.focused) {
		strokeFocusRing(ctx, palette, box, px, rect.y, rect.w, rect.h, rect.h / 2);
	}
}

// #endregion

// #region Frame cost
/**
 * What one painted frame cost, and how much of the corpus it touched.
 *
 * The reason this exists is a decision rather than curiosity. This repo's renderer policy is TIERED
 * (root CLAUDE.md §8 Decision #1: D3/SVG → Canvas2D → PIXI/WebGL, "auto-selected on a performance
 * metric"), so the question "is Canvas2D still the right tier for this surface" has to be answerable
 * with a measurement instead of an intuition. `eventsDrawn` against `eventsTotal` is the other half
 * of it: a frame that touches a few dozen cards out of thousands says the culling is working, and a
 * frame that touches all of them says the tier is not the problem.
 */
export interface FrameStats {
	/** Wall time inside `paintScene`, ms. */
	drawMs: number;
	/** Filled/stroked shapes this frame: rules, bands, blackouts, cards, chrome. */
	shapes: number;
	/** Text runs this frame — the expensive part of a Canvas2D frame, and the first thing to cut. */
	textRuns: number;
	/**
	 * Cards PRESENTED to the paint pass for this frame — the laid-out window, not the rasterised set.
	 *
	 * Named for what it is. `paintEvents` culls each card against the canvas box as it goes, so the
	 * number actually rasterised is this or fewer, and counting that would mean incrementing a counter
	 * inside the draw — which would have to run in production too, and the whole point of this being
	 * opt-in is that it costs nothing when nobody is asking. `drawMs` already accounts for the cull,
	 * so the cost figure is honest either way; this is the scene's size, not the rasteriser's.
	 */
	eventsInScene: number;
	/** Cards the host laid out for the window, before culling. `null` when the host did not say. */
	eventsTotal: number | null;
	/** Day columns across the canvas. */
	columns: number;
	/** Canvas CSS size and backing-store scale, so a number can be read against the box it was drawn in. */
	width: number;
	height: number;
	dpr: number;
}

/**
 * Count what a scene will cost to draw, without drawing it.
 *
 * Pure and separate from the paint so it is unit-testable and so measuring never changes what is
 * measured — a counter incremented inside the draw would have to run in production too, and the
 * point of this is to cost nothing when nobody is asking.
 */
export function sceneCost(scene: GridScene): { shapes: number; textRuns: number } {
	const events = scene.events?.length ?? 0;
	const hours = scene.hours?.length ?? 0;
	const markers = scene.markers?.length ?? 0;
	// A card is its rounded body plus its accent edge; a marker is a rule plus its label chip.
	const chrome = (scene.now ? 1 : 0) + (scene.selection ? 1 : 0) + (scene.scrollbar ? 2 : 0) +
		(scene.present ? 2 : 0) + (scene.focusRegion ? 1 : 0);
	const shapes = scene.rules.length + scene.bands.length + scene.blackouts.length +
		(scene.columns > 1 ? scene.columns - 1 : 0) + events * 2 + markers * 2 + chrome;

	// Each card draws a title and, when it has room, a time line. Counted at the upper bound: this is
	// a budget, and a budget that flatters itself is worthless.
	const textRuns = events * 2 + hours + markers + (scene.selection ? 1 : 0);

	return { shapes, textRuns };
}
// #endregion
