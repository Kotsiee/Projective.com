import type { JSX } from "preact";
import "../styles/workspace.css";
import {
	formArchetypeOf,
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
	liveListing,
	revision,
	setWorkspaceUrl,
	workspaceReady,
	workspaceUrl,
} from "../core/workspace-store.ts";
import { WORKSPACE_PANEL_ID, workspaceTabId } from "../core/workspace-model.ts";
import { useWorkspacePersistence } from "../hooks/useWorkspacePersistence.ts";

/** Props for {@link ListingWorkspace}. */
export interface ListingWorkspaceProps {
	/** The listing as the server read it for this request. */
	initial: ListingDetail;
	/** The workspace URL state the server resolved. */
	url: WorkspaceUrlState;
	/** The seller is a restricted (13–17) account (Decision #208). */
	restricted: boolean;
}

/**
 * ListingWorkspace — the item workspace's canvas: the tab router for Edit · Preview · Analytics ·
 * Clients, rendered as the one `role="tabpanel"` the header's tab strip controls (named by that tab
 * across hydration roots). It owns the workspace store's hydration and the page's persistence
 * ({@link useWorkspacePersistence}). A stale save raises the conflict choice.
 */
export default function ListingWorkspace(props: ListingWorkspaceProps): JSX.Element {
	useWorkspacePersistence(props.initial, props.url);

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
							team={props.url.team}
						/>
					)
					: tab === "preview"
					? (
						<PreviewCanvas
							slug={listing.id}
							title={listing.title}
							device={workspaceReady.value ? workspaceUrl.value.device : props.url.device}
							team={props.url.team}
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
							hrefFor={(client) =>
								workspaceHref(listing.id, { team: props.url.team, tab: "clients", client })}
							emptyAction={{
								label: "Back to Edit",
								onPress: () => setWorkspaceUrl({ tab: "edit" }, "push"),
							}}
							waitlist={formArchetypeOf(listing.kind, listing.serviceType) === "cohort"
								? listing.id
								: undefined}
						/>
					)
					: <TabPending tab={tab} />}
			</div>
			<ConflictDialog />
		</div>
	);
}
