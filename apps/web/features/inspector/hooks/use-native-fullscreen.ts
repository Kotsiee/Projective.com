import { effect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { createFullscreenSync, type FullscreenHost } from "../core/fullscreen-sync.ts";
import type { InspectorShell } from "../core/inspector-shell.ts";

function documentFullscreen(doc: Document): FullscreenHost {
	return {
		supported: () =>
			doc.fullscreenEnabled === true && typeof doc.documentElement.requestFullscreen === "function",
		active: () => doc.fullscreenElement != null,
		request: () => doc.documentElement.requestFullscreen({ navigationUI: "hide" }),
		exit: () => doc.exitFullscreen(),
		onChange(listener) {
			doc.addEventListener("fullscreenchange", listener);
			return () => doc.removeEventListener("fullscreenchange", listener);
		},
	};
}

/**
 * Pair the shell's theater with the browser's own fullscreen: the whole document goes fullscreen when
 * the theater opens, comes back when it closes, and a browser exit (Escape) closes the theater. A
 * browser that refuses leaves the in-page theater on its own.
 */
export function useNativeFullscreen(shell: InspectorShell): void {
	useEffect(() => {
		const sync = createFullscreenSync(documentFullscreen(document), () => {
			shell.fullscreen.value = false;
		});
		const stop = effect(() => {
			if (shell.fullscreen.value) sync.enter();
			else sync.leave();
		});
		return () => {
			stop();
			sync.leave();
			sync.dispose();
		};
	}, [shell]);
}
