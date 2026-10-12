import { motionReduced } from "./view-transition.ts";

/** The `view-transition-name` shared by a card's media and the `/view` canvas stage. */
export const HERO_MORPH_NAME = "ex-hero-media";

const MEDIA_SELECTOR = ".ex-media, .ex-pcard__banner";

/** Strips the morph name from every element that carries it, so at most one ever does. */
function clearNames(): void {
	for (const el of document.querySelectorAll<HTMLElement>(`[data-hero-morph]`)) {
		el.style.removeProperty("view-transition-name");
		delete el.dataset.heroMorph;
	}
}

/**
 * Names the clicked card's media frame for the cross-document View Transition into its `/view`
 * hero. A no-op when motion is reduced or the card has no media frame.
 */
export function armHeroMorph(card: Element): void {
	clearNames();
	if (motionReduced()) return;
	const media = card.querySelector<HTMLElement>(MEDIA_SELECTOR);
	if (!media) return;
	media.style.setProperty("view-transition-name", HERO_MORPH_NAME);
	media.dataset.heroMorph = "";
}

interface PageSwapLike extends Event {
	viewTransition?: { skipTransition(): void } | null;
}

/**
 * Lets only an armed card navigation run the cross-document transition, and drops a stale name when
 * the page is restored from the back-forward cache. Returns the unbinder.
 */
export function bindHeroMorph(): () => void {
	const onSwap = (e: Event) => {
		const vt = (e as PageSwapLike).viewTransition;
		if (!vt) return;
		const armed = document.querySelector("[data-hero-morph]") !== null;
		if (!armed || motionReduced()) vt.skipTransition();
	};
	const onShow = () => clearNames();
	globalThis.addEventListener("pageswap", onSwap);
	globalThis.addEventListener("pageshow", onShow);
	return () => {
		globalThis.removeEventListener("pageswap", onSwap);
		globalThis.removeEventListener("pageshow", onShow);
	};
}
