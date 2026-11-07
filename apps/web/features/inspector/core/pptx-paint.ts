/// <reference lib="dom" />
import type {
	SceneBox,
	SceneCell,
	SceneGeometry,
	SceneItem,
	SceneLine,
	ScenePaint,
	SceneRun,
	SceneShape,
	SceneTable,
	SceneText,
	SlideScene,
} from "./pptx-model.ts";

/**
 * pptx-paint — a scene drawn onto a 2D canvas. Every unit in a scene is a point, so one transform
 * covers every scale: the inspector's slide and a card's thumbnail are the same drawing at two sizes.
 * Paper-white is the deck's own default, not a theme token: a slide looks the same in either theme.
 */

/** A decoded picture, ready to draw. */
export type SceneImage = CanvasImageSource & { width: number; height: number };

const PAPER = "#ffffff";
const NOTE_FILL = "#f1f3f4";
const NOTE_INK = "#5f6368";
const TABLE_RULE = "#bfbfbf";
const LINE_FACTOR = 1.2;
const FALLBACK_FONTS = `"Segoe UI", "Helvetica Neue", Arial, sans-serif`;

// #region Text
interface Piece {
	text: string;
	run: SceneRun;
	width: number;
}

interface Line {
	pieces: Piece[];
	width: number;
	size: number;
}

function fontString(run: Pick<SceneRun, "italic" | "bold" | "size" | "font">): string {
	const style = `${run.italic ? "italic " : ""}${run.bold ? "bold " : ""}`;
	const family = run.font ? `"${run.font.replaceAll('"', "")}", ` : "";
	return `${style}${run.size}px ${family}${FALLBACK_FONTS}`;
}

const SEGMENTER = typeof Intl.Segmenter === "function"
	? new Intl.Segmenter(undefined, { granularity: "word" })
	: null;

/** Break points: words and the gaps between them, and each CJK character by itself. */
function segments(text: string): string[] {
	if (!SEGMENTER) return text.split(/(\s+)/).filter(Boolean);
	return Array.from(SEGMENTER.segment(text), (part) => part.segment);
}

/** Wrap runs to a width. A line break in the text ends a line; a lone word wider than it overflows. */
function wrapRuns(
	ctx: CanvasRenderingContext2D,
	runs: readonly SceneRun[],
	width: number,
	wrap: boolean,
	emptySize: number,
): Line[] {
	const lines: Line[] = [];
	let line: Line = { pieces: [], width: 0, size: 0 };
	const finish = () => {
		if (line.size === 0) line.size = emptySize;
		lines.push(line);
		line = { pieces: [], width: 0, size: 0 };
	};
	for (const run of runs) {
		ctx.font = fontString(run);
		for (const chunk of run.text.split("\n").flatMap((part, i) => (i ? ["\n", part] : [part]))) {
			if (chunk === "\n") {
				finish();
				continue;
			}
			for (const text of segments(chunk)) {
				const measured = ctx.measureText(text).width;
				const blank = text.trim().length === 0;
				if (wrap && !blank && line.pieces.length > 0 && line.width + measured > width) finish();
				if (blank && line.pieces.length === 0 && lines.length > 0) continue;
				line.pieces.push({ text, run, width: measured });
				line.width += measured;
				line.size = Math.max(line.size, run.size);
			}
		}
	}
	finish();
	return lines;
}

interface LaidParagraph {
	lines: Line[];
	before: number;
	after: number;
	lineHeight: number;
	source: SceneText["paragraphs"][number];
}

/** Lay a body out for a width; the total height decides where its anchor puts it. */
function layoutText(
	ctx: CanvasRenderingContext2D,
	text: SceneText,
	width: number,
): { paragraphs: LaidParagraph[]; height: number } {
	let height = 0;
	const paragraphs = text.paragraphs.map((source, i): LaidParagraph => {
		const lines = wrapRuns(
			ctx,
			source.runs,
			Math.max(1, width - source.marginLeft),
			text.wrap,
			source.emptySize,
		);
		const before = i === 0 ? 0 : source.before;
		height += before + source.after;
		for (const line of lines) height += line.size * LINE_FACTOR * source.lineHeight;
		return { lines, before, after: source.after, lineHeight: source.lineHeight, source };
	});
	return { paragraphs, height };
}

