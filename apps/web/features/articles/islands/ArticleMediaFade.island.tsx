import { useEffect } from "preact/hooks";
import "@ui/fields/styles/button.css";
import "../styles/articles.css";

/**
 * The images an article page lazy-loads: the tiles' covers (marked `data-artl-fade` by the server)
 * and the figures inside an article's prose.
 */
const FADE_SELECTOR = "img[data-artl-fade], .ui-doc--article .ui-prose__img";

/** Whether the reader asked for less motion through either channel (the OS, or the a11y overlay). */
function motionReduced(): boolean {
	return document.documentElement.dataset.motion === "reduced" ||
		globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * ArticleMediaFade — the articles surface's island (P6). It renders nothing. It does two jobs:
 *
 * 1. **Carries the surface's stylesheet.** Every article component is server-rendered, and a server
 *    component's own CSS import reaches no page, so `articles.css` (and the Button sheet the call to
 *    action and the pager use) ride this island. Both routes mount it on every state they render —
 *    the index with or without results, and the reader.
 * 2. **Fades lazy images in.** An image that has not finished loading when the page wakes is marked
 *    `pending` (transparent) and revealed at `--dur-medium` once it loads or fails. It only ever
 *    hides an image that is not yet painted; the cover the page leads with is loaded eagerly and is
 *    never marked, so the largest paint is not delayed. Under either reduced-motion channel nothing
 *    is marked and the CSS has no transition, so images simply appear. Without JavaScript nothing is
 *    hidden at all.
 */
export default function ArticleMediaFade(): null {
	useEffect(() => {
		if (motionReduced()) return;
		const cleanups: Array<() => void> = [];
		for (const img of document.querySelectorAll<HTMLImageElement>(FADE_SELECTOR)) {
			if (img.complete || img.loading === "eager" || img.fetchPriority === "high") continue;
			img.dataset.artlFade = "pending";
			const reveal = () => {
				img.dataset.artlFade = "in";
				img.removeEventListener("load", reveal);
				img.removeEventListener("error", reveal);
			};
			img.addEventListener("load", reveal);
			img.addEventListener("error", reveal);
			cleanups.push(reveal);
		}
		return () => cleanups.forEach((reveal) => reveal());
	}, []);
	return null;
}
