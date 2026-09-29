import {
	chooseRestTarget,
	glideDurationMs,
	glidePosition,
	type PointerSample,
	recentSamples,
	releaseVelocity,
	SETTLE_EPSILON_PX,
} from "./scroll-momentum.ts";

// #region Tuning
/** A press becomes a drag (and stops being a click) once it travels further than this (px). */
const DRAG_THRESHOLD_PX = 5;
/** Pressing a glide that still has this far (px) to go stops it, and that press is not a click. */
const TAP_TO_STOP_PX = 8;
/** Extra time (ms) the frame watchdog allows beyond the glide's own settle time. */
const WATCHDOG_GRACE_MS = 250;
// #endregion

/** A live glide's cancel function, per track, so {@link pageScroll} can end one before paging. */
const activeGlides = new WeakMap<HTMLElement, (settle: boolean) => void>();

/** Whether the viewer asked for no motion, through either the media query or `data-motion`. */
function reducedMotion(): boolean {
	if (typeof document !== "undefined" && document.documentElement.dataset.motion === "reduced") {
		return true;
	}
	return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

// #region Geometry
/** The track's scroll range; a right-to-left track scrolls through negative `scrollLeft`. */
function scrollRange(el: HTMLElement, rtl: boolean): { min: number; max: number } {
	const extent = Math.max(0, el.scrollWidth - el.clientWidth);
	return rtl ? { min: -extent, max: 0 } : { min: 0, max: extent };
}

/**
 * The `scrollLeft` values at which a child sits on its `scroll-snap-align` line, computed against
 * the same snapport the browser uses (the scroll viewport inset by `scroll-padding`), so the glide
 * lands exactly where native snapping would put it.
 */
function snapPositions(el: HTMLElement, rtl: boolean): number[] {
	const cs = getComputedStyle(el);
	const box = el.getBoundingClientRect();
	const padStart = parseFloat(cs.scrollPaddingInlineStart) || 0;
	const padEnd = parseFloat(cs.scrollPaddingInlineEnd) || 0;
	const left = box.left + el.clientLeft + (rtl ? padEnd : padStart);
	const right = box.left + el.clientLeft + el.clientWidth - (rtl ? padStart : padEnd);

	const positions: number[] = [];
	for (const child of Array.from(el.children)) {
		if (!(child instanceof HTMLElement) || child.getClientRects().length === 0) continue;
		const align = getComputedStyle(child).scrollSnapAlign.trim().split(/\s+/).pop();
		if (!align || align === "none") continue;
		const r = child.getBoundingClientRect();
		const delta = align === "center"
			? (r.left + r.right) / 2 - (left + right) / 2
			: (align === "start") !== rtl
			? r.left - left
			: r.right - right;
		positions.push(el.scrollLeft + delta);
	}
	return positions;
}
// #endregion

/**
 * Pointer drag-to-scroll with an inertial release, for a native `overflow-x` track.
 *
 * A mouse drag pans the track 1:1; letting go hands it to a glide that leaves at the release speed
 * and decelerates smoothly to rest (see `scroll-momentum.ts` for the curve). Wheel, keyboard and touch
 * scrolling stay native — touch already has the platform's own momentum — so this engages only for
 * mouse drags.
 *
 * ## Why snapping stays off for the whole glide
 *
 * The track carries `scroll-snap-type`, and a snap container answers a programmatic `scrollLeft`
 * write by snapping. So the `is-dragging` class that switches snapping off for the pan is followed by
 * `is-gliding` for the fling, and snapping only returns once the glide has settled — ON a snap
 * position, so its return moves nothing. Dropping the override at release is what made the old fling
 * stop dead: its very first frame was snapped away.
 *
 * ## Clicks
 *
 * A press that travels more than {@link DRAG_THRESHOLD_PX} is a drag, and the click that follows it
 * is swallowed so a fling never opens a card. Pressing a track that is still gliding stops it, and
 * that press is not a click either — the reader was catching the track, not choosing a card. Native
 * HTML drag is cancelled inside the track: every card is a link, and a link drag would otherwise
 * steal the gesture after a few pixels.
 *
 * The glide never depends on a frame arriving. `requestAnimationFrame` does not fire in a hidden
 * tab, so a watchdog timer lands the track on its target if the frames stop. Returns a disposer.
 */
export function attachDragScroll(el: HTMLElement): () => void {
	let down = false;
	let moved = false;
	let stopTap = false;
	let startX = 0;
	let startScroll = 0;
	let samples: PointerSample[] = [];
	let snaps = getComputedStyle(el).scrollSnapType !== "none";
	let caught = false;

	let raf = 0;
	let watchdog: ReturnType<typeof setTimeout> | undefined;
	let glideTarget: number | null = null;
	let lastWritten = 0;

	function stopFrames() {
		cancelAnimationFrame(raf);
		clearTimeout(watchdog);
		glideTarget = null;
		activeGlides.delete(el);
	}

	function endGlide(settle: boolean) {
		if (glideTarget === null) return;
		const target = glideTarget;
		stopFrames();
		if (settle) el.scrollLeft = target;
		el.classList.remove("is-gliding");
	}

	function glideTo(target: number) {
		const from = el.scrollLeft;
		if (Math.abs(target - from) <= SETTLE_EPSILON_PX || reducedMotion()) {
			el.scrollLeft = target;
			el.classList.remove("is-gliding");
			return;
		}
		glideTarget = target;
		el.classList.add("is-gliding");
		activeGlides.set(el, endGlide);
		const start = performance.now();
		lastWritten = from;

		const frame = (now: number) => {
			if (glideTarget === null) return;
			// A scroll the glide did not write (focus moving to an off-screen card, find-in-page) wins.
			if (Math.abs(el.scrollLeft - lastWritten) > 2) {
				endGlide(false);
				return;
			}
			const x = glidePosition(from, target, now - start);
			if (Math.abs(target - x) <= SETTLE_EPSILON_PX) {
				endGlide(true);
				return;
			}
			el.scrollLeft = x;
			lastWritten = el.scrollLeft;
			raf = requestAnimationFrame(frame);
		};
		raf = requestAnimationFrame(frame);
		watchdog = setTimeout(() => endGlide(true), glideDurationMs(target - from) + WATCHDOG_GRACE_MS);
	}

	/**
	 * Aim the track at its resting position and glide there. Callers keep `is-dragging` or
	 * `is-gliding` on while this measures: reading layout with snapping back on would let the browser
	 * snap the track before the glide has begun.
	 *
	 * Under reduced motion the throw is ignored: with no glide to show the journey, honouring it would
	 * teleport the track past where the reader let go. It settles on the nearest resting position.
	 */
	function settle(velocity: number) {
		const rtl = getComputedStyle(el).direction === "rtl";
		const { min, max } = scrollRange(el, rtl);
		glideTo(chooseRestTarget({
			position: el.scrollLeft,
			velocity: reducedMotion() ? 0 : velocity,
			points: snaps ? snapPositions(el, rtl) : [],
			min,
			max,
		}));
	}

	function onDown(e: PointerEvent) {
		const primaryMouse = e.pointerType === "mouse" && e.button === 0;
		if (glideTarget !== null) {
			stopTap = Math.abs(glideTarget - el.scrollLeft) > TAP_TO_STOP_PX;
			// A mouse that catches the track holds it where it is — `is-gliding` stays on, so snapping
			// cannot pull it away under the pointer — and it settles when the button comes up.
			if (primaryMouse) {
				stopFrames();
				caught = true;
			} else {
				endGlide(false);
			}
		}
		if (!primaryMouse) return;
		if (!caught) snaps = getComputedStyle(el).scrollSnapType !== "none";
		down = true;
		moved = false;
		startX = e.clientX;
		startScroll = el.scrollLeft;
		samples = [{ t: e.timeStamp, x: e.clientX }];
	}

	function onMove(e: PointerEvent) {
		if (!down) return;
		const dx = e.clientX - startX;
		if (!moved && Math.abs(dx) > DRAG_THRESHOLD_PX) {
			moved = true;
			el.classList.add("is-dragging");
			globalThis.getSelection?.()?.removeAllRanges();
		}
		samples.push({ t: e.timeStamp, x: e.clientX });
		samples = recentSamples(samples, e.timeStamp);
		if (!moved) return;
		e.preventDefault();
		el.scrollLeft = startScroll - dx;
	}

	function onUp(e: PointerEvent) {
		// The click that follows this release is dispatched before a zero-delay timer runs, so these
		// flags survive exactly long enough to swallow it — and no longer, so a later keyboard
		// activation of a card is never mistaken for the tail of a drag.
		setTimeout(() => {
			moved = false;
			stopTap = false;
		}, 0);
		if (!down) return;
		down = false;
		const wasCaught = caught;
		caught = false;
		if (!moved) {
			if (wasCaught) settle(0);
			return;
		}

		const velocity = -releaseVelocity(samples, e.timeStamp);
		samples = [];
		// `settle` either lands the track at once or stamps `is-gliding`; in both cases snapping is
		// still off when `is-dragging` comes away, so there is no frame in which it can intervene.
		settle(velocity);
		el.classList.remove("is-dragging");
	}

	function onCancel() {
		if (!down) return;
		down = false;
		moved = false;
		samples = [];
		if (caught) {
			caught = false;
			settle(0);
		}
		el.classList.remove("is-dragging");
	}

	function onClick(e: MouseEvent) {
		if (moved || stopTap) {
			e.preventDefault();
			e.stopPropagation();
		}
	}

	const onDragStart = (e: DragEvent) => e.preventDefault();
	const onInterrupt = () => endGlide(false);
	const onHidden = () => {
		if (document.hidden) endGlide(true);
	};

	el.addEventListener("pointerdown", onDown);
	el.addEventListener("click", onClick, true);
	el.addEventListener("dragstart", onDragStart);
	el.addEventListener("wheel", onInterrupt, { passive: true });
	el.addEventListener("keydown", onInterrupt);
	globalThis.addEventListener("pointermove", onMove, { passive: false });
	globalThis.addEventListener("pointerup", onUp);
	globalThis.addEventListener("pointercancel", onCancel);
	globalThis.addEventListener("blur", onCancel);
	document.addEventListener("visibilitychange", onHidden);

	return () => {
		stopFrames();
		el.classList.remove("is-dragging", "is-gliding");
		el.removeEventListener("pointerdown", onDown);
		el.removeEventListener("click", onClick, true);
		el.removeEventListener("dragstart", onDragStart);
		el.removeEventListener("wheel", onInterrupt);
		el.removeEventListener("keydown", onInterrupt);
		globalThis.removeEventListener("pointermove", onMove);
		globalThis.removeEventListener("pointerup", onUp);
		globalThis.removeEventListener("pointercancel", onCancel);
		globalThis.removeEventListener("blur", onCancel);
		document.removeEventListener("visibilitychange", onHidden);
	};
}

/** Scroll a track by roughly one viewport-width page in the given direction, ending any glide first. */
export function pageScroll(el: HTMLElement, dir: 1 | -1): void {
	activeGlides.get(el)?.(false);
	el.scrollBy({ left: dir * el.clientWidth * 0.82, behavior: reducedMotion() ? "auto" : "smooth" });
}
