/// <reference lib="dom" />
/**
 * @projective/ui/gantt — the ONE ordered pass that paints a whole timeline viewport.
 *
 * ORDER IS MEANING. Ground first (row washes, weekends), then the lattice (minor rules, major rules,
 * row seams), then the things that live in it (dependency links under their bars, the bars, the
 * milestones), then the things that must never be hidden BY a bar: the draft, the today rule, the
 * fly-mode origin, the focus rings.
 *
 * NO FRAME IS EVER REQUIRED. Every routine is a pure function of its arguments: given a scene it
 * draws the complete, final frame, with nothing interpolated and nothing scheduled. `requestAnimation
 * Frame`, CSS transitions and CSS `@keyframes` are all frozen in a hidden or background tab, so a
 * viewport whose pixels needed a frame would be blank there. Where something moves (the hovered
 * lane's expansion) the NUMBER arrives in the scene already resolved.
 *
 * THE MIRROR. Under `dir="rtl"` every logical x is mapped to a physical one exactly once, in
 * {@link mapX}; the paint code stays written in logical coordinates where x grows from the inline
 * start. A mirrored context would draw mirrored glyphs, so the transform itself is never negated.
 *
 * WHAT A BAR LABEL IS DRAWN ON. The bar's resting fill is the accent WASHED toward the surface, and
 * its label is `--on-surface` — near-black on a pale tint, near-white on a deep one — so a label is
 * legible by construction against any accent the generated palette produces, in both themes. The
 * solid accent is spent on the channels that carry no text: the leading edge, the progress strip
 * along the base, the milestone diamond. A label that does not fit inside its bar trails it, whole,
 * rather than being clipped to three characters; a label that does not fit anywhere is the reason
 * the lane expands on hover.
 */
import { fitText } from "../../calendar/core/scene-paint.ts";
import type { TextStyle } from "../../calendar/core/grid-paint.ts";
import type { GanttPalette } from "./theme-bridge.ts";
import type { ItemBox } from "./layout.ts";
import { dependencyPath } from "./layout.ts";

// #region Scene
/** The canvas box: CSS size, device pixel ratio, mirror. */
export interface GanttBox {
	width: number;
	height: number;
	dpr: number;
	rtl: boolean;
}

/** One vertical rule, content-space x. */
export interface SceneRule {
	x: number;
	major: boolean;
}

/** One visible lane's row, content-space y. */
export interface SceneRow {
	index: number;
	y: number;
	h: number;
	hover: boolean;
	selected: boolean;
}

/** A drawn item: its box plus what is written on it. */
export interface SceneItem extends ItemBox {
	label: string;
	meta: string;
	/** The accent token NAME — the key into the palette's accent map. */
	accent: string;
	/** `0..1`, or null for an item with no progress channel. */
	progress: number | null;
	/** Whether this item's lane is the expanded one — the meta line is drawn under the label. */
	expanded: boolean;
}

/** A provisional span — the draft, or a move in flight — on one lane. */
export interface ScenePreview {
	laneIndex: number;
	x0: number;
	x1: number;
	y: number;
	h: number;
	label: string;
	/** Dashed (a resting draft) or solid (a live gesture). */
	dashed: boolean;
}

/** Everything the painter needs for one frame. Positions are CONTENT space unless stated. */
export interface GanttScene {
	scrollX: number;
	scrollY: number;
	rules: SceneRule[];
	/** Weekend washes, content-space x pairs. */
	weekends: { x0: number; x1: number }[];
	rows: SceneRow[];
	items: SceneItem[];
	/** Dependency links, resolved to boxes (both ends laid out this frame). */
	links: { from: ItemBox; to: ItemBox }[];
	/** The today rule's content-space x, or null when the clock is off the axis. */
	todayX: number | null;
	preview: ScenePreview | null;
	hoverId: string | null;
	focusId: string | null;
	/** The fly-mode origin in VIEWPORT px, or null. */
	fly: { x: number; y: number } | null;
	/** Whether the accessible scroll region itself holds focus — drawn as a ring around the box. */
	regionFocus: boolean;
}