/** Draw a text body inside a box whose top-left is the origin. Clips nothing: Office doesn't. */
export function paintText(
	ctx: CanvasRenderingContext2D,
	text: SceneText,
	width: number,
	height: number,
): void {
	const inner = Math.max(1, width - text.insets.left - text.insets.right);
	const laid = layoutText(ctx, text, inner);
	const room = height - text.insets.top - text.insets.bottom;
	const offset = text.anchor === "middle"
		? (room - laid.height) / 2
		: text.anchor === "bottom"
		? room - laid.height
		: 0;
	let y = text.insets.top + offset;
	ctx.textBaseline = "alphabetic";
	for (const paragraph of laid.paragraphs) {
		const { source } = paragraph;
		y += paragraph.before;
		paragraph.lines.forEach((line, index) => {
			const lineHeight = line.size * LINE_FACTOR * paragraph.lineHeight;
			const baseline = y + lineHeight * 0.8;
			const start = text.insets.left + source.marginLeft;
			const free = Math.max(0, inner - source.marginLeft - line.width);
			let x = start;
			if (source.align === "center") x += free / 2;
			else if (source.align === "right") x += free;
			if (index === 0 && source.bullet) {
				const first = line.pieces[0]?.run;
				ctx.fillStyle = source.bulletColor ?? first?.color ?? NOTE_INK;
				if (first) ctx.font = fontString(first);
				ctx.fillText(source.bullet, Math.max(0, start + source.indent), baseline);
			}
			for (const piece of line.pieces) {
				ctx.font = fontString(piece.run);
				ctx.fillStyle = piece.run.color;
				ctx.fillText(piece.text, x, baseline);
				if (piece.run.underline) {
					const rule = Math.max(0.5, piece.run.size / 16);
					ctx.fillRect(x, baseline + rule * 1.5, piece.width, rule);
				}
				x += piece.width;
			}
			y += lineHeight;
		});
		y += paragraph.after;
	}
}
// #endregion

// #region Fills
function trace(ctx: CanvasRenderingContext2D, geometry: SceneGeometry, w: number, h: number): void {
	ctx.beginPath();
	switch (geometry.kind) {
		case "round":
			ctx.roundRect(0, 0, w, h, geometry.radius);
			break;
		case "ellipse":
			ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
			break;
		case "line":
			ctx.moveTo(0, 0);
			ctx.lineTo(w, h);
			break;
		case "polygon":
			geometry.points.forEach(([x, y], i) => {
				if (i === 0) ctx.moveTo(x * w, y * h);
				else ctx.lineTo(x * w, y * h);
			});
			ctx.closePath();
			break;
		case "path":
			for (const step of geometry.commands) {
				if (step.op === "curve") {
					const { x1, y1, x2, y2, x, y } = step;
					ctx.bezierCurveTo(x1 * w, y1 * h, x2 * w, y2 * h, x * w, y * h);
				} else if (step.op === "close") ctx.closePath();
				else if (step.op === "move") ctx.moveTo(step.x * w, step.y * h);
				else ctx.lineTo(step.x * w, step.y * h);
			}
			break;
		default:
			ctx.rect(0, 0, w, h);
	}
}

function gradientOf(
	ctx: CanvasRenderingContext2D,
	paint: Extract<ScenePaint, { kind: "gradient" }>,
	w: number,
	h: number,
): CanvasGradient {
	const angle = paint.angle * Math.PI / 180;
	const reach = (Math.abs(Math.cos(angle)) * w + Math.abs(Math.sin(angle)) * h) / 2;
	const dx = Math.cos(angle) * reach;
	const dy = Math.sin(angle) * reach;
	const gradient = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
	for (const stop of paint.stops) {
		gradient.addColorStop(Math.min(1, Math.max(0, stop.at)), stop.color);
	}
	return gradient;
}

function fillTraced(
	ctx: CanvasRenderingContext2D,
	paint: ScenePaint,
	images: ReadonlyMap<string, SceneImage>,
	w: number,
	h: number,
): void {
	if (paint.kind === "solid") {
		ctx.fillStyle = paint.color;
		ctx.fill();
		return;
	}
	if (paint.kind === "gradient") {
		ctx.fillStyle = gradientOf(ctx, paint, w, h);
		ctx.fill();
		return;
	}
	const image = images.get(paint.media);
	if (!image) return;
	const { left, top, right, bottom } = paint.crop;
	ctx.save();
	ctx.clip();
	ctx.drawImage(
		image,
		image.width * left,
		image.height * top,
		image.width * (1 - left - right),
		image.height * (1 - top - bottom),
		0,
		0,
		w,
		h,
	);
	ctx.restore();
}

function strokeTraced(ctx: CanvasRenderingContext2D, line: SceneLine): void {
	ctx.strokeStyle = line.color;
	ctx.lineWidth = line.width;
	ctx.setLineDash(line.dash ? [...line.dash] : []);
	ctx.stroke();
	ctx.setLineDash([]);
}
// #endregion

// #region Items
function placed(ctx: CanvasRenderingContext2D, box: SceneBox, draw: () => void): void {
	ctx.save();
	ctx.translate(box.x + box.width / 2, box.y + box.height / 2);
	if (box.rotation) ctx.rotate(box.rotation * Math.PI / 180);
	ctx.translate(-box.width / 2, -box.height / 2);
	draw();
	ctx.restore();
}

