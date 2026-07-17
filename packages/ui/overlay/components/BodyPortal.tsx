import type { ComponentChildren } from "preact";
import { Fragment, h, render } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

// #region Props
/** Props for {@link BodyPortal}. */
export interface BodyPortalProps {
	/** Content projected into a detached container appended to `document.body`. */
	children: ComponentChildren;
}
// #endregion

/**
 * BodyPortal — a **real** DOM portal that projects its children into a container appended directly to
 * `document.body`, escaping every ancestor's stacking, `overflow`, and — crucially — any `transform`
 * / `filter` / `backdrop-filter` that would otherwise re-base a descendant's `position: fixed` onto
 * that ancestor's box instead of the viewport (the "glass-blur fixed-overlay trap").
 *
 * This is the deliberate exception to the package's usual non-DOM `Portal` (which stays in the tree
 * and only relies on a z-index token): a fixed-layer that *stays* in the tree cannot escape a
 * transformed ancestor, so anchored micro-popups (Tooltip) that may live inside a transformed
 * Popover must genuinely leave the subtree. Built on Preact core's imperative `render` — no
 * `preact/compat`, so the package stays dependency-light and copy-paste-portable.
 *
 * SSR-safe: with no `document` it renders nothing (transient hover surfaces are client-only anyway).
 * On unmount the projected subtree is unmounted (`render(null, …)`, running its cleanups) and the
 * container element is removed, leaving no orphaned nodes.
 */
export function BodyPortal(props: BodyPortalProps): null {
	const containerRef = useRef<HTMLDivElement | null>(null);

	// Lazily create the host container once, on the client only.
	if (containerRef.current === null && typeof document !== "undefined") {
		containerRef.current = document.createElement("div");
		containerRef.current.setAttribute("data-ui-portal", "");
	}

	// Attach on mount; unmount the subtree and detach on cleanup (no memory leak, no orphan node).
	useLayoutEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		document.body.appendChild(el);
		return () => {
			render(null, el);
			el.remove();
		};
	}, []);

	// Keep the projected subtree in sync with the latest children on every render.
	useLayoutEffect(() => {
		const el = containerRef.current;
		if (el) render(h(Fragment, null, props.children), el);
	});

	return null;
}