/** What the pass reports back, so a caller can decide what a hover should reveal. */
export interface PaintReport {
	/** Items whose label did not fit inside their bar. */
	truncated: Set<string>;
	shapes: number;
	textRuns: number;
}
// #endregion

// #region Primitives
/** Map a LOGICAL x (from the inline start) onto the physical axis. */
function mapX(x: number, w: number, box: GanttBox): number {
	return box.rtl ? box.width - x - w : x;
}

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

function useText(ctx: CanvasRenderingContext2D, style: TextStyle): void {
	ctx.font = style.font;
	ctx.fillStyle = style.color;
	ctx.textBaseline = "middle";
	ctx.textAlign = "left";
	if ("letterSpacing" in ctx) ctx.letterSpacing = style.letterSpacing || "normal";
	if ("wordSpacing" in ctx) ctx.wordSpacing = style.wordSpacing || "normal";
}

/** Snap a coordinate to a whole CSS pixel so a hairline lands ON the device grid. */
function crisp(v: number): number {
	return Math.round(v) + 0.5;
}

/** Draw one line of text at a logical x, truncated with a real ellipsis. Returns the drawn width. */
function drawText(
	ctx: CanvasRenderingContext2D,
	text: string,
	x: number,
	y: number,
	maxW: number,
	box: GanttBox,
): number {
	const shown = fitText(ctx, text, maxW);
	if (!shown) return 0;
	const w = ctx.measureText(shown).width;
	ctx.fillText(shown, mapX(x, w, box), y);
	return w;
}
// #endregion

// #region The pass
/**
 * Paint one complete frame.
 *
 * The context is reset and cleared first: a transform outlives the frame that set it and the backing
 * store is only re-created when the SIZE changes, so a draw that inherited the previous scale would
 * compound it.
 */
export function paintGantt(
	ctx: CanvasRenderingContext2D,
	scene: GanttScene,
	palette: GanttPalette,
	box: GanttBox,
): PaintReport {
	const report: PaintReport = { truncated: new Set(), shapes: 0, textRuns: 0 };
	const { width, height, dpr } = box;
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
	if (width <= 0 || height <= 0) return report;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

	paintRows(ctx, scene, palette, box, report);
	paintWeekends(ctx, scene, palette, box, report);
	paintRules(ctx, scene, palette, box, report);
	paintLinks(ctx, scene, palette, box, report);
	paintItems(ctx, scene, palette, box, report);
	paintPreview(ctx, scene, palette, box, report);
	paintToday(ctx, scene, palette, box, report);
	paintFly(ctx, scene, palette, box, report);
	paintFocus(ctx, scene, palette, box, report);
	return report;
}

function paintRows(
	ctx: CanvasRenderingContext2D,
	scene: GanttScene,
	palette: GanttPalette,
	box: GanttBox,
	report: PaintReport,
): void {
	for (const row of scene.rows) {
		const y = row.y - scene.scrollY;
		if (y + row.h < 0 || y > box.height) continue;
		const wash = row.selected
			? palette.rowSelected
			: row.hover
			? palette.rowHover
			: row.index % 2 === 1
			? palette.rowAlt
			: "";
		if (wash) {
			ctx.fillStyle = wash;
			ctx.fillRect(0, y, box.width, row.h);
			report.shapes++;
		}
		if (palette.rowRule && palette.rowRuleWidth > 0) {
			ctx.strokeStyle = palette.rowRule;
			ctx.lineWidth = Math.max(1 / box.dpr, palette.rowRuleWidth);
			ctx.beginPath();
			ctx.moveTo(0, crisp(y + row.h));
			ctx.lineTo(box.width, crisp(y + row.h));
			ctx.stroke();
			report.shapes++;
		}
	}
}

function paintWeekends(
	ctx: CanvasRenderingContext2D,
	scene: GanttScene,
	palette: GanttPalette,
	box: GanttBox,
	report: PaintReport,
): void {
	if (!palette.weekend) return;
	ctx.fillStyle = palette.weekend;
	for (const span of scene.weekends) {
		const x0 = span.x0 - scene.scrollX;
		const x1 = span.x1 - scene.scrollX;
		if (x1 < 0 || x0 > box.width) continue;
		const w = Math.max(0, x1 - x0);
		ctx.fillRect(mapX(x0, w, box), 0, w, box.height);
		report.shapes++;
	}
}

