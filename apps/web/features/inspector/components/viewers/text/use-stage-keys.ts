import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";

/** Handles one key press on the stage; returns `true` when it consumed it. */
export type StageKeyHandler = (event: KeyboardEvent) => boolean;

const LINE_STEP = 40;

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return target.isContentEditable || target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function scrollByKey(event: KeyboardEvent, scroller: HTMLElement): boolean {
	if (event.altKey || event.metaKey) return false;
	const page = Math.max(scroller.clientHeight - LINE_STEP, LINE_STEP);
	switch (event.key) {
		case "ArrowDown":
			scroller.scrollBy({ top: LINE_STEP });
			return true;
		case "ArrowUp":
			scroller.scrollBy({ top: -LINE_STEP });
			return true;
		case "ArrowRight":
			scroller.scrollBy({ left: LINE_STEP });
			return true;
		case "ArrowLeft":
			scroller.scrollBy({ left: -LINE_STEP });
			return true;
		case "PageDown":
			scroller.scrollBy({ top: page });
			return true;
		case "PageUp":
			scroller.scrollBy({ top: -page });
			return true;
		case " ":
			scroller.scrollBy({ top: event.shiftKey ? -page : page });
			return true;
		case "Home":
			scroller.scrollTo({ top: 0 });
			return true;
		case "End":
			scroller.scrollTo({ top: scroller.scrollHeight });
			return true;
		default:
			return false;
	}
}

/**
 * Route key presses on the focused stage (`.ins-stage`, the focusable region around a canvas) to
 * `handler`, and scroll `scroller` with the arrow, page, space, Home and End keys while focus sits
 * on the stage itself — the stage is not the scroll container, so the browser would not. Consumed
 * presses are default-prevented, which tells the workspace to leave them alone.
 */
export function useStageKeys(
	host: RefObject<HTMLElement>,
	scroller: RefObject<HTMLElement>,
	handler: StageKeyHandler,
): void {
	const latest = useRef(handler);
	latest.current = handler;
	useEffect(() => {
		const node = host.current;
		const stage = node?.closest<HTMLElement>(".ins-stage") ?? node;
		if (!stage) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.defaultPrevented || isTypingTarget(event.target)) return;
			let consumed = latest.current(event);
			const target = scroller.current;
			if (!consumed && target && event.target === stage) consumed = scrollByKey(event, target);
			if (consumed) event.preventDefault();
		};
		stage.addEventListener("keydown", onKey);
		return () => stage.removeEventListener("keydown", onKey);
	}, [host, scroller]);
}
