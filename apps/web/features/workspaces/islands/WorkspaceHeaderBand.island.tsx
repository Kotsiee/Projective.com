import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal, useSignalEffect } from "@preact/signals";
import "@web/features/projects/styles/fx-toolbar.css";
import "@web/features/projects/styles/channel-header.css";
import "../styles/workspace.css";
import { MetaLine } from "@projective/ui/display";
import { Button, Select } from "@projective/ui/fields";
import { TabStrip } from "@projective/ui/navigation";
import { kindCopy, type WorkspaceDetail, type WorkspaceKind } from "@projective/types/workspace";
import { moduleFor, type ModuleKey } from "../core/module-registry.tsx";
import { headerBand, type ModuleCommit } from "../core/header-model.ts";
import { hubTabs } from "../core/hub-tabs.ts";
import {
	bandSubViewsFor,
	SUB_VIEW_PANEL_ID,
	SUB_VIEW_TOOLBAR_ID,
	subViewIndex,
} from "../core/sub-views.ts";
import { peopleReading, restorePeopleReading } from "../core/view-state.ts";
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
 *   - **Views, centred** — for a multi-module hub (`hub-tabs.ts`, Decisions #306, #319: Members is
 *     Members · Roles), the channel header's link tabs (`TabStrip`): each module is a real
 *     address, an anchor, never a picker that navigates by script. The Members tab points at the
 *     reading the reader last had (`peopleReading`), so leaving the org chart for Roles and coming
 *     back lands on the org chart. Without a hub strip, a module that leaves its in-place sub-views to
 *     the band (`bandSubViewsFor` — a team's Projects) gets the shared `.fx-toolbar` holding one bare
 *     `Select` (Decision #307), whose pick writes the ONE sub-view state (`selectModuleView`). Members
 *     draws its own: its sections in the body, its org chart in the footer rig.
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
 * a shell slot, so it must not export its intrinsic width; `workspace-chrome.css` clamps it. The root
 * and the end region also carry the channel header's `.chan-header` / `.chan-header__actions`: the tab
 * strip measures itself against them to fold into its compact stepper when the band runs short.
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

	// The Members tab's reading is the reader's own, so it is restored after the first frame.
	useEffect(() => restorePeopleReading(), []);
	// #endregion

	// #region The model
	const view = viewOr(props.view ?? null);
	const strip = hubTabs({
		kind,
		handle: ws.handle,
		capabilities: ws.viewerCapabilities,
		module,
		view,
		reading: peopleReading.value,
	});
	const views = strip ? [] : bandSubViewsFor(module, kind, ws.viewerCapabilities);
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

	// The Select binds a writable value; it follows the shared sub-view whichever root picked it.
	const options = model.tabs?.views.map((v) => ({ value: v.value, label: v.label })) ?? [];
	const picked = useSignal(options[model.tabs?.active ?? 0]?.value ?? "");
	useSignalEffect(() => {
		picked.value = views[subViewIndex(views, viewOr(props.view ?? null))]?.value ?? "";
	});
	// #endregion

	return (
		<div ref={bandRef} class="wsp-headerband chan-header" data-kind={kind}>
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

			{/* #region Centre — the hub's pages as link tabs, or the module's in-place sub-views */}
			{strip
				? (
					<TabStrip
						items={strip.tabs.map((tab) => ({
							key: tab.key,
							label: tab.label,
							href: tab.href,
							icon: moduleFor(tab.module)?.glyph ?? <span />,
						}))}
						activeKey={strip.tabs[strip.active]?.key ?? ""}
						label={`${strip.title} pages`}
					/>
				)
				: options.length > 1 && (
					<div
						id={SUB_VIEW_TOOLBAR_ID}
						class="fx-toolbar wsp-headerband__toolbar"
						role="toolbar"
						aria-label={`${model.title} views`}
						aria-controls={SUB_VIEW_PANEL_ID}
					>
						<Select
							class="ui-field--bare wsp-headerband__view"
							size="sm"
							aria-label={`${model.title} view`}
							options={options}
							value={picked}
							onValueChange={(value) => selectModuleView(value, views)}
						/>
					</div>
				)}
			{/* #endregion */}

			{/* #region End — actions */}
			<div class="wsp-headerband__end chan-header__actions">
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
