/// <reference lib="dom" />
import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { GLOW_LIFE_MS, glowBounds, glowIntensity, glowRadius } from "../core/pattern-glow.ts";
import { watchFit, weaveHalo, weavePattern, weaveTile } from "../core/weave-canvas.ts";

// #region Tuning
/** A move closer than this (CSS px) to the last particle adds nothing and is skipped. */
const STEP = 10;
/** The most particles alive at once; the oldest give way, so a frantic pointer never costs more. */
const MAX_PARTICLES = 200;
/** The straps' tile: a little wider than the stencil's, part-opaque. */
const MASK_STROKE = { width: 2.5, opacity: 0.8 };
/**
 * The bloom: the straps blurred and laid beneath themselves, as `[blur in CSS px, strength]` — a tight
 * bright halo over the first 2–4px off a strap, then a fainter band that falls off over the next
 * 3–8px — so light reaches the empty canvas only close to a strap that is already lit.
 */
const BLOOM: readonly [number, number][] = [[1.5, 0.9], [3.5, 0.3]];
/** The light stamp's edge in px, scaled to each particle: a smooth ramp, so it scales cleanly. */
const STAMP = 256;
// #endregion

/** Either reduced-motion channel: the OS setting or the app's own override (`data-motion`). */
function motionReduced(): boolean {
	return document.documentElement.dataset.motion === "reduced" ||
		globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The light's colour, `--primary-mid` as resolved on `host`: the seed's mid tone in both modes. */
function lightInk(host: Element): string {
	const style = getComputedStyle(host);
	return (style.getPropertyValue("--primary-mid") || style.getPropertyValue("--primary")).trim();
}

/** One particle's light as a reusable image: `ink`, fading from the centre out to the edge. */
function lightStamp(ink: string): HTMLCanvasElement {
	const stamp = document.createElement("canvas");
	stamp.width = stamp.height = STAMP;
	const ctx = stamp.getContext("2d")!;
	const r = STAMP / 2;
	const falloff = ctx.createRadialGradient(r, r, 0, r, r, r);
	falloff.addColorStop(0, "black");
	falloff.addColorStop(1, "transparent");
	ctx.fillStyle = falloff;
	ctx.fillRect(0, 0, STAMP, STAMP);
	ctx.globalCompositeOperation = "source-in";
	ctx.fillStyle = ink;
	ctx.fillRect(0, 0, STAMP, STAMP);
	return stamp;
}

/**
 * HeroPatternGlow — the Explore gateway's underlay light (Decisions #351, #382): an `aria-hidden`,
 * pointer-inert pair of canvases BENEATH the hero's stencil. Each fine-pointer move adds a
 * `--primary-mid` particle that lives {@link GLOW_LIFE_MS}, contracting from a wide wash to a point
 * while it fades, and dimmed a little by its distance from where the pointer is now
 * (`core/pattern-glow.ts`), so a sweep leaves a long tapering trail rather than a spotlight.
 *
 * The same light is drawn on both canvases and cut to a tile baked once per device ratio: the top one
 * to the weave's ribbons, the one beneath to their bloom, at CSS resolution because a halo is soft.
 * The compositor stacks them, so the light shines up through the translucent ribbons above and reaches
 * the empty canvas only around a lit ribbon, and nothing is blurred or copied between canvases per
 * frame. Each particle is a scaled {@link lightStamp}, and each cut is clipped to the lit box, so a
 * frame costs what is lit. Particles are drawn at their share of the peak, which is the wrapper's own
 * opacity (`explore.css`), so overlaps saturate at it rather than stack past it.
 *
 * It costs nothing at rest: a frame is requested only while a particle is alive. It never starts on a
 * touch-only device; under either reduced-motion channel, read every frame, it drops its particles,
 * clears and stops, leaving the static stencil; out of view (`IntersectionObserver`) it does the same
 * and ignores the pointer.
 */
export default function HeroPatternGlow(): JSX.Element {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const glow = ref.current;
		const host = glow?.parentElement;
		const canvases = glow ? [...glow.querySelectorAll("canvas")] : [];
		const contexts = canvases.map((canvas) => canvas.getContext("2d"));
		const [haloCtx, strapsCtx] = contexts;
		if (!glow || !host || !haloCtx || !strapsCtx) return;
		if (!globalThis.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

		const particles: { x: number; y: number; t: number; r: number; alpha: number }[] = [];
		const layers = [
			{ ctx: haloCtx, scale: 1, cut: null as CanvasPattern | null },
			{ ctx: strapsCtx, scale: 1, cut: null as CanvasPattern | null },
		];
		const cursor = { x: 0, y: 0 };
		let dpr = 0;
		let ink = lightInk(host);
		let stamp = lightStamp(ink);
		let visible = true;
		let frame = 0;

		const bake = () => {
			const ribbon = `rgba(0, 0, 0, ${MASK_STROKE.opacity})`;
			const [halo, straps] = layers;
			halo.scale = Math.min(dpr, 1);
			straps.scale = dpr;
			const soft = weaveTile(halo.scale, MASK_STROKE.width, ribbon);
			halo.cut = weavePattern(halo.ctx, weaveHalo(soft, halo.scale, BLOOM));
			straps.cut = weavePattern(straps.ctx, weaveTile(dpr, MASK_STROKE.width, ribbon));
		};

		const fit = () => {
			const box = glow.getBoundingClientRect();
			const next = globalThis.devicePixelRatio || 1;
			if (next !== dpr) {
				dpr = next;
				bake();
			}
			for (const { ctx, scale } of layers) {
				ctx.canvas.width = Math.round(box.width * scale);
				ctx.canvas.height = Math.round(box.height * scale);
			}
		};

		const clear = () => {
			for (const { ctx } of layers) {
				ctx.setTransform(1, 0, 0, 1, 0, 0);
				ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
			}
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
			if (particles.length === 0) return;
			for (const p of particles) {
				const age = now - p.t;
				p.r = glowRadius(age);
				p.alpha = glowIntensity(age, Math.hypot(p.x - cursor.x, p.y - cursor.y));
			}
			const [x, y, width, height] = glowBounds(particles);
			for (const { ctx, scale, cut } of layers) {
				ctx.setTransform(scale, 0, 0, scale, 0, 0);
				for (const p of particles) {
					ctx.globalAlpha = p.alpha;
					ctx.drawImage(stamp, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
				}
				ctx.save();
				ctx.beginPath();
				ctx.rect(x, y, width, height);
				ctx.clip();
				ctx.globalAlpha = 1;
				ctx.globalCompositeOperation = "destination-in";
				ctx.fillStyle = cut!;
				ctx.fillRect(x, y, width, height);
				ctx.restore();
			}
			frame = requestAnimationFrame(draw);
		};

		const onEnter = () => {
			const next = lightInk(host);
			if (next === ink) return;
			ink = next;
			stamp = lightStamp(ink);
		};
		const onMove = (event: PointerEvent) => {
			if (!visible || motionReduced()) return;
			const box = host.getBoundingClientRect();
			cursor.x = event.clientX - box.left;
			cursor.y = event.clientY - box.top;
			const last = particles.at(-1);
			if (last && Math.hypot(cursor.x - last.x, cursor.y - last.y) < STEP) return;
			particles.push({ x: cursor.x, y: cursor.y, t: performance.now(), r: 0, alpha: 0 });
			if (particles.length > MAX_PARTICLES) particles.shift();
			if (!frame) frame = requestAnimationFrame(draw);
		};

		const unwatch = watchFit(glow, fit);
		const views = new IntersectionObserver(([entry]) => {
			visible = entry.isIntersecting;
			if (!visible) stop();
		});
		views.observe(host);
		host.addEventListener("pointerenter", onEnter);
		host.addEventListener("pointermove", onMove, { passive: true });
		return () => {
			host.removeEventListener("pointerenter", onEnter);
			host.removeEventListener("pointermove", onMove);
			unwatch();
			views.disconnect();
			cancelAnimationFrame(frame);
			for (const { ctx } of layers) ctx.canvas.width = ctx.canvas.height = 0;
		};
	}, []);

	return (
		<div ref={ref} class="ex-hero__glow" aria-hidden="true">
			<canvas class="ex-hero__glow-canvas" />
			<canvas class="ex-hero__glow-canvas" />
		</div>
	);
}
