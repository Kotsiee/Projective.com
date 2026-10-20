import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { useSignal, useSignalEffect } from "@preact/signals";
import "../styles/workspace.css";
import { MetaLine } from "@projective/ui/display";
import { Button } from "@projective/ui/fields";
import { TabMenu } from "@projective/ui/navigation";
import { kindCopy, type WorkspaceDetail, type WorkspaceKind } from "@projective/types/workspace";
import { moduleFor, type ModuleKey } from "../core/module-registry.tsx";
import { headerBand, type ModuleCommit } from "../core/header-model.ts";
import { hubTabs } from "../core/hub-tabs.ts";
import {
	SUB_VIEW_PANEL_ID,
	SUB_VIEW_TABS_ID,
	subViewIndex,
	subViewsFor,
} from "../core/sub-views.ts";
import {
	archiveRefusal,
	liveDetail,
	moduleCommit,
	selectModuleView,
	viewOr,
} from "../core/workspace-state.ts";
import { EntityMenu } from "../components/EntityMenu.tsx";

/**
 * WorkspaceHeaderBand — the middle-nav frame's header band on a `/teams/[handle]` or
 * `/businesses/[handle]` console, laid out as Decision #220's three-region band (the catalogue's
 * `.cat-band`):
 *
 *   - **Identity, start** — the hub's (or the module's) title in the title register over one
 *     `MetaLine` (the entity's name and `@handle`, and the acting state).
 *   - **Tabs, centred** — a multi-module hub's strip of LINK tabs (`hub-tabs.ts`, Decision #306:
 *     Roster & members is People · Invitations · Org chart · Roles), each a real address; otherwise
 *     the module's own in-place sub-view `TabMenu` (`sub-views.ts`), which writes the ONE sub-view state
 *     (`selectModuleView`) the lane's context control and the footer rig's Org chart toggle also write.
 *   - **Actions, end** — at most ONE filled control (the module's commit, published through
 *     `workspace-state`), then the entity kebab ({@link EntityMenu}) — drawn here only where the lane
 *     that owns it is off screen (collapsed to its rail, or hidden below `--bp-md`); the stylesheet
 *     paints exactly one copy (`.wsp-headerband__menu`).
 *
 * Every rule above — which regions exist, which actions, how many fill — is `header-model.ts` and
 * `hub-tabs.ts`, pinned by their unit tests; this island only renders them.
 *
 * The band reads the live-detail relay when the published detail is this entity, so an archive or a
 * role change elsewhere on the page re-renders it from the same truth as the lane. It is mounted into
 * a shell slot, so it must not export its intrinsic width; `workspace-chrome.css` clamps it.
 */

export interface WorkspaceHeaderBandProps {
	kind: WorkspaceKind;
	workspace: WorkspaceDetail;
	/** The module being rendered, already corrected server-side by `resolveWorkspaceConsole`. */
	module: ModuleKey;
	/** The module's sub-view, resolved server-side against what the viewer is offered (`resolveSubView`). */
	view?: string | null;
	/** Live pathname — reserved for future within-module wayfinding. */
	path: string;
	/** On a channel route, the room being rendered — the band titles it `# slug` over its topic. */
	channel?: { slug: string; topic: string | null } | null;
}

export default function WorkspaceHeaderBand(props: WorkspaceHeaderBandProps): JSX.Element {
	// #region State
	const { kind, module } = props;
	const published = liveDetail.value;
	const ws = published && published.id === props.workspace.id ? published : props.workspace;
	const copy = kindCopy(kind);
	const bandRef = useRef<HTMLDivElement>(null);
	// #endregion

	// #region The model
	const view = viewOr(props.view ?? null);
	const strip = hubTabs({
		kind,
		handle: ws.handle,
		capabilities: ws.viewerCapabilities,
		module,
		view,
	});
	const views = strip ? [] : subViewsFor(module, kind, ws.viewerCapabilities);
	const self = ws.members.find((m) => m.id === ws.viewerMemberId);
	const room = props.channel ?? null;
	const model = headerBand({
		kind,
		title: room ? `# ${room.slug}` : strip?.title ?? moduleFor(module)?.label ?? copy.Noun,
		module,
		name: ws.name,
		handle: ws.handle,
		status: ws.status,
		acting: ws.isActing,
		owner: self?.rolePreset === "owner",
		capabilities: ws.viewerCapabilities,
		viewerCanArchive: ws.viewerCan?.archive ?? null,
		// The read's blockers, or a refusal Settings has had since that read (its re-read may fail).
		archiveBlocked: ws.archiveBlockers.length > 0 || archiveRefusal.value?.id === ws.id,
		subViews: views,
		view,
		commit: moduleCommit.value,
	});

	// The TabMenu binds a writable index; it follows the shared sub-view whichever root picked it.
	const activeTab = useSignal(strip?.active ?? model.tabs?.active ?? 0);
	useSignalEffect(() => {
		if (!strip) activeTab.value = subViewIndex(views, viewOr(props.view ?? null));
	});
	// #endregion

	return (
		<div ref={bandRef} class="wsp-headerband" data-kind={kind}>
			{/* #region Start — identity */}
			<div class="wsp-headerband__start">
				<div class="wsp-headerband__id">
					<h2 class="wsp-headerband__title">{model.title}</h2>
					<MetaLine
						as="p"
						size="xs"
						class="wsp-headerband__meta"
						items={room?.topic ? [room.topic, ...model.meta.slice(0, 1)] : model.meta}
					/>
				</div>
			</div>
			{/* #endregion */}

			{/* #region Centre — the hub's link tabs, or the module's sub-view tabs */}
			{strip && (
				<TabMenu
					id={SUB_VIEW_TABS_ID}
					class="wsp-headerband__tabs"
					model={strip.tabs.map((t) => ({ key: t.key, label: t.label, url: t.href }))}
					activeIndex={activeTab}
					aria-label={`${strip.title} views`}
				/>
			)}
			{!strip && model.tabs && (
				<TabMenu
					id={SUB_VIEW_TABS_ID}
					class="wsp-headerband__tabs"
					model={model.tabs.views.map((v) => ({ key: v.value, label: v.label }))}
					activeIndex={activeTab}
					onActiveIndexChange={(i) => {
						const next = views[i];
						if (next) selectModuleView(next.value, views);
					}}
					panelId={SUB_VIEW_PANEL_ID}
					aria-label={`${model.title} views`}
				/>
			)}
			{/* #endregion */}

			{/* #region End — actions */}
			<div class="wsp-headerband__end">
				{model.commit && <CommitButton commit={model.commit} />}

				<span class="wsp-headerband__menu">
					<EntityMenu workspace={ws} plan={model.menu} label={model.menuLabel} />
				</span>
			</div>
			{/* #endregion */}
		</div>
	);
}

// #region The commit
/**
 * The module's commit at its own filled tier (§B.8.1): 1 amber money movement, 2 the monochrome
 * structural tone, 3 the primary workflow commit.
 */
function CommitButton({ commit }: { commit: ModuleCommit }): JSX.Element {
	const shared = {
		size: "sm" as const,
		label: commit.label,
		loading: commit.busy,
		disabled: commit.disabled,
		onClick: commit.run,
	};
	if (commit.tier === 1) return <Button {...shared} severity="accent" rounded />;
	if (commit.tier === 2) return <Button {...shared} structural />;
	return <Button {...shared} />;
}
// #endregion
