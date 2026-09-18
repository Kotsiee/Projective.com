import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { dsConfig } from "@projective/ui/system";

/**
 * Whether the viewer asked for no motion, through EITHER channel: the OS media query
 * (`prefers-reduced-motion: reduce`) or the in-app toggle (`dsConfig.reducedMotion`, which the
 * theme engine also mirrors onto `<html data-motion="reduced">`). Resolved on the client after
 * hydration — the server cannot know — and kept live, so a viewer who flips the OS setting mid-visit
 * is honoured without a reload.
 *
 * One hook for every profile island that decides whether media moves on its own (the hero's
 * showcase carousel, a portfolio video tile), so the two cannot answer the question differently.
 */
export function useReducedMotion(): boolean {
	const env = useSignal(false);

	useEffect(() => {
		const mql = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
		const sync = () => {
			env.value = (mql?.matches ?? false) ||
				document.documentElement.dataset.motion === "reduced";
		};
		sync();
		mql?.addEventListener("change", sync);
		return () => mql?.removeEventListener("change", sync);
	}, []);

	return env.value || dsConfig.value.reducedMotion;
}
