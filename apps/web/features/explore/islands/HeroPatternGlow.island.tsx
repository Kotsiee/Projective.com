/// <reference lib="dom" />
import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { weaveTileSvg } from "../core/hero-weave.ts";
import { GLOW_LIFE_MS, glowIntensity, glowRadius } from "../core/pattern-glow.ts";

// #region Tuning
/** A move closer than this (CSS px) to the last particle adds nothing and is skipped. */
const STEP = 10;
/** The most particles alive at once; the oldest give way, so a frantic pointer never costs more. */
const MAX_PARTICLES = 200;
/** The canvas mask's ribbons: a little wider than the stencil's, part-opaque so crossings add up. */
const MASK_STROKE = { width: 2.5, opacity: 0.8 };
/**
 * The bloom: the lit straps blurred and laid beneath themselves, as `[blur in CSS px, strength]` —
 * a tight bright halo over the first 2–4px off a strap, then a fainter band that falls off over the
 * next 3–8px — so light reaches the empty canvas only close to a strap that is already lit.
 */
const BLOOM: readonly [number, number][] = [[1.5, 0.9], [3.5, 0.3]];
// #endregion

/** Either reduced-motion channel: the OS setting or the app's own override (`data-motion`). */
function motionReduced(): boolean {
	return document.documentElement.dataset.motion === "reduced" ||
		globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The light's colour, `--primary-mid` as resolved on `host` — the seed's mid tone, the same in both
 * modes — as `[r, g, b]` (the canvas normalises any CSS colour to hex).
 */
function primaryRgb(ctx: CanvasRenderingContext2D, host: Element): [number, number, number] {
	const style = getComputedStyle(host);
	ctx.fillStyle = (style.getPropertyValue("--primary-mid") || style.getPropertyValue("--primary"))
		.trim() || "currentColor";
	const hex = String(ctx.fillStyle).replace("#", "");
	return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0) as [number, number, number];
}

/**
 * HeroPatternGlow — the Explore gateway's underlay light (Decision #351): an `aria-hidden`,
 * pointer-inert canvas BENEATH the hero's stencil. Each fine-pointer move adds a `--primary-mid` particle
 * that lives {@link GLOW_LIFE_MS}, contracting from a wide wash to a point while it fades, and dimmed
 * a little by its distance from where the pointer is now (`core/pattern-glow.ts`), so a sweep leaves a
 * long tapering trail rather than a spotlight. The frame is then cut to
 * the weave's ribbons (the stencil's own tile, as a canvas mask), so the light shines up through the
 * translucent ribbons above it and lights the same geometry where the stencil's radial mask hides it;
 * crossings, where the mask's part-opaque ribbons overlap, glow brightest. Last, the lit ribbons bloom:
 * their own blurred copy is laid beneath them, so light reaches the empty canvas only around a lit
 * ribbon, anchored to the pattern, never as a free-floating wash. Particles are drawn at their share of the peak, which is the canvas's own
 * opacity (`explore.css`), so overlaps saturate at it rather than stack past it.
 *
 * It costs nothing at rest: a frame is requested only while a particle is alive. It never starts on a
 * touch-only device; under either reduced-motion channel, read every frame, it drops its particles,
 * clears and stops, leaving the static stencil; out of view (`IntersectionObserver`) it does the same
 * and ignores the pointer.
 */
