import type { ComponentChildren } from "preact";
import type { ContextPanelDockOptions } from "@web/features/shell/core/context-panel-state.ts";
import FilesInspector from "../islands/FilesInspector.island.tsx";

/**
 * files-panel-slot — the middle-nav frame's right PANEL on every `/files*` route: the
 * {@link FilesInspector}, a `selection` panel, closed until an item is picked. Selection is client
 * state here, never in the address, so it always opens closed. Server-only; never imported by an
 * island.
 */
export function filesPanelFor(url: URL): ComponentChildren {
	return onFiles(url) ? <FilesInspector /> : null;
}

/** How the panel docks on `/files*`: as an inspector over the listing. */
export function filesPanelDockFor(url: URL): ContextPanelDockOptions | null {
	return onFiles(url) ? { dock: "selection" } : null;
}

function onFiles(url: URL): boolean {
	return url.pathname === "/files" || url.pathname.startsWith("/files/");
}
