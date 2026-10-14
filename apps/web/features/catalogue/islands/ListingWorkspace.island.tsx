import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/workspace.css";
import type { ListingDetail, WorkspaceTab, WorkspaceUrlState } from "../types/catalogue-types.ts";
import { EditCanvas } from "../components/edit/EditCanvas.tsx";
import { ConflictDialog } from "../components/ConflictDialog.tsx";
import { TabPending } from "../components/TabPending.tsx";
import {
	flushBeacon,
	hydrateWorkspace,
	liveListing,
	resume,
	revision,
	startWorkspaceSync,
	workspaceReady,
	workspaceUrl,
} from "../core/workspace-store.ts";
import { WORKSPACE_PANEL_ID, workspaceTabId } from "../core/workspace-model.ts";

/** Props for {@link ListingWorkspace}. */
export interface ListingWorkspaceProps {
	/** The listing as the server read it for this request. */
	initial: ListingDetail;
	/** The workspace URL state the server resolved. */
	url: WorkspaceUrlState;
	/** The seller is a restricted (13–17) account (Decision #208). */
	restricted: boolean;
}

function sendBeacon(url: string, body: string): boolean {
	return navigator.sendBeacon?.(url, new Blob([body], { type: "text/plain" })) ?? false;
}

/**
 * ListingWorkspace — the item workspace's canvas: the tab router for Edit · Preview · Analytics ·
 * Clients, rendered as the one `role="tabpanel"` the header's tab strip controls (named by that tab
 * across hydration roots). It owns the workspace store's hydration and the page's persistence:
 * unsaved edits are flushed through a beacon when the page is hidden or left, and a stale save
 * raises the conflict choice.
 */
export default function ListingWorkspace(props: ListingWorkspaceProps): JSX.Element {
	useEffect(() => {
		hydrateWorkspace(props.initial, props.url);
		startWorkspaceSync();
		const onHide = () => void flushBeacon(sendBeacon);
		const onVisibility = () => {
			if (document.visibilityState === "hidden") onHide();
			else resume();
		};
		globalThis.addEventListener("pagehide", onHide);
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			globalThis.removeEventListener("pagehide", onHide);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, []);

	const listing = liveListing(props.initial);
	const tab: WorkspaceTab = workspaceReady.value ? workspaceUrl.value.tab : props.url.tab;
	const generation = revision.value;

	return (
		<div class="cat-ws">
			<div
				id={WORKSPACE_PANEL_ID}
				class="cat-ws__canvas"
				role="tabpanel"
				aria-labelledby={workspaceTabId(tab)}
				data-tab={tab}
			>
				{tab === "edit"
					? (
						<EditCanvas
							key={generation}
							listing={listing}
							restricted={props.restricted}
							initialSection={generation === 0 ? props.url.section : undefined}
						/>
					)
					: <TabPending tab={tab} />}
			</div>
			<ConflictDialog />
		</div>
	);
}
