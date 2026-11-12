import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { registerFindTarget } from "../core/shortcut-host.ts";

export interface FindTargetOptions {
	/** The surface the finder searches. While it is hidden or behind a modal, Ctrl/Cmd+F is the browser's. */
	scopeRef: RefObject<HTMLElement>;
	/** Open the finder, or focus it again when it is already open. */
	open: () => void;
	/** Offer the finder at all (default true). */
	enabled?: boolean;
}

/**
 * useFindTarget — take Ctrl/Cmd+F for an in-page finder through the shared listener
 * (`shortcut-host.ts`, Decision #418). On any page that offers none, the key stays the browser's.
 * Released on unmount.
 */
export function useFindTarget({ scopeRef, open, enabled = true }: FindTargetOptions): void {
	const openRef = useRef(open);
	openRef.current = open;

	useEffect(() => {
		if (!enabled) return;
		return registerFindTarget({ element: () => scopeRef.current, open: () => openRef.current() });
	}, [enabled, scopeRef]);
}
