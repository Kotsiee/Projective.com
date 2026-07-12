import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

/**
 * Reactive `matchMedia` — returns whether `query` currently matches, updating on change. Client-only
 * (islands); on the server it returns `false` until hydration. Used for the desktop/mobile gate
 * (DESIGN_SYSTEM.md Part D.3).
 */
export function useMediaQuery(query: string): boolean {
	const matches = useSignal(false);
	useEffect(() => {
		if (typeof globalThis.matchMedia !== "function") return;
		const mql = globalThis.matchMedia(query);
		matches.value = mql.matches;
		const onChange = (e: MediaQueryListEvent) => (matches.value = e.matches);
		mql.addEventListener("change", onChange);
		return () => mql.removeEventListener("change", onChange);
	}, [query]);
	return matches.value;
}
