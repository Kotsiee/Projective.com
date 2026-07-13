import { useEffect, useRef } from "preact/hooks";

/**
 * HeroParticles — a canvas particle field bound strictly to the hero container.
 *
 * Physics (device-independent CSS px, DPR-scaled on paint):
 *  · Depth layering — each particle carries a `baseBlur` (0 = crisp, 1 = soft). Blur is faked with a
 *    radial-gradient falloff (no per-draw `ctx.filter`, which is far too slow), so blurrier particles
 *    read as further away. Depth also scales size, opacity, drift range and speed for parallax.
 *  · Free idle drift — a two-frequency Lissajous wander (amplitude scales with depth) lets particles
 *    roam broadly around their home anchor rather than jitter in place.
 *  · Proximity focus — as the cursor nears a particle its blur falls toward 0 (sharp when close).
 *  · Cursor repel — inside a radius, particles are pushed off the pointer path.
 *  · Logarithmic gravity implosion — pointer hold pulls particles toward the cursor with a force ∝
 *    log(1+d): distant particles accelerate hard inward, then decelerate and condense near centre.
 *  · Scroll fade — canvas opacity tracks the hero's exit from the viewport (1 → 0).
 *  · Colour — monochromatic shades of the live `--primary` token, re-read on theme change.
 *
 * Dumb island; honours reduced-motion by rendering a single static frame (jump-to-final).
 */

interface Particle {
	hx: number;
	hy: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	/** Core radius (px). */
	r: number;
	/** Depth blur 0 (crisp) → 1 (soft/far). */
	baseBlur: number;
	/** Idle drift amplitude (px) and per-axis frequency ratios + phases. */
	amp: number;
	fx: number;
	fy: number;
	px: number;
	py: number;
	ps: number;
	/** Per-particle brightness multiplier + base alpha for monochrome variety. */
	bright: number;
	alpha: number;
}

