import type { RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

const failed = new Set<string>();

/** What {@link usePictureFallback} binds onto an `<img>`. */
export interface PictureFallback {
	/** The address to draw, or `null` when there is none or it already failed on this page. */
	src: string | null;
	ref: RefObject<HTMLImageElement>;
	onError: () => void;
}

/**
 * A picture that gives way to its tile when it cannot load. A failed address is remembered for the
 * page, so a card that remounts (a virtualised grid scrolled back) draws its tile at once rather than
 * a broken frame again. A server-rendered `<img>` that failed before hydration is caught on mount: it
 * is complete, has a request, and has no pixels.
 */
export function usePictureFallback(src: string | null | undefined): PictureFallback {
	const ref = useRef<HTMLImageElement>(null);
	const dead = useSignal<string | null>(null);
	const live = src && !failed.has(src) && dead.value !== src ? src : null;

	function onError(): void {
		if (!live) return;
		failed.add(live);
		dead.value = live;
	}

	useEffect(() => {
		const img = ref.current;
		if (live && img && img.complete && img.currentSrc !== "" && img.naturalWidth === 0) onError();
	}, [live]);

	return { src: live, ref, onError };
}
