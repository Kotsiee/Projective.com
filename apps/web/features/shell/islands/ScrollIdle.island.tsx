import { useEffect } from "preact/hooks";

/** Idle grace period (ms) after the last scroll tick before the thumb fades back out. */
const IDLE_MS = 700;
/** Marker the global self-hiding scrollbar CSS reveals on (`packages/ui/styles/index.css`). */
const ATTR = "data-ui-scrolling";

/**
 * ScrollIdle — global scroll-activated scrollbar reveal (behaviour-only island; renders nothing).
 *
 * The self-hiding custom scrollbar in `@projective/ui/styles` keeps every INNER scroll container's
 * thumb invisible at rest and reveals it on `:hover`. Pure CSS has no "is-scrolling" selector, so this
 * island supplies the scroll-driven half: a single capture-phase `scroll` listener on `document`
 * (scroll doesn't bubble, but capture reaches the document for any descendant) stamps the element that
 * actually scrolled with `data-ui-scrolling`, which the CSS reveals exactly like `:hover`; a per-element
 * idle timer clears it {@link IDLE_MS} after the last tick so the thumb fades back out.
 *
 * The MAIN WINDOW is deliberately excluded — a document/window scroll targets `document` (not an
 * `Element`), so it is skipped and the native window scrollbar keeps standard browser behaviour, exactly
 * as the CSS's `:not(html):not(body)` scope intends. Mounted once in `_app.tsx` so it covers every guest
 * and authenticated route. Consumers of `@projective/ui` that omit this island degrade gracefully to the
 * hover-only reveal.
 */
export default function ScrollIdle(): null {
	useEffect(() => {
		const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

		const clear = (el: Element) => {
			el.removeAttribute(ATTR);
			timers.delete(el);
		};

		const onScroll = (e: Event) => {
			const el = e.target;
			// Window/document scroll targets `document`, not an Element → left to native behaviour.
			if (!(el instanceof Element) || el === document.documentElement || el === document.body) {
				return;
			}
			el.setAttribute(ATTR, "");
			const prev = timers.get(el);
			if (prev !== undefined) clearTimeout(prev);
			timers.set(el, setTimeout(() => clear(el), IDLE_MS));
		};

		document.addEventListener("scroll", onScroll, { capture: true, passive: true });
		return () => document.removeEventListener("scroll", onScroll, { capture: true });
	}, []);

	return null;
}
