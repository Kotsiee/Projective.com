import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal, useSignalEffect } from "@preact/signals";
import "../styles/workspace.css";
import { Icon } from "@projective/ui/icons";
import { Button } from "@projective/ui/fields";
import { Tag } from "@projective/ui/display";
import { TabMenu, useMediaQuery } from "@projective/ui/navigation";
import {
	consoleHref,
	type ListingStatus,
	type WorkspaceUrlState,
} from "../types/catalogue-types.ts";
import { type StatusMeta, statusMeta } from "../core/catalogue-model.ts";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import {
	conflictPrompt,
	draft,
	retry,
	savedAt,
	saveState,
	setWorkspaceUrl,
	startWorkspaceSync,
	workspaceReady,
	workspaceUrl,
} from "../core/workspace-store.ts";
import {
	INSPECTOR_ID,
	saveLabel,
	type SaveState,
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

/** What a screen reader hears when the save state changes; typing itself is not announced. */
const ANNOUNCE: Readonly<Record<SaveState, string>> = {
	saved: "Saved",
	dirty: "",
	saving: "Saving",
	error: "Couldn't save",
	conflict: "This listing changed somewhere else",
};

const TICK_MS = 5_000;

const TONE_SEVERITY: Readonly<Record<StatusMeta["tone"], "success" | "secondary" | "warning">> = {
	success: "success",
	neutral: "secondary",
	warning: "warning",
	muted: "secondary",
};

/**
 * ListingHeader — the workspace's middle-nav HEADER band: the way back to the console, the
 * listing's live title, its lifecycle status (a permitted status container), the save state as meta
 * text ("Saved · 2s ago", "Saving…", "Couldn't save" with Retry), the Edit · Preview · Analytics ·
 * Clients tab strip (Clients carries the count of buyers waiting on the seller), and the Card
 * button that shows the live card and readiness panel (a drawer below 1280px).
 *
 * The tabs are a WAI-ARIA tablist whose one panel is the canvas in another hydration root;
 * switching pushes a history entry, so Back returns to the previous tab.
 */
export default function ListingHeader(props: ListingHeaderProps): JSX.Element {
	const now = useSignal(Date.now());
	const waiting = useSignal(0);
	const tabIndex = useSignal(Math.max(0, WORKSPACE_TABS.indexOf(props.url.tab)));
	const docked = useMediaQuery(CONTEXT_PANEL_INFLOW_QUERY);

	useEffect(() => {
		startWorkspaceSync();
		const tick = setInterval(() => (now.value = Date.now()), TICK_MS);
		void WorkspaceService.clients(props.slug).then((res) => {
			if (res.ok && res.data) waiting.value = res.data.counts.action_required;
		});
		return () => clearInterval(tick);
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
	const state = ready ? saveState.value : "saved";
	const label = saveLabel(state, savedAt.value, now.value);
	const inspector = workspacePanelOf(url) === "inspector";
	const panelOpen = docked ? contextPanelDocked.value : contextDrawerOpen.value;

	const model = WORKSPACE_TABS.map((tab) => ({
		key: tab,
		label: TAB_LABELS[tab],
		badge: tab === "clients" && waiting.value > 0 ? waiting.value : undefined,
	}));

	return (
		<header class="cat-ws-head">
			<a class="cat-ws-head__back" href={consoleHref({})}>
				<Icon name="chevron-left" />
				<span class="cat-ws-head__back-label">Catalogue</span>
			</a>

			<div class="cat-ws-head__id">
				<h1 class="cat-ws-head__title" title={title}>{title || "Untitled listing"}</h1>
				<p class="cat-ws-head__meta">
					<Tag
						class="cat-ws-head__status"
						value={meta.label}
						severity={TONE_SEVERITY[meta.tone]}
						variant="subtle"
					/>
					<span class="cat-ws-head__save" data-state={state} aria-hidden="true">
						{label.text}
					</span>
					{label.retry && (
						<button
							type="button"
							class="cat-ws-head__link"
							onClick={() => void retry()}
						>
							Retry
						</button>
					)}
					{state === "conflict" && (
						<button
							type="button"
							class="cat-ws-head__link"
							onClick={() => (conflictPrompt.value = true)}
						>
							Resolve
						</button>
					)}
				</p>
				<span class="ui-visually-hidden" role="status">{ANNOUNCE[state]}</span>
			</div>

			<TabMenu
				id={WORKSPACE_TABS_ID}
				class="cat-ws-head__tabs"
				model={model}
				activeIndex={tabIndex}
				onActiveIndexChange={(i) => {
					const tab = WORKSPACE_TABS[i];
					if (tab) setWorkspaceUrl({ tab }, "push");
				}}
				panelId={WORKSPACE_PANEL_ID}
				aria-label="Listing workspace"
			/>

			{inspector && (
				<Button
					class="cat-ws-head__card"
					size="sm"
					severity="neutral"
					variant="outlined"
					label="Card"
					icon={<Icon name="panel-right" />}
					aria-expanded={panelOpen}
					aria-controls={docked ? INSPECTOR_ID : undefined}
					onClick={toggleContextPanel}
				/>
			)}
		</header>
	);
}
