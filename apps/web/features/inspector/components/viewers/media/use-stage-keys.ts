import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { InspectorShell } from "../../../core/inspector-shell.ts";
import {
	BOOST_RATE,
	createSpaceGesture,
	formatRate,
	mediaCommand,
	type MediaKind,
	type SpaceIntent,
} from "../../../core/media-model.ts";
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
 * focused button keeps its own activation. Space acts on release ({@link createSpaceGesture}): a tap
 * plays or pauses, two taps toggle fullscreen, a hold plays at {@link BOOST_RATE}× until let go.
 */
export function useStageKeys(
	anchor: RefObject<HTMLElement>,
	tools: PlaybackTools,
	kind: MediaKind,
	shell: InspectorShell,
): void {
	const current = useRef(tools);
	current.current = tools;

	useEffect(() => {
		const stage = anchor.current?.closest<HTMLElement>(".ins-stage");
		if (!stage) return;
		const space = createSpaceGesture();
		let before = 1;
		const act = (intent: SpaceIntent | null) => {
			const t = current.current;
			switch (intent) {
				case "toggle-play":
					t.togglePlay();
					return;
				case "fullscreen":
					// The first tap already toggled playback; undo it, so two taps only change the view.
					t.togglePlay();
					shell.toggleFullscreen();
					return;
				case "boost":
					before = t.speed.peek();
					t.speed.value = BOOST_RATE;
					shell.announce(`${formatRate(BOOST_RATE)} while held`);
					return;
				case "unboost":
					t.speed.value = before;
					shell.announce(`Speed ${formatRate(before)}`);
					return;
			}
		};
		const plainSpace = (e: KeyboardEvent) =>
			e.key === " " && e.target === stage && !e.ctrlKey && !e.metaKey && !e.altKey;
		const onKey = (e: KeyboardEvent) => {
			if (e.defaultPrevented || isTypingTarget(e.target)) return;
			if (plainSpace(e)) {
				e.preventDefault();
				act(space.down(e.timeStamp));
				return;
			}
			if ((e.key === " " || e.key === "Enter") && e.target !== stage) return;
			const command = mediaCommand(e, kind);
			if (command === null) return;
			if (e.repeat && command.type !== "seek" && command.type !== "frame") {
				e.preventDefault();
				return;
			}
			if (current.current.run(command)) e.preventDefault();
		};
		const onKeyUp = (e: KeyboardEvent) => {
			if (!plainSpace(e)) return;
			e.preventDefault();
			act(space.up(e.timeStamp));
		};
		const onFocusOut = () => act(space.cancel());
		stage.addEventListener("keydown", onKey);
		stage.addEventListener("keyup", onKeyUp);
		stage.addEventListener("focusout", onFocusOut);
		return () => {
			stage.removeEventListener("keydown", onKey);
			stage.removeEventListener("keyup", onKeyUp);
			stage.removeEventListener("focusout", onFocusOut);
		};
	}, [anchor, kind, shell]);
}
