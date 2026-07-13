import { useEffect } from "preact/hooks";

/**
 * MagneticField — one global "elastic magnetism" engine for every `[data-magnetic]` element.
 *
 * A single window `pointermove` listener drives a spring loop: elements within reach of the cursor
 * warp toward it (translate + subtle scale) and snap back elastically when it leaves. One island +
 * one rAF loop (that idles when everything is at rest) instead of a listener per button — cheap and
 * GPU-only (`transform`). Honours reduced-motion by doing nothing (jump-to-final = no motion).
 *
 * Mark any CTA/button/tag with `data-magnetic` to opt in. `data-magnetic-strength` (0–1) and
 * `data-magnetic-radius` (px) tune individual pull.
 */
interface MagItem {
	el: HTMLElement;
	strength: number;
	radius: number;
	curX: number;
	curY: number;
	tgtX: number;
	tgtY: number;
	curS: number;
	tgtS: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export default function MagneticField() {
	useEffect(() => {
		const mq = (q: string) => globalThis.matchMedia?.(q).matches ?? false;
		const reduce = mq("(prefers-reduced-motion: reduce)");
		// Elastic magnetism is a desktop-mouse affordance only. On touch/coarse-pointer devices (no true
		// hover) or narrow mobile widths it reads as jarring, unpredictable jumps, so the whole engine
		// no-ops there — pointer listeners are never attached and elements keep their natural position.
		const desktopPointer = mq("(hover: hover) and (pointer: fine)");
		const mobileWidth = mq("(max-width: 767px)");
		if (reduce || !desktopPointer || mobileWidth) return;

		const MAX_T = 26;
		let items: MagItem[] = [];

		function collect() {
			const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-magnetic]"));
			// Preserve in-flight spring state for elements we already track.
			const prev = new Map(items.map((it) => [it.el, it]));
			items = nodes.map((el) => {
				const existing = prev.get(el);
				if (existing) return existing;
				return {
					el,
					strength: parseFloat(el.dataset.magneticStrength ?? "") || 0.35,
					radius: parseFloat(el.dataset.magneticRadius ?? "") || 90,
					curX: 0,
					curY: 0,
					tgtX: 0,
					tgtY: 0,
					curS: 1,
					tgtS: 1,
				};
			});
		}

		let mouseX = -99999;
		let mouseY = -99999;
		let raf = 0;
		let running = false;

		function tick() {
			let active = false;

			// Mutual exclusion — only the SINGLE nearest element within reach is magnetised. Every
			// other element immediately targets its home anchor, so sliding the cursor from one button
			// straight onto another snaps the first back to (0,0) instead of leaving it warped/stuck.
			const rects = items.map((it) => it.el.getBoundingClientRect());
			let bestIdx = -1;
			let bestScore = Infinity;
			for (let i = 0; i < items.length; i++) {
				const r = rects[i];
				const dist = Math.hypot(mouseX - (r.left + r.width / 2), mouseY - (r.top + r.height / 2));
				const reach = Math.max(r.width, r.height) / 2 + items[i].radius;
				if (dist < reach) {
					const score = dist / reach; // normalized proximity — smallest wins
					if (score < bestScore) {
						bestScore = score;
						bestIdx = i;
					}
				}
			}

			for (let i = 0; i < items.length; i++) {
				const it = items[i];
				if (i === bestIdx) {
					const r = rects[i];
					const dx = mouseX - (r.left + r.width / 2);
					const dy = mouseY - (r.top + r.height / 2);
					const reach = Math.max(r.width, r.height) / 2 + it.radius;
					const falloff = 1 - Math.hypot(dx, dy) / reach;
					it.tgtX = clamp(dx * it.strength, -MAX_T, MAX_T) * falloff;
					it.tgtY = clamp(dy * it.strength, -MAX_T, MAX_T) * falloff;
					it.tgtS = 1 + 0.05 * falloff;
				} else {
					it.tgtX = 0;
					it.tgtY = 0;
					it.tgtS = 1;
				}

				// Over-damped spring toward target (no overshoot, DESIGN_SYSTEM.md §B.4 motion).
				it.curX += (it.tgtX - it.curX) * 0.18;
				it.curY += (it.tgtY - it.curY) * 0.18;
				it.curS += (it.tgtS - it.curS) * 0.18;

				const settled = Math.abs(it.curX) < 0.05 && Math.abs(it.curY) < 0.05 &&
					Math.abs(it.curS - 1) < 0.002 && it.tgtX === 0 && it.tgtY === 0;
				if (settled) {
					if (it.el.style.transform) it.el.style.transform = "";
					it.curX = 0;
					it.curY = 0;
					it.curS = 1;
				} else {
					it.el.style.transform = `translate(${it.curX.toFixed(2)}px, ${
						it.curY.toFixed(2)
					}px) scale(${it.curS.toFixed(3)})`;
					active = true;
				}
			}
			if (active) raf = requestAnimationFrame(tick);
			else running = false;
		}

		function start() {
			if (!running) {
				running = true;
				raf = requestAnimationFrame(tick);
			}
		}

		const onMove = (e: PointerEvent) => {
			mouseX = e.clientX;
			mouseY = e.clientY;
			start();
		};

		collect();
		// Re-collect once after hydration settles (late islands add magnetic nodes), and on resize.
		const settle = setTimeout(collect, 600);
		const onResize = () => {
			collect();
			start();
		};

		globalThis.addEventListener("pointermove", onMove, { passive: true });
		globalThis.addEventListener("scroll", start, { passive: true });
		globalThis.addEventListener("resize", onResize, { passive: true });

		return () => {
			cancelAnimationFrame(raf);
			clearTimeout(settle);
			globalThis.removeEventListener("pointermove", onMove);
			globalThis.removeEventListener("scroll", start);
			globalThis.removeEventListener("resize", onResize);
			for (const it of items) it.el.style.transform = "";
		};
	}, []);

	return <span hidden aria-hidden="true" data-magnetic-field />;
}
