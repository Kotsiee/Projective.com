import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/workspace.css";
import {
	type ListingDetail,
	workspaceHref,
	type WorkspaceTab,
	type WorkspaceUrlState,
} from "../types/catalogue-types.ts";
import { EditCanvas } from "../components/edit/EditCanvas.tsx";
import { ConflictDialog } from "../components/ConflictDialog.tsx";
import { TabPending } from "../components/TabPending.tsx";
import { ClientsCanvas } from "../components/clients/ClientsCanvas.tsx";
import { AnalyticsCanvas } from "../components/analytics/AnalyticsCanvas.tsx";
import { PreviewCanvas } from "../components/preview/PreviewCanvas.tsx";
import {
	flushBeacon,
	hydrateWorkspace,
	liveListing,
	resume,
	revision,
	setWorkspaceUrl,
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
					: tab === "preview"
					? (
						<PreviewCanvas
							slug={listing.id}
							title={listing.title}
							device={workspaceReady.value ? workspaceUrl.value.device : props.url.device}
						/>
					)
					: tab === "analytics"
					? (
						<AnalyticsCanvas
							target={{ kind: "listing", slug: listing.id }}
							period={workspaceReady.value ? workspaceUrl.value.period : props.url.period}
							onPeriod={(period) => setWorkspaceUrl({ period }, "push")}
							idBase="cat-an-listing"
						/>
					)
					: tab === "clients"
					? (
						<ClientsCanvas
							surface="workspace"
							scope={{ listing: listing.id }}
							chosen={workspaceReady.value ? workspaceUrl.value.client : props.url.client}
							hrefFor={(client) => workspaceHref(listing.id, { tab: "clients", client })}
							emptyAction={{
								label: "Back to Edit",
								onPress: () => setWorkspaceUrl({ tab: "edit" }, "push"),
							}}
						/>
					)
					: <TabPending tab={tab} />}
			</div>
			<ConflictDialog />
		</div>
	);
}
