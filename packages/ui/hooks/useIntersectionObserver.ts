/**
 * `useIntersectionObserver` — reactive viewport visibility for a single element. Powers Defer (render
 * children when scrolled into view), AnimateOnScroll (toggle enter/exit), infinite-scroll sentinels,
 * and lazy media. Returns a signal that flips when the target crosses `threshold`. Client-only; on the
 * server `visible` stays false until hydration. `once` disconnects after the first entry.
 */
import { useEffect, useMemo } from "preact/hooks";
import { signal } from "@preact/signals";
import type { Signal } from "@preact/signals";
import type { RefObject } from "preact";

export interface IntersectionOptions {
	targetRef: RefObject<HTMLElement>;
	root?: RefObject<HTMLElement>;
	rootMargin?: string;
	threshold?: number | number[];
	/** Stop observing after the first time it becomes visible (default false). */
	once?: boolean;
}

export interface IntersectionResult {
	/** Currently intersecting the root by at least `threshold`. */
	visible: Signal<boolean>;
	/** True once it has been visible at least once (useful for one-shot reveals). */
	hasBeenVisible: Signal<boolean>;
}

export function useIntersectionObserver(opts: IntersectionOptions): IntersectionResult {
	const { targetRef, root, rootMargin = "0px", threshold = 0, once = false } = opts;
	const visible = useMemo(() => signal(false), []);
	const hasBeenVisible = useMemo(() => signal(false), []);

	useEffect(() => {
		if (typeof IntersectionObserver === "undefined") return;
		const el = targetRef.current;
		if (!el) return;

		const io = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					visible.value = entry.isIntersecting;
					if (entry.isIntersecting) {
						hasBeenVisible.value = true;
						if (once) io.disconnect();
					}
				}
			},
			{ root: root?.current ?? null, rootMargin, threshold },
		);
		io.observe(el);
		return () => io.disconnect();
	}, [targetRef, root, rootMargin, JSON.stringify(threshold), once]);

	return { visible, hasBeenVisible };
}