function paintRules(
	ctx: CanvasRenderingContext2D,
	scene: GanttScene,
	palette: GanttPalette,
	box: GanttBox,
	report: PaintReport,
): void {
	for (const rule of scene.rules) {
		const colour = rule.major ? palette.ruleMajor : palette.rule;
		const width = rule.major ? palette.ruleMajorWidth : palette.ruleWidth;
		if (!colour || width <= 0) continue;
		const x = rule.x - scene.scrollX;
		if (x < -1 || x > box.width + 1) continue;
		ctx.strokeStyle = colour;
		ctx.lineWidth = Math.max(1 / box.dpr, width);
		const px = crisp(mapX(x, 0, box));
		ctx.beginPath();
		ctx.moveTo(px, 0);
		ctx.lineTo(px, box.height);
		ctx.stroke();
		report.shapes++;
	}
}

function paintLinks(
	ctx: CanvasRenderingContext2D,
	scene: GanttScene,
	palette: GanttPalette,
	box: GanttBox,
	report: PaintReport,
): void {
	if (!palette.link || palette.linkWidth <= 0) return;
	ctx.strokeStyle = palette.link;
	ctx.fillStyle = palette.link;
	ctx.lineWidth = Math.max(1 / box.dpr, palette.linkWidth);
	ctx.lineJoin = "round";
	for (const link of scene.links) {
		const pts = dependencyPath(link.from, link.to);
		ctx.beginPath();
		pts.forEach((p, i) => {
			const x = mapX(p.x - scene.scrollX, 0, box);
			const y = p.y - scene.scrollY;
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		});
		ctx.stroke();
		// The arrowhead points INTO the successor along the inline axis.
		const tip = pts[pts.length - 1];
		const tx = mapX(tip.x - scene.scrollX, 0, box);
		const ty = tip.y - scene.scrollY;
		const a = Math.max(3, palette.arrowSize);
		const dir = box.rtl ? -1 : 1;
		ctx.beginPath();
		ctx.moveTo(tx, ty);
		ctx.lineTo(tx - dir * a, ty - a / 2);
		ctx.lineTo(tx - dir * a, ty + a / 2);
		ctx.closePath();
		ctx.fill();
		report.shapes += 2;
	}
}

