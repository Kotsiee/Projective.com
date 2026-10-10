import type { InspectorShell } from "../../core/inspector-shell.ts";

/** Attribute an embedding host puts on the element whose keys a canvas may claim (e.g. the modal panel). */
export const KEY_SCOPE_ATTRIBUTE = "data-ins-key-scope";

/**
 * Where a canvas listens for its document-wide keys (Ctrl+F, Ctrl+P): the whole document on the
 * standalone page; inside a host, the nearest `[data-ins-key-scope]` around `anchor`, else the stage.
 * `null` while the anchor is not mounted.
 */
export function keyScope(shell: InspectorShell, anchor: HTMLElement | null): EventTarget | null {
	if (!shell.options.embedded) return typeof document === "undefined" ? null : document;
	if (!anchor) return null;
	return anchor.closest(`[${KEY_SCOPE_ATTRIBUTE}]`) ?? anchor.closest(".ins-stage") ?? anchor;
}

/**
 * Listen for key presses on {@link keyScope}'s target. Returns the detach function (a no-op when
 * there is nowhere to listen yet).
 */
export function listenScopedKeys(
	shell: InspectorShell,
	anchor: HTMLElement | null,
	onKey: (event: KeyboardEvent) => void,
	capture = false,
): () => void {
	const target = keyScope(shell, anchor);
	if (!target) return () => undefined;
	const listener = (event: Event) => {
		if (event instanceof KeyboardEvent) onKey(event);
	};
	target.addEventListener("keydown", listener, capture);
	return () => target.removeEventListener("keydown", listener, capture);
}
