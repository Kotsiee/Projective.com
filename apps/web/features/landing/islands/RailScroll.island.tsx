/// <reference lib="dom" />
import "../styles/lp-ways.css";
import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";

// #region Rail wiring
/** Both reduced-motion channels: the OS preference and the app's `data-motion="reduced"` overlay. */
function motionReduced(): boolean {
	return document.documentElement.dataset.motion === "reduced" ||
		globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** A length in pixels from a computed style value (`"24px"` → 24). */
function px(value: string): number {
	const n = Number.parseFloat(value);
	return Number.isFinite(n) ? n : 0;
}

/**
 * Wires one server-rendered rail: its scroller reports whether it overflows and which end it is
 * at (the stylesheet shows the buttons and the leading fade from that), and its two buttons move it
 * a column's width at a time, snapping to a card. Returns the teardown.
 */
function wireRail(rail: HTMLElement): () => void {
	const track = rail.querySelector<HTMLElement>(".lp-rail__track");
	const steps = Array.from(rail.querySelectorAll<HTMLButtonElement>("[data-rail-step]"));
	if (!track) return () => {};

	let frame = 0;
	const measure = () => {
		frame = 0;
		const max = track.scrollWidth - track.clientWidth;
		const atStart = track.scrollLeft <= 1;
		const atEnd = track.scrollLeft >= max - 1;
		rail.toggleAttribute("data-rail-overflow", max > 1);
		track.dataset.atStart = String(atStart);
		track.dataset.atEnd = String(atEnd);
		for (const step of steps) {
			const back = step.dataset.railStep === "-1";
			step.setAttribute("aria-disabled", String(back ? atStart : atEnd));
		}
	};
	const schedule = () => {
		if (frame === 0) frame = requestAnimationFrame(measure);
	};

	const onStep = (event: MouseEvent) => {
		const step = event.currentTarget as HTMLButtonElement;
		if (step.getAttribute("aria-disabled") === "true") return;
		const style = getComputedStyle(track);
		const column = track.clientWidth - px(style.paddingInlineStart) - px(style.paddingInlineEnd);
		track.scrollBy({
			left: Number(step.dataset.railStep) * Math.max(column, track.clientWidth / 2),
			behavior: motionReduced() ? "auto" : "smooth",
		});
	};

	track.addEventListener("scroll", schedule, { passive: true });
	for (const step of steps) step.addEventListener("click", onStep);
	const resize = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
	resize?.observe(track);
	measure();
	rail.toggleAttribute("data-rail-ready", true);

	return () => {
		if (frame !== 0) cancelAnimationFrame(frame);
		track.removeEventListener("scroll", schedule);
		for (const step of steps) step.removeEventListener("click", onStep);
		resize?.disconnect();
		rail.toggleAttribute("data-rail-ready", false);
	};
}
// #endregion

// #region Picture fallback
/**
 * Marks the section's pictures that fail to load (`data-failed`, and on a card's picture frame
 * too), so the stylesheet hides them and the frame shows its initials. A picture that failed before
 * hydration is read from the element (`complete` without a `naturalWidth`), as the app's image
 * watcher does; later ones arrive as `error` events, captured once for the whole section.
 */
function watchPictures(section: HTMLElement): () => void {
	const fail = (img: HTMLImageElement) => {
		img.toggleAttribute("data-failed", true);
		img.closest(".lp-rail-card__cover")?.toggleAttribute("data-failed", true);
	};
	for (const img of Array.from(section.querySelectorAll("img"))) {
		if (img.complete && img.naturalWidth === 0) fail(img);
	}
	const onError = (event: Event) => {
		if (event.target instanceof HTMLImageElement) fail(event.target);
	};
	section.addEventListener("error", onError, true);
	return () => section.removeEventListener("error", onError, true);
}
// #endregion

// #region Component
/**
 * RailScroll — the "Ways to work" section's small client half (`flows/LANDING.md` §4.5, §2.3 note
 * 14). It renders nothing visible and never re-renders the server's rails: it finds the section it
 * sits in and wires each rail's scroller and its two scroll buttons ("Scroll {title} back" /
 * "forward"), which the server renders and the stylesheet shows only for a fine pointer, once wired
 * and while the rail overflows. A click moves the rail by the content column's width and the
 * scroller's snap lands it on a card; the scroll is instant under either reduced-motion channel.
 * Touch and keyboard need none of this: the scroller is a native one and every card is a link. It
 * also marks any picture that fails to load, so its frame shows the owner's initials instead.
 *
 * It is mounted whether or not any rail renders, because it also carries the section's stylesheet:
 * a stylesheet imported by a server component never reaches the page.
 */
export default function RailScroll(): JSX.Element {
	const anchor = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		const section = anchor.current?.closest<HTMLElement>(".lp-ways");
		if (!section) return;
		const teardowns = [
			watchPictures(section),
			...Array.from(section.querySelectorAll<HTMLElement>(".lp-rail")).map(wireRail),
		];
		return () => teardowns.forEach((teardown) => teardown());
	}, []);

	return <span ref={anchor} class="lp-ways__anchor" hidden />;
}
// #endregion