function paintShape(
	ctx: CanvasRenderingContext2D,
	shape: SceneShape,
	images: ReadonlyMap<string, SceneImage>,
): void {
	const { box } = shape;
	placed(ctx, box, () => {
		ctx.save();
		// A flip mirrors the outline, never the text inside it.
		if (box.flipH || box.flipV) {
			ctx.translate(box.flipH ? box.width : 0, box.flipV ? box.height : 0);
			ctx.scale(box.flipH ? -1 : 1, box.flipV ? -1 : 1);
		}
		trace(ctx, shape.geometry, box.width, box.height);
		if (shape.fill) fillTraced(ctx, shape.fill, images, box.width, box.height);
		if (shape.line) strokeTraced(ctx, shape.line);
		ctx.restore();
		if (shape.text) paintText(ctx, shape.text, box.width, box.height);
	});
}

function cellSpan(sizes: readonly number[], start: number, span: number): number {
	let total = 0;
	for (let i = start; i < start + span && i < sizes.length; i++) total += sizes[i];
	return total;
}

function paintCell(
	ctx: CanvasRenderingContext2D,
	cell: SceneCell,
	images: ReadonlyMap<string, SceneImage>,
	x: number,
	y: number,
	w: number,
	h: number,
): void {
	ctx.save();
	ctx.translate(x, y);
	ctx.beginPath();
	ctx.rect(0, 0, w, h);
	if (cell.fill) fillTraced(ctx, cell.fill, images, w, h);
	ctx.strokeStyle = TABLE_RULE;
	ctx.lineWidth = 0.5;
	ctx.stroke();
	if (cell.text) paintText(ctx, cell.text, w, h);
	ctx.restore();
}

/** A row's written height is only its minimum: it grows to hold its tallest cell. */
function rowHeights(
	ctx: CanvasRenderingContext2D,
	table: SceneTable,
	columns: readonly number[],
): number[] {
	return table.rows.map((row) => {
		let height = row.height;
		row.cells.forEach((cell, c) => {
			if (!cell?.text || cell.rowSpan > 1) return;
			const { insets } = cell.text;
			const room = cellSpan(columns, c, cell.columnSpan) - insets.left - insets.right;
			const text = layoutText(ctx, cell.text, Math.max(1, room)).height;
			height = Math.max(height, text + insets.top + insets.bottom);
		});
		return height;
	});
}

function paintTable(
	ctx: CanvasRenderingContext2D,
	table: SceneTable,
	images: ReadonlyMap<string, SceneImage>,
): void {
	const scaleX = table.box.width / (table.columns.reduce((sum, w) => sum + w, 0) || 1);
	const columns = table.columns.map((w) => w * scaleX);
	const heights = rowHeights(ctx, table, columns);
	placed(ctx, table.box, () => {
		let y = 0;
		table.rows.forEach((row, r) => {
			let x = 0;
			row.cells.forEach((cell, c) => {
				const width = columns[c] ?? 0;
				if (cell) {
					paintCell(
						ctx,
						cell,
						images,
						x,
						y,
						cellSpan(columns, c, cell.columnSpan),
						cellSpan(heights, r, cell.rowSpan),
					);
				}
				x += width;
			});
			y += heights[r];
		});
	});
}

function paintNote(ctx: CanvasRenderingContext2D, box: SceneBox, label: string): void {
	placed(ctx, box, () => {
		ctx.fillStyle = NOTE_FILL;
		ctx.fillRect(0, 0, box.width, box.height);
		ctx.fillStyle = NOTE_INK;
		ctx.font = `${Math.max(10, Math.min(box.height / 6, 18))}px ${FALLBACK_FONTS}`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(label, box.width / 2, box.height / 2);
		ctx.textAlign = "start";
	});
}

function paintItem(
	ctx: CanvasRenderingContext2D,
	item: SceneItem,
	images: ReadonlyMap<string, SceneImage>,
): void {
	if (item.kind === "shape") paintShape(ctx, item, images);
	else if (item.kind === "table") paintTable(ctx, item, images);
	else paintNote(ctx, item.box, item.label);
}
// #endregion

/** Draw a whole slide across a canvas of `width` device pixels. */
export function paintSlide(
	ctx: CanvasRenderingContext2D,
	scene: SlideScene,
	images: ReadonlyMap<string, SceneImage>,
	width: number,
): void {
	const scale = width / scene.width;
	ctx.save();
	ctx.setTransform(scale, 0, 0, scale, 0, 0);
	ctx.fillStyle = PAPER;
	ctx.fillRect(0, 0, scene.width, scene.height);
	if (scene.background) {
		ctx.beginPath();
		ctx.rect(0, 0, scene.width, scene.height);
		fillTraced(ctx, scene.background, images, scene.width, scene.height);
	}
	for (const item of scene.items) paintItem(ctx, item, images);
	ctx.restore();
}
