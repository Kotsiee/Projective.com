/**
 * Pointer drag-to-scroll for horizontal carousel tracks.
 *
 * Turns a native overflow-x container into a grab-and-fling surface: pointer drag pans the track,
 * release imparts velocity-based momentum that eases out (over-damped, no rubber-band overshoot —
 * DESIGN_SYSTEM.md §B.4 motion). Wheel and keyboard scrolling stay native; touch devices keep their
 * native momentum, so this only engages for fine-pointer (mouse) drags. Returns a disposer.
 */
export function attachDragScroll(el: HTMLElement): () => void {
	let down = false;
	let moved = false;
	let startX = 0;
	let startScroll = 0;
	let lastX = 0;
	let lastT = 0;
	let velocity = 0;
	let raf = 0;

	const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

	function momentum() {
		el.scrollLeft += velocity;
		velocity *= 0.92;
		if (Math.abs(velocity) > 0.4) {
			raf = requestAnimationFrame(momentum);
		}
	}

	function onDown(e: PointerEvent) {
		if (e.pointerType !== "mouse") return;
		down = true;
		moved = false;
		startX = e.clientX;
		startScroll = el.scrollLeft;
		lastX = e.clientX;
		lastT = e.timeStamp;
		velocity = 0;
		cancelAnimationFrame(raf);
	}

	function onMove(e: PointerEvent) {
		if (!down) return;
		const dx = e.clientX - startX;
		if (Math.abs(dx) > 3) moved = true;
		el.scrollLeft = startScroll - dx;
		const dt = e.timeStamp - lastT || 16;
		velocity = -((e.clientX - lastX) / dt) * 16;
		lastX = e.clientX;
		lastT = e.timeStamp;
		if (moved) {
			el.classList.add("is-dragging");
			e.preventDefault();
		}
	}

	function onUp() {
		if (!down) return;
		down = false;
		el.classList.remove("is-dragging");
		if (!reduceMotion && Math.abs(velocity) > 0.4) momentum();
	}

	// Suppress the click that follows a drag so a fling never fires a card's navigation.
	function onClick(e: MouseEvent) {
		if (moved) {
			e.preventDefault();
			e.stopPropagation();
			moved = false;
		}
	}

	el.addEventListener("pointerdown", onDown);
	globalThis.addEventListener("pointermove", onMove, { passive: false });
	globalThis.addEventListener("pointerup", onUp);
	el.addEventListener("click", onClick, true);

	return () => {
		cancelAnimationFrame(raf);
		el.removeEventListener("pointerdown", onDown);
		globalThis.removeEventListener("pointermove", onMove);
		globalThis.removeEventListener("pointerup", onUp);
		el.removeEventListener("click", onClick, true);
	};
}

/** Scroll a track by roughly one viewport-width page in the given direction. */
export function pageScroll(el: HTMLElement, dir: 1 | -1): void {
	const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
	el.scrollBy({ left: dir * el.clientWidth * 0.82, behavior: reduce ? "auto" : "smooth" });
}
