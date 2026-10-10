import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return target.isContentEditable || target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/**
 * Route keys pressed while the inspector stage (or anything inside it) has focus to `onKey`.
 * Typing in a field inside the stage is left alone; a handled key (`onKey` returns `true`) has its
 * default prevented, which also tells the workspace to ignore it.
 */
export function useStageKeys(
	anchor: RefObject<HTMLElement>,
	onKey: (event: KeyboardEvent, stage: HTMLElement) => boolean,
): void {
	const handler = useRef(onKey);
	handler.current = onKey;
	useEffect(() => {
		const stage = anchor.current?.closest<HTMLElement>(".ins-stage");
		if (!stage) return;
		const listen = (event: KeyboardEvent) => {
			if (event.defaultPrevented || isTypingTarget(event.target)) return;
			if (handler.current(event, stage)) event.preventDefault();
		};
		stage.addEventListener("keydown", listen);
		return () => stage.removeEventListener("keydown", listen);
	}, [anchor]);
}

/** Whether the key event carries no modifier that would change its meaning. */
export function plainKey(event: KeyboardEvent): boolean {
	return !event.ctrlKey && !event.metaKey && !event.altKey;
}

/**
 * Scroll `scroller` for the reading keys (arrows, Page Up/Down, Space, Home/End) when focus sits on
 * the stage itself, which is not the scrolling element. Returns whether the key was handled.
 */
export function scrollForKey(
	event: KeyboardEvent,
	stage: HTMLElement,
	scroller: HTMLElement,
): boolean {
	if (event.target !== stage || !plainKey(event)) return false;
	const page = scroller.clientHeight * 0.9;
	const line = 48;
	switch (event.key) {
		case "ArrowDown":
			scroller.scrollBy({ top: line });
			return true;
		case "ArrowUp":
			scroller.scrollBy({ top: -line });
			return true;
		case "ArrowRight":
			scroller.scrollBy({ left: line });
			return true;
		case "ArrowLeft":
			scroller.scrollBy({ left: -line });
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