/** Parse `--primary` (hex or rgb[a]) to an `[r,g,b]` triple; falls back to a calm teal. */
function readPrimary(): [number, number, number] {
	const raw = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
	if (raw.startsWith("#")) {
		const hx = raw.slice(1);
		const full = hx.length === 3 ? hx.split("").map((c) => c + c).join("") : hx;
		const n = parseInt(full, 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}
	const m = raw.match(/(\d+(?:\.\d+)?)/g);
	if (m && m.length >= 3) return [+m[0], +m[1], +m[2]];
	return [40, 134, 144];
}

/** A monochromatic shade of `base`: same hue, varied brightness + alpha. */
function shade(base: [number, number, number], bright: number, alpha: number): string {
	const c = (v: number) => Math.round(Math.min(255, Math.max(0, v * bright)));
	return `rgba(${c(base[0])}, ${c(base[1])}, ${c(base[2])}, ${Math.max(0, alpha).toFixed(3)})`;
}

export default function HeroParticles() {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const el = canvasRef.current;
		const host = el?.parentElement ?? null;
		const ctx = el?.getContext("2d") ?? null;
		if (!el || !host || !ctx) return;
		const canvas: HTMLCanvasElement = el;
		const g2d: CanvasRenderingContext2D = ctx;
		const hostEl: HTMLElement = host;

		const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
		const scroller = canvas.closest(".ui-page-canvas__scroll") as HTMLElement | null;

		let w = 0;
		let h = 0;
		let particles: Particle[] = [];
		let base = readPrimary();

		// Pointer state (CSS px, canvas-local).
		let mx = -9999;
		let my = -9999;
		let inside = false;
		let holding = false;

		const REPEL_R = 120;
		const FOCUS_R = 150; // proximity-sharpen radius
		const SPRING = 0.011;
		const DAMP = 0.9;

		function build() {
			const rect = hostEl.getBoundingClientRect();
			w = rect.width;
			h = rect.height;
			const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
			g2d.setTransform(dpr, 0, 0, dpr, 0, 0);

			const count = Math.min(130, Math.max(32, Math.round((w * h) / 11000)));
			particles = Array.from({ length: count }, () => {
				const x = Math.random() * w;
				const y = Math.random() * h;
				const baseBlur = Math.random();
				return {
					hx: x,
					hy: y,
					x,
					y,
					vx: 0,
					vy: 0,
					// Blurrier (further) particles are larger, roam more, drift slower.
					r: 0.8 + Math.random() * 1.6 + baseBlur * 1.8,
					baseBlur,
					amp: 14 + baseBlur * 46 + Math.random() * 10,
					fx: 0.7 + Math.random() * 0.6,
					fy: 0.7 + Math.random() * 0.6,
					px: Math.random() * Math.PI * 2,
					py: Math.random() * Math.PI * 2,
					ps: 0.0025 + (1 - baseBlur) * 0.006 + Math.random() * 0.002,
					bright: 0.75 + Math.random() * 0.45,
					alpha: 0.6 - baseBlur * 0.32,
				};
			});
		}

		function recolor() {
			base = readPrimary();
			if (reduce) draw();
		}

		function draw() {
			g2d.clearRect(0, 0, w, h);
			for (const p of particles) {
				// Proximity focus: sharpen (reduce blur) as the cursor nears this particle.
				let effBlur = p.baseBlur;
				if (inside) {
					const dd = Math.hypot(p.x - mx, p.y - my);
					const focus = Math.max(0, 1 - dd / FOCUS_R);
					effBlur = p.baseBlur * (1 - focus);
				}

				const radius = p.r * (1 + effBlur * 3.6);
				const solidStop = Math.min(0.9, Math.max(0.02, 0.9 - effBlur * 0.9));
				const grad = g2d.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.max(0.5, radius));
				const col = shade(base, p.bright, p.alpha);
				grad.addColorStop(0, col);
				grad.addColorStop(solidStop, col);
				grad.addColorStop(1, shade(base, p.bright, 0));

				g2d.beginPath();
				g2d.arc(p.x, p.y, Math.max(0.5, radius), 0, Math.PI * 2);
				g2d.fillStyle = grad;
				g2d.fill();
			}
		}

		function step() {
			for (const p of particles) {
				// Free two-frequency Lissajous drift around the home anchor.
				p.px += p.ps;
				p.py += p.ps * 0.85;
				const driftX = Math.cos(p.px * p.fx) * p.amp;
				const driftY = Math.sin(p.py * p.fy) * p.amp;

				const springK = holding ? SPRING * 0.15 : SPRING;
				p.vx += ((p.hx + driftX) - p.x) * springK;
				p.vy += ((p.hy + driftY) - p.y) * springK;

				if (inside) {
					const dx = p.x - mx;
					const dy = p.y - my;
					const dist = Math.hypot(dx, dy) || 0.001;

					if (holding) {
						const grav = Math.log(1 + dist) * 0.22;
						p.vx -= (dx / dist) * grav;
						p.vy -= (dy / dist) * grav;
					} else if (dist < REPEL_R) {
						const f = (1 - dist / REPEL_R) * 3.2;
						p.vx += (dx / dist) * f;
						p.vy += (dy / dist) * f;
					}
				}

				p.vx *= holding ? 0.9 : DAMP;
				p.vy *= holding ? 0.9 : DAMP;
				p.x += p.vx;
				p.y += p.vy;
			}
			draw();
		}

		let raf = 0;
		let running = false;
		function loop() {
			step();
			raf = requestAnimationFrame(loop);
		}
		function startLoop() {
			if (running || reduce) return;
			running = true;
			loop();
		}
		function stopLoop() {
			running = false;
			cancelAnimationFrame(raf);
		}

		function onScroll() {
			const top = scroller ? scroller.scrollTop : globalThis.scrollY;
			const fade = Math.min(1, Math.max(0, 1 - top / (h * 0.9)));
			canvas.style.opacity = String(fade);
			if (fade <= 0.01) stopLoop();
			else startLoop();
		}

		function toLocal(e: PointerEvent) {
			const rect = canvas.getBoundingClientRect();
			mx = e.clientX - rect.left;
			my = e.clientY - rect.top;
			inside = mx >= 0 && my >= 0 && mx <= w && my <= h;
		}
		const onMove = (e: PointerEvent) => toLocal(e);
		const onDown = (e: PointerEvent) => {
			toLocal(e);
			if (inside && !(e.target as HTMLElement)?.closest("a, button, input")) holding = true;
		};
		const onUp = () => {
			holding = false;
		};

		const ro = new ResizeObserver(() => {
			build();
			if (reduce) draw();
		});
		ro.observe(hostEl);

		const themeObserver = new MutationObserver(recolor);
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});

		build();
		onScroll();
		if (reduce) draw();
		else startLoop();

		globalThis.addEventListener("pointermove", onMove, { passive: true });
		globalThis.addEventListener("pointerdown", onDown, { passive: true });
		globalThis.addEventListener("pointerup", onUp, { passive: true });
		(scroller ?? globalThis).addEventListener("scroll", onScroll, { passive: true });

		return () => {
			stopLoop();
			ro.disconnect();
			themeObserver.disconnect();
			globalThis.removeEventListener("pointermove", onMove);
			globalThis.removeEventListener("pointerdown", onDown);
			globalThis.removeEventListener("pointerup", onUp);
			(scroller ?? globalThis).removeEventListener("scroll", onScroll);
		};
	}, []);

	return <canvas ref={canvasRef} class="lp-hero__canvas" aria-hidden="true" />;
}