export default function HeroPatternGlow(): JSX.Element {
	const ref = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = ref.current;
		const host = canvas?.parentElement;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !host || !ctx) return;
		if (!globalThis.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

		const particles: { x: number; y: number; t: number }[] = [];
		const lines = document.createElement("canvas");
		const linesCtx = lines.getContext("2d")!;
		const cursor = { x: 0, y: 0 };
		let dpr = 0;
		let mask: CanvasPattern | null = null;
		let rgb: [number, number, number] = [0, 0, 0];
		let visible = true;
		let frame = 0;

		const loadMask = () => {
			const img = new Image();
			img.src = `data:image/svg+xml,${encodeURIComponent(weaveTileSvg(dpr, MASK_STROKE))}`;
			img.decode().then(() => {
				mask = ctx.createPattern(img, "repeat");
				mask?.setTransform(new DOMMatrix().scaleSelf(1 / dpr));
			}).catch(() => (mask = null));
		};

		const resize = () => {
			const box = host.getBoundingClientRect();
			const next = globalThis.devicePixelRatio || 1;
			canvas.width = Math.round(box.width * next);
			canvas.height = Math.round(box.height * next);
			lines.width = canvas.width;
			lines.height = canvas.height;
			if (next !== dpr) {
				dpr = next;
				loadMask();
			}
		};

		const clear = () => {
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.globalCompositeOperation = "source-over";
			ctx.clearRect(0, 0, canvas.width, canvas.height);
		};

		const stop = () => {
			particles.length = 0;
			cancelAnimationFrame(frame);
			frame = 0;
			clear();
		};

		const draw = (now: number) => {
			frame = 0;
			if (motionReduced()) return stop();
			while (particles.length > 0 && now - particles[0].t >= GLOW_LIFE_MS) particles.shift();
			clear();
			if (particles.length === 0 || !mask) return;
			const [r, g, b] = rgb;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			for (const p of particles) {
				const age = now - p.t;
				const radius = glowRadius(age);
				const alpha = glowIntensity(age, Math.hypot(p.x - cursor.x, p.y - cursor.y));
				const fill = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
				fill.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
				fill.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
				ctx.fillStyle = fill;
				ctx.beginPath();
				ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
				ctx.fill();
			}
			// Keep the light only on the weave's ribbons...
			ctx.globalCompositeOperation = "destination-in";
			ctx.fillStyle = mask;
			ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
			// ...then bloom them from one copy of the lit straps, laid beneath them, so any light off a
			// strap comes from one and each halo blurs the straps alone, not the halo before it.
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			linesCtx.clearRect(0, 0, lines.width, lines.height);
			linesCtx.drawImage(canvas, 0, 0);
			ctx.globalCompositeOperation = "destination-over";
			for (const [blur, alpha] of BLOOM) {
				ctx.filter = `blur(${blur * dpr}px)`;
				ctx.globalAlpha = alpha;
				ctx.drawImage(lines, 0, 0);
			}
			ctx.filter = "none";
			ctx.globalAlpha = 1;
			ctx.globalCompositeOperation = "source-over";
			frame = requestAnimationFrame(draw);
		};

		const onEnter = () => (rgb = primaryRgb(ctx, host));
		const onMove = (event: PointerEvent) => {
			if (!visible || motionReduced()) return;
			const box = host.getBoundingClientRect();
			cursor.x = event.clientX - box.left;
			cursor.y = event.clientY - box.top;
			const last = particles.at(-1);
			if (last && Math.hypot(cursor.x - last.x, cursor.y - last.y) < STEP) return;
			particles.push({ x: cursor.x, y: cursor.y, t: performance.now() });
			if (particles.length > MAX_PARTICLES) particles.shift();
			if (!frame) frame = requestAnimationFrame(draw);
		};

		const resizes = new ResizeObserver(resize);
		const views = new IntersectionObserver(([entry]) => {
			visible = entry.isIntersecting;
			if (!visible) stop();
		});
		resize();
		rgb = primaryRgb(ctx, host);
		resizes.observe(host);
		views.observe(host);
		host.addEventListener("pointerenter", onEnter);
		host.addEventListener("pointermove", onMove, { passive: true });
		return () => {
			host.removeEventListener("pointerenter", onEnter);
			host.removeEventListener("pointermove", onMove);
			resizes.disconnect();
			views.disconnect();
			cancelAnimationFrame(frame);
		};
	}, []);

	return <canvas ref={ref} class="ex-hero__glow-canvas" aria-hidden="true" />;
}
