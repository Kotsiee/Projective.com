import { type ReadonlySignal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { motionAllowed } from "../core/hero-motion.ts";

// #region Hook
/** `prefers-reduced-motion`, the OS channel (the in-app one is `:root[data-motion]`). */
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether either reduced-motion channel is on — the OS setting or the app's
 * `:root[data-motion="reduced"]` overlay ({@link motionAllowed}) — read once hydrated and kept live:
 * the media query's changes and the `data-motion` attribute are both watched, so a visitor who
 * flips either mid-visit is honoured without a reload. `false` until hydration (the server cannot
 * know). One hook for every landing island that hands a demo its `reducedMotion` prop (`DemoHost`,
 * `FeatureDemoDialog`), so the two can never answer differently.
 */
export function useReducedMotion(): ReadonlySignal<boolean> {
	const reduced = useSignal(false);
	useEffect(() => {
		const query = globalThis.matchMedia(REDUCED_QUERY);
		const sync = () => (reduced.value = !motionAllowed());
		sync();
		query.addEventListener("change", sync);
		const observer = new MutationObserver(sync);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-motion"],
		});
		return () => {
			query.removeEventListener("change", sync);
			observer.disconnect();
		};
	}, []);
	return reduced;
}
// #endregion
