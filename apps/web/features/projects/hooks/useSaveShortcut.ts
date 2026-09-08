import { useEffect } from "preact/hooks";
import { requestSave } from "../core/setup-state.ts";

/**
 * useSaveShortcut — `Ctrl+S` / `Cmd+S` persists the engagement instead of offering to save the PAGE.
 *
 * Shared by every footer rig that owns Save, so the shortcut behaves identically on the
 * whole-project form (`/projects/[projectId]`) and on the single-stage form
 * (`/projects/[projectId]/[channelId]/details`). Two copies would be two chances to disagree about
 * the one thing that is easy to get subtly wrong here — see the `preventDefault` note below — and a
 * shortcut that suppresses the browser's own dialog on one surface and not the other is worse than
 * one that never does.
 *
 * It lives with the rig rather than with the form because the rig is what already owns Save: the
 * button, its in-flight lock and the status line are all there, so the keyboard route and the
 * pointer route reach the same intent and report through the same feedback.
 */
export function useSaveShortcut(): void {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key.toLowerCase() !== "s") return;
			if (!(event.ctrlKey || event.metaKey)) return;
			// Ctrl+Alt+S and friends belong to the OS and to assistive software.
			if (event.altKey) return;
			/*
			 * `preventDefault` runs whatever the draft's state — including when nothing is dirty and the
			 * save is a no-op. The browser's "Save Page As" dialog is never the right answer on this
			 * surface, and a shortcut that suppresses it only sometimes is worse than one that never
			 * does: the reader cannot tell which behaviour they are about to get.
			 */
			event.preventDefault();
			// `explicit`, stated rather than left to the default: a keystroke aimed at Save IS a press,
			// so it is announced like one. Only the auto-save on blur saves without being asked.
			void requestSave("explicit");
		};
		// On `window`, because the shortcut belongs to the SURFACE rather than to any one field — an
		// owner halfway down the form should not have to be inside a particular input for it to work.
		globalThis.addEventListener("keydown", onKeyDown);
		return () => globalThis.removeEventListener("keydown", onKeyDown);
	}, []);
}
