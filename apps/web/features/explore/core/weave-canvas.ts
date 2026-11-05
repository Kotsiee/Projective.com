/// <reference lib="dom" />
import { WEAVE_PATH, WEAVE_TILE } from "./hero-weave.ts";

/**
 * weave-canvas — the strapwork on a canvas, shared by the stencil (`HeroWeave`) and the glow
 * (`HeroPatternGlow`): one tile rasterised from {@link WEAVE_PATH}, so the light always falls on the
 * straps the stencil draws. DOM only; the geometry itself stays pure in `hero-weave.ts`.
 */

/**
 * The tile stroked onto its own canvas at `scale` device px per CSS px, rounded to whole pixels so the
 * pattern repeats without a seam at a fractional device ratio.
 */
export function weaveTile(scale: number, width: number, ink: string): HTMLCanvasElement {
	const tile = document.createElement("canvas");
	tile.width = tile.height = Math.round(WEAVE_TILE * scale);
	const ctx = tile.getContext("2d")!;
	ctx.scale(tile.width / WEAVE_TILE, tile.height / WEAVE_TILE);
	ctx.lineWidth = width;
	ctx.lineCap = ctx.lineJoin = "round";
	ctx.strokeStyle = ink;
	ctx.stroke(new Path2D(WEAVE_PATH));
	return tile;
}

/** A repeating pattern of `tile`, sized in CSS px and anchored at the canvas's top-left corner. */
export function weavePattern(
	ctx: CanvasRenderingContext2D,
	tile: HTMLCanvasElement,
): CanvasPattern {
	const pattern = ctx.createPattern(tile, "repeat")!;
	pattern.setTransform(new DOMMatrix().scaleSelf(WEAVE_TILE / tile.width));
	return pattern;
}

/**
 * The tile's bloom, baked once: each `[blur in CSS px, strength]` pass laid beneath the one before it.
 * Blurs a 3 × 3 block and keeps its centre, so a halo crosses the tile's edge and the pattern stays
 * seamless.
 */
export function weaveHalo(
	tile: HTMLCanvasElement,
	scale: number,
	bloom: readonly (readonly [number, number])[],
): HTMLCanvasElement {
	const size = tile.width;
	const block = document.createElement("canvas");
	block.width = block.height = size * 3;
	const blockCtx = block.getContext("2d")!;
	for (let i = 0; i < 9; i++) blockCtx.drawImage(tile, (i % 3) * size, Math.floor(i / 3) * size);
	const halo = document.createElement("canvas");
	halo.width = halo.height = size;
	const ctx = halo.getContext("2d")!;
	ctx.globalCompositeOperation = "destination-over";
	for (const [blur, strength] of bloom) {
		ctx.filter = `blur(${blur * scale}px)`;
		ctx.globalAlpha = strength;
		ctx.drawImage(block, -size, -size);
	}
	return halo;
}

/**
 * Calls `fit` now and again whenever `target`'s box or the device pixel ratio changes (a browser zoom,
 * a move to another display); returns the unbinder. A `ResizeObserver` delivers at most once a frame,
 * before paint, so a window drag repaints every frame without ever showing a stretched canvas.
 */
export function watchFit(target: Element, fit: () => void): () => void {
	const boxes = new ResizeObserver(fit);
	let ratio: MediaQueryList | null = null;
	const onRatio = () => {
		watchRatio();
		fit();
	};
	const watchRatio = () => {
		ratio?.removeEventListener("change", onRatio);
		ratio = globalThis.matchMedia(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`);
		ratio.addEventListener("change", onRatio);
	};
	watchRatio();
	fit();
	boxes.observe(target);
	return () => {
		boxes.disconnect();
		ratio?.removeEventListener("change", onRatio);
	};
}
