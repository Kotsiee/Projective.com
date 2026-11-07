/// <reference lib="dom" />
/**
 * thumb-canvas — the shared parts of a drawn thumbnail: a canvas at the size every card can use, its
 * export, and the small sheet a spreadsheet previews as. A thumbnail is a snapshot of a document, so it
 * is paper-coloured in both themes rather than token-coloured, like the page it shows.
 */

/** The longest edge of a stored thumbnail: a 240px card at 2× density. */
export const THUMB_PX = 480;

const PAPER = "#ffffff";
const RULE = "#dadce0";
const INK = "#202124";
const HEADER_FILL = "#e8f5ec";
const FONT = `"Segoe UI", "Helvetica Neue", Arial, sans-serif`;
const QUALITY = 0.8;

/** A canvas with its 2D context, or null where a canvas can't be had. */
export function paperCanvas(
	width: number,
	height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	ctx.fillStyle = PAPER;
	ctx.fillRect(0, 0, width, height);
	return { canvas, ctx };
}

/** Export a canvas, freeing its memory afterwards. WebP where the browser can write it. */
export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
	return new Promise((resolve) => {
		canvas.toBlob(
			(blob) => {
				canvas.width = 0;
				canvas.height = 0;
				resolve(blob);
			},
			"image/webp",
			QUALITY,
		);
	});
}

const SHEET_ROWS = 13;
const SHEET_COLUMNS = 6;
const ROW_PX = THUMB_PX / SHEET_ROWS;
const COLUMN_MIN_PX = 44;
const CELL_PAD_PX = 8;
const TEXT_PX = 15;

/** The first rows and columns of a table as a small sheet, with its top row shaded as a header. */
export function paintTable(rows: readonly (readonly string[])[]): HTMLCanvasElement | null {
	const paper = paperCanvas(THUMB_PX, THUMB_PX);
	if (!paper) return null;
	const { canvas, ctx } = paper;
	const shown = rows.slice(0, SHEET_ROWS);
	const columns = Math.min(
		SHEET_COLUMNS,
		Math.max(1, ...shown.map((row) => row.length)),
	);
	ctx.font = `${TEXT_PX}px ${FONT}`;
	const natural = Array.from({ length: columns }, (_, c) =>
		Math.max(
			COLUMN_MIN_PX,
			...shown.map((row) => ctx.measureText(row[c] ?? "").width + CELL_PAD_PX * 2),
		));
	const scale = THUMB_PX / Math.max(THUMB_PX, natural.reduce((sum, width) => sum + width, 0));
	const widths = natural.map((width) => width * scale);
	const free = THUMB_PX - widths.reduce((sum, width) => sum + width, 0);
	if (free > 0) widths[widths.length - 1] += free;

	ctx.fillStyle = HEADER_FILL;
	ctx.fillRect(0, 0, THUMB_PX, ROW_PX);
	ctx.textBaseline = "middle";
	shown.forEach((row, r) => {
		let x = 0;
		ctx.font = `${r === 0 ? "600 " : ""}${TEXT_PX}px ${FONT}`;
		for (let c = 0; c < columns; c++) {
			const text = row[c] ?? "";
			ctx.save();
			ctx.beginPath();
			ctx.rect(x, r * ROW_PX, widths[c], ROW_PX);
			ctx.clip();
			ctx.fillStyle = INK;
			ctx.fillText(text, x + CELL_PAD_PX, (r + 0.5) * ROW_PX);
			ctx.restore();
			x += widths[c];
		}
	});

	ctx.strokeStyle = RULE;
	ctx.lineWidth = 1;
	ctx.beginPath();
	for (let r = 1; r <= SHEET_ROWS; r++) {
		ctx.moveTo(0, r * ROW_PX);
		ctx.lineTo(THUMB_PX, r * ROW_PX);
	}
	let x = 0;
	for (const width of widths) {
		x += width;
		ctx.moveTo(x, 0);
		ctx.lineTo(x, THUMB_PX);
	}
	ctx.stroke();
	return canvas;
}