function paintItems(
	ctx: CanvasRenderingContext2D,
	scene: GanttScene,
	palette: GanttPalette,
	box: GanttBox,
	report: PaintReport,
): void {
	const labelH = palette.labelText.lineHeight > 0
		? palette.labelText.lineHeight
		: palette.labelText.size + 2;
	const metaH = palette.metaText.lineHeight > 0
		? palette.metaText.lineHeight
		: palette.metaText.size + 2;
	for (const item of scene.items) {
		const x = item.x - scene.scrollX;
		const y = item.y - scene.scrollY;
		if (y + item.h + palette.rowExpand < 0 || y > box.height) continue;
		const paint = palette.accents[item.accent] ?? palette.accentFallback;
		const hovered = scene.hoverId === item.id;
		const pad = palette.barPad;

		if (item.milestone) {
			const half = item.w / 2;
			const cx = mapX(x, item.w, box) + half;
			const cy = y + half;
			if (paint.accent) {
				ctx.fillStyle = paint.accent;
				ctx.beginPath();
				ctx.moveTo(cx, cy - half);
				ctx.lineTo(cx + half, cy);
				ctx.lineTo(cx, cy + half);
				ctx.lineTo(cx - half, cy);
				ctx.closePath();
				ctx.fill();
				report.shapes++;
			}
			// The label always trails a diamond — there is nothing to fit it inside.
			if (palette.labelText.font) {
				useText(ctx, palette.labelText);
				const maxW = Math.max(0, box.width - (x + item.w + pad));
				drawText(ctx, item.label, x + item.w + pad, cy, Math.min(maxW, 260), box);
				report.textRuns++;
				if (item.expanded && item.meta && palette.metaText.font) {
					useText(ctx, palette.metaText);
					drawText(ctx, item.meta, x + item.w + pad, cy + labelH, Math.min(maxW, 260), box);
					report.textRuns++;
				}
			}
			continue;
		}

		// A bar clipped to the viewport before it is drawn: a year-long bar at an hourly zoom is
		// tens of thousands of pixels wide, and the canvas need not trace what it cannot show.
		if (x + item.w < 0 || x > box.width) continue;
		const fill = hovered ? paint.fillHover : paint.fill;
		if (fill) {
			roundRect(ctx, mapX(x, item.w, box), y, item.w, item.h, palette.barRadius);
			ctx.fillStyle = fill;
			ctx.fill();
			report.shapes++;
		}
		if (paint.accent) {
			// The leading edge — a solid cap on the inline-start side, the one shape channel that says
			// where the span BEGINS at every zoom, including one where the bar is four pixels wide.
			ctx.save();
			roundRect(ctx, mapX(x, item.w, box), y, item.w, item.h, palette.barRadius);
			ctx.clip();
			ctx.fillStyle = paint.accent;
			const capW = Math.min(3, item.w);
			ctx.fillRect(mapX(x, capW, box), y, capW, item.h);
			// The progress strip along the base: the completed fraction, in the solid accent.
			if (item.progress !== null && palette.progressH > 0) {
				const p = Math.max(0, Math.min(1, item.progress));
				const pw = item.w * p;
				if (pw > 0) {
					ctx.fillRect(mapX(x, pw, box), y + item.h - palette.progressH, pw, palette.progressH);
					report.shapes++;
				}
			}
			ctx.restore();
			report.shapes++;
		}

		if (!palette.labelText.font) continue;
		useText(ctx, palette.labelText);
		const innerW = item.w - pad * 2 - 3;
		const labelW = ctx.measureText(item.label).width;
		const fitsInside = labelW <= innerW;
		if (!fitsInside) report.truncated.add(item.id);
		const cy = y + item.h / 2;
		if (fitsInside) {
			drawText(ctx, item.label, x + pad + 3, cy, innerW, box);
			report.textRuns++;
			if (item.expanded && item.meta && palette.metaText.font) {
				useText(ctx, palette.metaText);
				drawText(ctx, item.meta, x + pad + 3, y + item.h + metaH / 2 + 1, innerW, box);
				report.textRuns++;
			}
		} else {
			// Trailing, whole where possible: the bar's own box stays a colour block and the name sits
			// beside it in the row's free space.
			const tx = x + item.w + pad;
			const maxW = Math.min(260, Math.max(0, box.width - tx));
			if (maxW > 20) {
				drawText(ctx, item.label, tx, cy, maxW, box);
				report.textRuns++;
			}
			if (item.expanded && item.meta && palette.metaText.font) {
				useText(ctx, palette.metaText);
				drawText(ctx, item.meta, tx, cy + labelH, maxW, box);
				report.textRuns++;
			}
		}
	}
}

function paintPreview(
	ctx: CanvasRenderingContext2D,
	scene: GanttScene,
	palette: GanttPalette,
	box: GanttBox,
	report: PaintReport,
): void {
	const p = scene.preview;
	if (!p) return;
	const x0 = p.x0 - scene.scrollX;
	const x1 = p.x1 - scene.scrollX;
	const y = p.y - scene.scrollY;
	const w = Math.max(4, x1 - x0);
	if (x1 < 0 || x0 > box.width || y + p.h < 0 || y > box.height) return;
	ctx.save();
	ctx.globalAlpha = p.dashed ? palette.draftAlpha : 1;
	roundRect(ctx, mapX(x0, w, box), y, w, p.h, palette.barRadius);
	if (palette.draftFill) {
		ctx.fillStyle = palette.draftFill;
		ctx.fill();
		report.shapes++;
	}
	if (palette.draftStroke && palette.draftStrokeWidth > 0) {
		ctx.strokeStyle = palette.draftStroke;
		ctx.lineWidth = Math.max(1 / box.dpr, palette.draftStrokeWidth);
		if (p.dashed && palette.draftDash > 0) ctx.setLineDash([palette.draftDash, palette.draftGap]);
		ctx.stroke();
		ctx.setLineDash([]);
		report.shapes++;
	}
	if (p.label && palette.labelText.font) {
		useText(ctx, palette.labelText);
		drawText(
			ctx,
			p.label,
			x0 + palette.barPad,
			y + p.h / 2,
			Math.max(0, w - palette.barPad * 2),
			box,
		);
		report.textRuns++;
	}
	ctx.restore();
}

