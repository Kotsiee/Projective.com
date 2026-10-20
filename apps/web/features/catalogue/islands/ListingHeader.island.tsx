import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal, useSignalEffect } from "@preact/signals";
import "../styles/workspace.css";
import "../styles/header-band.css";
import { Icon } from "@projective/ui/icons";
import { Tag } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { TabMenu, useMediaQuery } from "@projective/ui/navigation";
import type { ListingStatus, WorkspaceUrlState } from "../types/catalogue-types.ts";
import { type StatusMeta, statusMeta } from "../core/catalogue-model.ts";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import {
	draft,
	setWorkspaceUrl,
	startWorkspaceSync,
	workspaceReady,
	workspaceUrl,
} from "../core/workspace-store.ts";
import {
	INSPECTOR_ID,
	TAB_LABELS,
	WORKSPACE_PANEL_ID,
	WORKSPACE_TABS,
	WORKSPACE_TABS_ID,
	workspacePanelOf,
} from "../core/workspace-model.ts";
import {
	CONTEXT_PANEL_INFLOW_QUERY,
	contextDrawerOpen,
	contextPanelDocked,
	toggleContextPanel,
} from "@web/features/shell/core/context-panel-state.ts";

/** Props for {@link ListingHeader}. */
export interface ListingHeaderProps {
	/** The listing's slug (its address). */
	slug: string;
	/** The SSR title and status, so the band paints correctly in the first byte. */
	title: string;
	status: ListingStatus;
	/** The workspace URL state the server resolved. */
	url: WorkspaceUrlState;
}

const TONE_SEVERITY: Readonly<Record<StatusMeta["tone"], "success" | "secondary" | "warning">> = {
	success: "success",
	neutral: "secondary",
	warning: "warning",
	muted: "secondary",
};

/**
 * ListingHeader — the workspace's middle-nav HEADER band, laid out like the console's
 * ({@link CatalogueHeader}) and the channel headers: at the start the identity block — the listing's
 * live title over its lifecycle status (a permitted status container) — the save state lives in the
 * footer rig beside Publish (Decision #304); the Edit · Preview · Analytics · Clients tab strip centred (Clients carries the count
 * of buyers waiting on the seller); and at the end the icon-only Card toggle that shows the live card
 * and readiness panel (a drawer below 1280px). The way back to the console is the lane head's.
 *
 * The tabs are a WAI-ARIA tablist whose one panel is the canvas in another hydration root;
 * switching pushes a history entry, so Back returns to the previous tab.
 */
export default function ListingHeader(props: ListingHeaderProps): JSX.Element {
	const waiting = useSignal(0);
	const tabIndex = useSignal(Math.max(0, WORKSPACE_TABS.indexOf(props.url.tab)));
	const docked = useMediaQuery(CONTEXT_PANEL_INFLOW_QUERY);

	useEffect(() => {
		startWorkspaceSync();
		void WorkspaceService.clients(props.slug).then((res) => {
			if (res.ok && res.data) waiting.value = res.data.counts.action_required;
		});
	}, []);

	useSignalEffect(() => {
		if (!workspaceReady.value) return;
		const index = WORKSPACE_TABS.indexOf(workspaceUrl.value.tab);
		if (index >= 0 && index !== tabIndex.peek()) tabIndex.value = index;
	});

	const ready = workspaceReady.value;
	const live = ready ? draft.value : null;
	const title = live?.title ?? props.title;
	const meta = statusMeta(live?.status ?? props.status);
	const url = ready ? workspaceUrl.value : props.url;
	const inspector = workspacePanelOf(url) === "inspector";
	const panelOpen = docked ? contextPanelDocked.value : contextDrawerOpen.value;

	const model = WORKSPACE_TABS.map((tab) => ({
		key: tab,
		label: TAB_LABELS[tab],
		badge: tab === "clients" && waiting.value > 0 ? waiting.value : undefined,
	}));

	return (
		<header class="cat-band cat-ws-head">
			<div class="cat-band__start">
				<div class="cat-band__idblock">
					<h1 class="cat-band__title" title={title}>{title || "Untitled listing"}</h1>
					<div class="cat-band__meta">
						<Tag
							class="cat-ws-head__status"
							value={meta.label}
							severity={TONE_SEVERITY[meta.tone]}
							variant="subtle"
						/>
					</div>
				</div>
			</div>

			<TabMenu
				id={WORKSPACE_TABS_ID}
				class="cat-band__tabs"
				model={model}
				activeIndex={tabIndex}
				onActiveIndexChange={(i) => {
					const tab = WORKSPACE_TABS[i];
					if (tab) setWorkspaceUrl({ tab }, "push");
				}}
				panelId={WORKSPACE_PANEL_ID}
				aria-label="Listing workspace"
			/>

			<div class="cat-band__end">
				{inspector && (
					<Tooltip
						content={panelOpen ? "Hide listing card" : "Show listing card"}
						placement="bottom"
					>
						<button
							type="button"
							class="cat-band__action cat-ws-head__card"
							data-on={panelOpen ? "true" : undefined}
							aria-label="Listing card"
							aria-expanded={panelOpen}
							aria-controls={docked ? INSPECTOR_ID : undefined}
							onClick={toggleContextPanel}
						>
							<Icon name="panel-right" />
						</button>
					</Tooltip>
				)}
			</div>
		</header>
	);
}
