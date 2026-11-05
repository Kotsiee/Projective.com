/// <reference lib="dom" />
import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { WEAVE_STROKE } from "../core/hero-weave.ts";
import { watchFit, weavePattern, weaveTile } from "../core/weave-canvas.ts";

/** The root attributes a theme, contrast or colour-vision change writes. */
const THEME_ATTRIBUTES = ["style", "data-theme", "data-contrast", "data-cvd"];

/**
 * HeroWeave — the Explore headers' stencil (Decisions #351, #353, #357, #384): the strapwork tile
 * repeated over its box in one translucent stroke, on a canvas. Static, so there is no animation loop:
 * it paints when it mounts and again only when its box, the device pixel ratio or the theme changes.
 * The ink is the computed `stroke` of `.ex-weave` (`explore.css`), so the token stays in the sheet.
 * Purely decorative; the header that places it owns its position and its mask.
 */
export default function HeroWeave(): JSX.Element {
	const ref = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = ref.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;
		let painted = "";

		const paint = () => {
			const dpr = globalThis.devicePixelRatio || 1;
			const box = canvas.getBoundingClientRect();
			const width = Math.round(box.width * dpr);
			const height = Math.round(box.height * dpr);
			const ink = getComputedStyle(canvas).stroke;
			// `none` until the sheet lands; the box change it brings paints then.
			const state = `${width} ${height} ${dpr} ${ink}`;
			if (ink === "none" || state === painted) return;
			painted = state;
			canvas.width = width;
			canvas.height = height;
			ctx.scale(dpr, dpr);
			ctx.fillStyle = weavePattern(ctx, weaveTile(dpr, WEAVE_STROKE, ink));
			ctx.fillRect(0, 0, width / dpr, height / dpr);
		};

		const unwatch = watchFit(canvas, paint);
		const theme = new MutationObserver(paint);
		theme.observe(document.documentElement, {
			attributes: true,
			attributeFilter: THEME_ATTRIBUTES,
		});
		return () => {
			unwatch();
			theme.disconnect();
			canvas.width = canvas.height = 0;
		};
	}, []);

	return <canvas ref={ref} class="ex-weave" aria-hidden="true" />;
}
