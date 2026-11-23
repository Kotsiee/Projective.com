import { useEffect } from "preact/hooks";
import type { ListingDetail, WorkspaceUrlState } from "../types/catalogue-types.ts";
import {
	flushBeacon,
	holdsUnsavedEdits,
	hydrateAutoSave,
	hydrateWorkspace,
	markSubPage,
	resume,
	startWorkspaceSync,
} from "../core/workspace-store.ts";
import { catalogueApiPath } from "../core/api-scope.ts";

function sendBeacon(url: string, body: string): boolean {
	const blob = new Blob([body], { type: "application/json" });
	return navigator.sendBeacon?.(catalogueApiPath(url), blob) ?? false;
}

/**
 * Hydrate the workspace store from the SSR read and own the page's persistence: under auto-save,
 * unsaved edits are flushed through a beacon when the page is hidden or left; with it off, leaving
 * with unsaved edits asks first. `subPage` marks one of the listing's Edit sub-pages (Decision
 * #525), whose workspace moves are navigations. Mount once per page, in the canvas island.
 */
export function useWorkspacePersistence(
	initial: ListingDetail,
	url: WorkspaceUrlState,
	options: { subPage?: boolean } = {},
): void {
	useEffect(() => {
		if (options.subPage) markSubPage();
		hydrateWorkspace(initial, url);
		hydrateAutoSave();
		startWorkspaceSync();
		const onHide = () => void flushBeacon(sendBeacon);
		const onBeforeUnload = (e: BeforeUnloadEvent) => {
			if (!holdsUnsavedEdits()) return;
			e.preventDefault();
			e.returnValue = "";
		};
		const onVisibility = () => {
			if (document.visibilityState === "hidden") onHide();
			else resume();
		};
		globalThis.addEventListener("pagehide", onHide);
		globalThis.addEventListener("beforeunload", onBeforeUnload);
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			globalThis.removeEventListener("pagehide", onHide);
			globalThis.removeEventListener("beforeunload", onBeforeUnload);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, []);
}