function paintToday(
	ctx: CanvasRenderingContext2D,
	scene: GanttScene,
	palette: GanttPalette,
	box: GanttBox,
	report: PaintReport,
): void {
	if (scene.todayX === null || !palette.today || palette.todayWidth <= 0) return;
	const x = scene.todayX - scene.scrollX;
	if (x < -palette.todayCap || x > box.width + palette.todayCap) return;
	const px = crisp(mapX(x, 0, box));
	ctx.strokeStyle = palette.today;
	ctx.lineWidth = Math.max(1 / box.dpr, palette.todayWidth);
	ctx.beginPath();
	ctx.moveTo(px, 0);
	ctx.lineTo(px, box.height);
	ctx.stroke();
	if (palette.todayCap > 0) {
		ctx.fillStyle = palette.today;
		ctx.beginPath();
		ctx.arc(px, palette.todayCap / 2, palette.todayCap / 2, 0, Math.PI * 2);
		ctx.fill();
		report.shapes++;
	}
	report.shapes++;
}

function paintFly(
	ctx: CanvasRenderingContext2D,
	scene: GanttScene,
	palette: GanttPalette,
	box: GanttBox,
	report: PaintReport,
): void {
	const fly = scene.fly;
	if (!fly || !palette.flyRing || palette.flyRingSize <= 0) return;
	const r = palette.flyRingSize / 2;
	ctx.strokeStyle = palette.flyRing;
	ctx.lineWidth = Math.max(1 / box.dpr, palette.flyRingWidth);
	ctx.beginPath();
	ctx.arc(fly.x, fly.y, r, 0, Math.PI * 2);
	ctx.stroke();
	// A crosshair inside the ring, so the origin reads as "push away from here" rather than a dot.
	ctx.beginPath();
	ctx.moveTo(fly.x - r * 0.6, fly.y);
	ctx.lineTo(fly.x + r * 0.6, fly.y);
	ctx.moveTo(fly.x, fly.y - r * 0.6);
	ctx.lineTo(fly.x, fly.y + r * 0.6);
	ctx.stroke();
	report.shapes += 2;
}

/** The two-tone ring — halo inside, ink outside — every canvas-painted focus indicator uses. */
function strokeFocusRing(
	ctx: CanvasRenderingContext2D,
	palette: GanttPalette,
	box: GanttBox,
	x: number,
	y: number,
	w: number,
	h: number,
	radius: number,
): void {
	if (!palette.focusRing || w <= 0 || h <= 0) return;
	const lw = Math.max(1 / box.dpr, palette.focusRingWidth);
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
	if (palette.focusRingHalo) ring(palette.focusRingHalo, lw);
	ring(palette.focusRing, 0);
}

function paintFocus(
	ctx: CanvasRenderingContext2D,
	scene: GanttScene,
	palette: GanttPalette,
	box: GanttBox,
	report: PaintReport,
): void {
	if (scene.focusId) {
		const item = scene.items.find((i) => i.id === scene.focusId);
		if (item) {
			const grow = item.milestone ? 4 : 0;
			const x = item.x - scene.scrollX - grow;
			const y = item.y - scene.scrollY - grow;
			strokeFocusRing(
				ctx,
				palette,
				box,
				mapX(x, item.w + grow * 2, box),
				y,
				item.w + grow * 2,
				item.h + grow * 2,
				item.milestone ? (item.w + grow * 2) / 2 : palette.barRadius,
			);
			report.shapes += 2;
		}
	}
	if (scene.regionFocus) {
		strokeFocusRing(ctx, palette, box, 0, 0, box.width, box.height, 0);
		report.shapes += 2;
	}
}
// #endregion
