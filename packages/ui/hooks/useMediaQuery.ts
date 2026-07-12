/**
 * `useMediaQuery` — reactive `matchMedia`. Returns whether `query` currently matches, updating on
 * change. Client-only (islands); on the server it returns `false` until hydration. Drives the
 * desktop/mobile gate (modal→bottom-sheet at `--bp-md`, DESIGN_SYSTEM.md Part D.3).
 */
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

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

/** Convenience: true below the modal→sheet breakpoint (`--bp-md`, 768px). */
export function useIsMobile(): boolean {
	return useMediaQuery("(max-width: 767.98px)");
}
