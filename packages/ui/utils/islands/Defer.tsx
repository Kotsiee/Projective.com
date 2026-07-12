import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { cx } from "../../core/cx.ts";
import { useIntersectionObserver } from "../../hooks/useIntersectionObserver.ts";

// #region Props
/** Props for {@link Defer}. */
export interface DeferProps {
	/** Margin grown around the root when computing intersection (e.g. `"200px"` to prefetch early). */
	rootMargin?: string;
	/** Fraction of the sentinel that must be visible to trigger (default `0`). */
	threshold?: number;
	/** Placeholder rendered before the children become visible (reserves layout space). */
	fallback?: ComponentChildren;
	/** Fired once, the first time the children are revealed. */
	onLoad?: () => void;
	/** The deferred content, mounted once when scrolled into view. */
	children?: ComponentChildren;
	class?: string;
}
// #endregion

/**
 * Defer — mounts its children lazily the first time the wrapper scrolls into the viewport, via
 * {@link useIntersectionObserver} (one-shot). Until then it renders `fallback` (or nothing),
 * reserving layout via the sentinel wrapper. Fires `onLoad` once on reveal. Useful for below-the-fold
 * charts, media and heavy islands. SSR renders the fallback; the real content hydrates on scroll.
 */
export function Defer(props: DeferProps): JSX.Element {
	const { rootMargin = "0px", threshold = 0, fallback, onLoad, children, class: className } = props;
	const ref = useRef<HTMLDivElement>(null);
	const { hasBeenVisible } = useIntersectionObserver({
		targetRef: ref,
		rootMargin,
		threshold,
		once: true,
	});

	const loaded = hasBeenVisible.value;
	const firedRef = useRef(false);
	useEffect(() => {
		if (loaded && !firedRef.current) {
			firedRef.current = true;
			onLoad?.();
		}
	}, [loaded]);

	return (
		<div ref={ref} class={cx("ui-defer", className)}>
			{loaded ? children : fallback}
		</div>
	);
}
