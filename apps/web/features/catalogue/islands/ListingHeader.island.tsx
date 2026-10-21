import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal, useSignalEffect } from "@preact/signals";
import "../styles/workspace.css";
import "../styles/header-band.css";
import { Icon, type IconName } from "@projective/ui/icons";
import { Tag } from "@projective/ui/display";
import { ProgressRing, Tooltip } from "@projective/ui/feedback";
import { TabMenu, useMediaQuery } from "@projective/ui/navigation";
import type {
	ListingDetail,
	ListingStatus,
	WorkspaceTab,
	WorkspaceUrlState,
} from "../types/catalogue-types.ts";
import { goToSection } from "../components/edit/EditSectionFrame.tsx";
import { firstMissingSection, readinessItems } from "../core/readiness-items.ts";
import { type StatusMeta, statusMeta } from "../core/catalogue-model.ts";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import {
	draft,
	readiness,
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
	/** The listing's shape, which decides the publish checklist the progress ring counts. */
	kind: ListingDetail["kind"];
	serviceType: ListingDetail["serviceType"];
	/** What the publish gate found missing, for the first byte. */
	missing: readonly string[];
	/** The workspace URL state the server resolved. */
	url: WorkspaceUrlState;
}

const TAB_ICONS: Readonly<Record<WorkspaceTab, IconName>> = {
	edit: "edit",
	preview: "eye",
	analytics: "analytics",
	clients: "members",
};

const REMAINING_ID = "cat-ws-progress-remaining";

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
 * and readiness panel (a drawer below 1280px), preceded while the listing is a draft by the publish
 * checklist's progress ring, the project setup band's (Decision #310): hovering or focusing it lists
 * what is left, pressing it goes to the section that fixes the first missing line. Each tab leads
 * with its glyph, as the project band's Details · Preview do. The way back to the console is the
 * lane head's.
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
	const status = live?.status ?? props.status;
	const missing = (ready ? readiness.value?.missing : null) ?? props.missing;
	const checklist = readinessItems(live ?? props, {
		ready: missing.length === 0,
		missing: [...missing],
	});
	const remaining = checklist.filter((item) => !item.done);
	const pct = checklist.length === 0
		? 100
		: Math.round(((checklist.length - remaining.length) / checklist.length) * 100);
	const complete = remaining.length === 0;
	const nextSection = firstMissingSection(missing);
	const remainingText = complete
		? "Everything publishing needs is in place."
		: `Remaining: ${remaining.map((item) => item.label).join(", ")}.`;

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
				itemTemplate={(item) => (
					<>
						<span class="ui-tabmenu__icon" aria-hidden="true">
							<Icon name={TAB_ICONS[item.key as WorkspaceTab]} size="sm" />
						</span>
						<span class="ui-tabmenu__label">{item.label}</span>
						{item.badge != null && <span class="ui-tabmenu__badge">{item.badge}</span>}
					</>
				)}
				aria-label="Listing workspace"
			/>

			<div class="cat-band__end">
				{status === "draft" && (
					<div class="cat-band__progress">
						<Tooltip
							placement="bottom-end"
							content={
								<div class="cat-ws-rig__tip">
									<p class="cat-ws-rig__tip-head">
										{complete
											? "Ready to publish"
											: `${remaining.length === 1 ? "1 step" : `${remaining.length} steps`} to 100%`}
									</p>
									{!complete && (
										<ul class="cat-ws-rig__tip-list">
											{remaining.map((item) => <li key={item.label}>{item.label}</li>)}
										</ul>
									)}
								</div>
							}
						>
							<button
								type="button"
								class="cat-band__progress-button"
								aria-disabled={complete || !nextSection ? "true" : undefined}
								aria-label={`Listing ${pct}% ready to publish`}
								aria-describedby={REMAINING_ID}
								onClick={() => {
									if (nextSection) goToSection(nextSection);
								}}
							>
								<ProgressRing
									class="cat-band__progress-ring"
									value={pct}
									size={20}
									strokeWidth={3}
									severity={complete ? "success" : "primary"}
									aria-label="Publish readiness"
								/>
								<span class="cat-band__progress-value" aria-hidden="true">{pct}%</span>
							</button>
						</Tooltip>
						<span id={REMAINING_ID} class="ui-visually-hidden">{remainingText}</span>
					</div>
				)}
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
