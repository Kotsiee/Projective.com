import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { useSignal, useSignalEffect } from "@preact/signals";
import "../styles/workspace.css";
import { MetaLine } from "@projective/ui/display";
import { ConfirmDialog, Toast, Tooltip, useToast } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { absoluteHref, ActionMenu, copyLink, TabMenu } from "@projective/ui/navigation";
import { BodyPortal } from "@projective/ui/overlay";
import {
	kindCopy,
	workspaceBase,
	type WorkspaceDetail,
	type WorkspaceKind,
} from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { moduleFor, type ModuleKey } from "../core/module-registry.tsx";
import { headerBand, headerMenu, type ModuleCommit } from "../core/header-model.ts";
import {
	SUB_VIEW_PANEL_ID,
	SUB_VIEW_TABS_ID,
	subViewIndex,
	subViewsFor,
} from "../core/sub-views.ts";
import { liveDetail, moduleCommit, selectModuleView, viewOr } from "../core/workspace-state.ts";
import { cloneGlyph, KebabGlyph, ShareGlyph } from "../core/workspace-glyphs.tsx";

/**
 * WorkspaceHeaderBand — the middle-nav frame's header band on a `/teams/[handle]` or
 * `/businesses/[handle]` console, laid out as Decision #220's three-region band (the catalogue's
 * `.cat-band`):
 *
 *   - **Identity, start** — the module's title in the title register over one `MetaLine` (the entity's
 *     name and `@handle`, and the acting state), so whose console this is is never a guess.
 *   - **Sub-views, centred** — the module's `TabMenu`, only when the module partitions its body
 *     (`sub-views.ts`). The tabs write the ONE sub-view state (`selectModuleView`) the lane's context
 *     control and the footer rig's Org chart toggle also write, and the body reads; the address keeps
 *     `?view=` in step.
 *   - **Actions, end** — at most ONE filled control (the module's commit, published through
 *     `workspace-state`), the tier-4 Share profile, then the kebab (`ActionMenu`) carrying the rest:
 *     View public profile, Open in new tab, Copy handle, the way to leave, and Archive… for an
 *     `archive_entity` holder (on a business, only when the server's `viewerCan.archive` says no
 *     blocker stands in the way), confirmed as a danger before anything changes.
 *
 * Right-click, the ContextMenu key and Shift+F10 anywhere on the band open the kebab's rows (Decision
 * #222's `surface`). Every rule above — which regions exist, which actions, how many fill — is
 * `header-model.ts`, pinned by its unit test; this island only renders it.
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
}

export default function WorkspaceHeaderBand(props: WorkspaceHeaderBandProps): JSX.Element {
	// #region State
	const { kind, module } = props;
	const published = liveDetail.value;
	const ws = published && published.id === props.workspace.id ? published : props.workspace;
	const copy = kindCopy(kind);
	const bandRef = useRef<HTMLDivElement>(null);
	const confirmArchive = useSignal(false);
	const archiving = useSignal(false);
	/**
	 * The toast stack, mounted on first use and only when no other island has put one up — and through
	 * a body portal, because the band is a size container and would re-base a fixed stack onto itself.
	 */
	const toastMounted = useSignal(false);
	const toast = useToast();
	// #endregion

	// #region The model
	const views = subViewsFor(module, kind, ws.viewerCapabilities);
	const view = viewOr(props.view ?? null);
	const self = ws.members.find((m) => m.id === ws.viewerMemberId);
	const model = headerBand({
		kind,
		title: moduleFor(module)?.label ?? copy.Noun,
		module,
		name: ws.name,
		handle: ws.handle,
		status: ws.status,
		acting: ws.isActing,
		owner: self?.rolePreset === "owner",
		capabilities: ws.viewerCapabilities,
		viewerCanArchive: ws.viewerCan?.archive ?? null,
		archiveBlocked: ws.archiveBlockers.length > 0,
		subViews: views,
		view,
		commit: moduleCommit.value,
	});

	// The TabMenu binds a writable index; it follows the shared sub-view whichever root picked it.
	const activeTab = useSignal(model.tabs?.active ?? 0);
	useSignalEffect(() => {
		activeTab.value = subViewIndex(views, viewOr(props.view ?? null));
	});
	// #endregion

	// #region Actions
	/**
	 * Say what an action did — a silent press reads as a dead control. A failure is a danger toast,
	 * which the stack announces as an alert.
	 */
	function notify(detail: string, ok: boolean): void {
		if (!toastMounted.value && !document.querySelector(".ui-toast")) toastMounted.value = true;
		toast.show({ severity: ok ? "success" : "danger", summary: detail });
	}

	/**
	 * Share the public profile: the device's share sheet where there is one, otherwise the link is
	 * copied — so the press always does something.
	 */
	async function shareProfile(href: string): Promise<void> {
		const share = globalThis.navigator?.share;
		if (typeof share === "function") {
			try {
				await share.call(globalThis.navigator, { title: ws.name, url: absoluteHref(href) });
				return;
			} catch (error) {
				if (error instanceof Error && error.name === "AbortError") return;
			}
		}
		const ok = await copyLink(href);
		notify(ok ? "Profile link copied" : "Couldn't copy the profile link", ok);
	}

	/** Write `@handle` to the clipboard. */
	async function copyHandle(text: string): Promise<void> {
		let ok = false;
		try {
			await globalThis.navigator.clipboard.writeText(text);
			ok = true;
		} catch { /* reported below */ }
		notify(ok ? `${text} copied` : "Couldn't copy the handle", ok);
	}

	/**
	 * Archive the entity. Nothing is deleted — it leaves the active roster and stays restorable from the
	 * Archived tab, which is where the reader lands once it is done.
	 */
	async function archive(): Promise<void> {
		archiving.value = true;
		const res = await WorkspaceService.update({ kind, id: ws.id, status: "archived" });
		archiving.value = false;
		if (!res.ok) {
			notify(res.message ?? `Couldn't archive ${ws.name}. Nothing was changed.`, false);
			return;
		}
		globalThis.location.assign(`${workspaceBase(kind)}?tab=archived`);
	}
	// #endregion

	// #region The kebab
	const menu = headerMenu(model, {
		copyHandle: () => void copyHandle(model.menu.handleText),
		archive: () => {
			confirmArchive.value = true;
		},
	});
	// #endregion

	return (
		<div ref={bandRef} class="wsp-headerband" data-kind={kind}>
			{/* #region Start — identity */}
			<div class="wsp-headerband__start">
				<div class="wsp-headerband__id">
					<h2 class="wsp-headerband__title">{model.title}</h2>
					<MetaLine as="p" size="xs" class="wsp-headerband__meta" items={model.meta} />
				</div>
			</div>
			{/* #endregion */}

			{/* #region Centre — sub-view tabs */}
			{model.tabs && (
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

				{model.utilities.map((utility) => (
					<span key={utility.key} class="wsp-headerband__utility">
						<Button
							class="wsp-headerband__utility-wide"
							severity="neutral"
							variant="outlined"
							size="sm"
							icon={cloneGlyph(ShareGlyph)}
							label={utility.label}
							onClick={() => void shareProfile(utility.href)}
						/>
						<Tooltip content={utility.label} placement="bottom">
							<Button
								class="wsp-headerband__utility-narrow"
								severity="neutral"
								variant="outlined"
								size="sm"
								iconOnly
								icon={cloneGlyph(ShareGlyph)}
								aria-label={utility.label}
								onClick={() => void shareProfile(utility.href)}
							/>
						</Tooltip>
					</span>
				))}

				<ActionMenu
					model={menu}
					surface={bandRef}
					placement="bottom-end"
					avoid={[".ui-app-shell__sidebar"]}
					aria-label={model.menuLabel}
					trigger={(api) => (
						<Tooltip content={model.menuLabel} placement="bottom">
							<Button
								triggerRef={api.ref}
								variant="text"
								severity="secondary"
								size="sm"
								iconOnly
								icon={cloneGlyph(KebabGlyph)}
								aria-label={model.menuLabel}
								aria-haspopup="menu"
								aria-expanded={api.expanded}
								aria-controls={api.panelId}
								onClick={api.toggle}
							/>
						</Tooltip>
					)}
				/>
			</div>
			{/* #endregion */}

			{/* #region Overlays */}
			<ConfirmDialog
				visible={confirmArchive}
				header={`Archive ${ws.name}?`}
				message={`It leaves your active ${copy.plural} and stops taking new work. Nothing is deleted — you can restore it from the Archived tab.`}
				acceptLabel={archiving.value ? "Archiving…" : "Archive"}
				rejectLabel="Keep it"
				acceptSeverity="danger"
				onAccept={() => void archive()}
			/>

			{toastMounted.value && (
				<BodyPortal>
					<Toast position="bottom-center" />
				</BodyPortal>
			)}
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
