import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { useSignal, useSignalEffect } from "@preact/signals";
import "@web/features/projects/styles/fx-toolbar.css";
import "../styles/workspace.css";
import { MetaLine } from "@projective/ui/display";
import { Button, Select } from "@projective/ui/fields";
import { kindCopy, type WorkspaceDetail, type WorkspaceKind } from "@projective/types/workspace";
import { moduleFor, type ModuleKey } from "../core/module-registry.tsx";
import { headerBand, type ModuleCommit } from "../core/header-model.ts";
import { hubTabs } from "../core/hub-tabs.ts";
import {
	SUB_VIEW_PANEL_ID,
	SUB_VIEW_TOOLBAR_ID,
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
 *   - **View toolbar, centred** — the shared `.fx-toolbar` the File Explorer and the Catalogue console
 *     draw, holding one bare `Select` (Decision #307). For a multi-module hub (`hub-tabs.ts`, Decision
 *     #306: Members is People · Invitations · Org chart · Roles) each option is a real address and
 *     picking one goes there, as the hub's link tabs did; otherwise the options are the module's own
 *     in-place sub-views (`sub-views.ts`), and picking one writes the ONE sub-view state
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

	// The Select binds a writable value; it follows the shared sub-view whichever root picked it.
	const options = strip
		? strip.tabs.map((t) => ({ value: t.key, label: t.label }))
		: model.tabs?.views.map((v) => ({ value: v.value, label: v.label })) ?? [];
	const picked = useSignal(
		strip ? strip.tabs[strip.active]?.key ?? "" : options[model.tabs?.active ?? 0]?.value ?? "",
	);
	useSignalEffect(() => {
		if (!strip) picked.value = views[subViewIndex(views, viewOr(props.view ?? null))]?.value ?? "";
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

			{/* #region Centre — the view toolbar: the hub's pages, or the module's sub-views */}
			{options.length > 1 && (
				<div
					id={SUB_VIEW_TOOLBAR_ID}
					class="fx-toolbar wsp-headerband__toolbar"
					role="toolbar"
					aria-label={`${model.title} views`}
					aria-controls={strip ? undefined : SUB_VIEW_PANEL_ID}
				>
					<Select
						class="ui-field--bare wsp-headerband__view"
						size="sm"
						aria-label={`${model.title} view`}
						options={options}
						value={picked}
						onValueChange={(value) => {
							if (strip) {
								// A hub option is another address, as its link tab was: go there.
								const tab = strip.tabs.find((t) => t.key === value);
								if (tab && tab.key !== strip.tabs[strip.active]?.key) {
									globalThis.location.assign(tab.href);
								}
								return;
							}
							selectModuleView(value, views);
						}}
					/>
				</div>
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
