/**
 * `usePresence` — mount/unmount presence with an exit grace period so overlays can play an exit
 * transition before leaving the DOM. Returns whether the node should be `mounted` and a `state`
 * (`"open"` | `"closed"`) that CSS drives its enter/exit transition from (via `[data-state]`). Enter
 * flips to `"open"` on the frame after mount so the transition runs; exit sets `"closed"` and unmounts
 * after `exitMs` (immediately when the user prefers reduced motion). Client-only.
 */
import { useEffect, useState } from "preact/hooks";

export type PresenceState = "open" | "closed";

export interface Presence {
	/** Whether the presence node should be rendered. */
	mounted: boolean;
	/** Transition state consumed by CSS `[data-state]` selectors. */
	state: PresenceState;
}

/** True when the user has requested reduced motion (SSR-safe). */
function prefersReducedMotion(): boolean {
	return typeof globalThis.matchMedia === "function" &&
		globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * @param open Whether the owner wants the node present.
 * @param exitMs Exit-transition duration before unmount (default 250ms, matches `--dur-medium`).
 */
export function usePresence(open: boolean, exitMs = 250): Presence {
	const [mounted, setMounted] = useState(open);
	const [state, setState] = useState<PresenceState>(open ? "open" : "closed");

	useEffect(() => {
		if (open) {
			setMounted(true);
			// Flip to "open" on the next frame so the mount→open transition actually runs.
			const raf = requestAnimationFrame(() => setState("open"));
			return () => cancelAnimationFrame(raf);
		}
		setState("closed");
		const wait = prefersReducedMotion() ? 0 : exitMs;
		const t = setTimeout(() => setMounted(false), wait);
		return () => clearTimeout(t);
	}, [open, exitMs]);

	return { mounted, state };
}
