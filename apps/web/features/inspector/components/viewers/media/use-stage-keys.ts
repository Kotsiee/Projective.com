import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { mediaCommand, type MediaKind } from "../../../core/media-model.ts";
import type { PlaybackTools } from "./media-tools.ts";

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement;
}

/**
 * Bind the media keys to the stage region that contains `anchor`. A key a focused control already
 * handled (the player's sliders) is left alone, and Space ⁄ Enter act only on the stage itself so a
 * focused button keeps its own activation.
 */
export function useStageKeys(
	anchor: RefObject<HTMLElement>,
	tools: PlaybackTools,
	kind: MediaKind,
): void {
	const current = useRef(tools);
	current.current = tools;

	useEffect(() => {
		const stage = anchor.current?.closest<HTMLElement>(".ins-stage");
		if (!stage) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.defaultPrevented || isTypingTarget(e.target)) return;
			if ((e.key === " " || e.key === "Enter") && e.target !== stage) return;
			const command = mediaCommand(e, kind);
			if (command === null) return;
			if (e.repeat && command.type !== "seek" && command.type !== "frame") {
				e.preventDefault();
				return;
			}
			if (current.current.run(command)) e.preventDefault();
		};
		stage.addEventListener("keydown", onKey);
		return () => stage.removeEventListener("keydown", onKey);
	}, [anchor, kind]);
}
