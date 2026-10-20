import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { ConfirmDialog, Toast, Tooltip, useToast } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { ActionMenu, copyLink } from "@projective/ui/navigation";
import { BodyPortal } from "@projective/ui/overlay";
import { kindCopy, type WorkspaceDetail } from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { rosterHref } from "../core/roster-model.ts";
import { type HeaderMenuPlan, headerMenu } from "../core/header-model.ts";
import { cloneGlyph, MoreGlyph } from "../core/workspace-glyphs.tsx";

/** Props for {@link EntityMenu}. */
export interface EntityMenuProps {
	workspace: WorkspaceDetail;
	/** What the menu carries (`entityMenuPlan`). */
	plan: HeaderMenuPlan;
	/** The trigger's and the menu's accessible name ("Team actions"). */
	label: string;
	/** Where a right-click, the ContextMenu key or Shift+F10 also opens the rows (Decision #222). */
	surface?: RefObject<HTMLElement>;
	placement?: "bottom-end" | "bottom-start";
	tooltipPlacement?: "top" | "bottom" | "left" | "right";
	class?: string;
}

/**
 * EntityMenu — the entity's ONE kebab (Decision #306): View public profile · Open in new tab · Copy
 * profile link · Transfer ownership… or Leave… · Archive workspace…, the last confirmed as a danger
 * before anything changes. The lane head draws it; the header band draws the same component only where
 * the lane is off screen (collapsed, or hidden below `--bp-md`), and CSS paints exactly one, so the page
 * never offers two menus for one entity.
 *
 * Every press says what it did through a toast, mounted on first use behind a body portal (a band is a
 * size container and would re-base a fixed stack onto itself).
 */
export function EntityMenu(props: EntityMenuProps): JSX.Element {
	const ws = props.workspace;
	const copy = kindCopy(ws.kind);
	const confirmArchive = useSignal(false);
	const archiving = useSignal(false);
	const toastMounted = useSignal(false);
	const toast = useToast();

	function notify(summary: string, ok: boolean): void {
		if (!toastMounted.value && !document.querySelector(".ui-toast")) toastMounted.value = true;
		toast.show({ severity: ok ? "success" : "danger", summary });
	}

	async function archive(): Promise<void> {
		archiving.value = true;
		const res = await WorkspaceService.update({ kind: ws.kind, id: ws.id, status: "archived" });
		archiving.value = false;
		if (!res.ok) {
			notify(res.message ?? `Couldn't archive ${ws.name}. Nothing was changed.`, false);
			return;
		}
		globalThis.location.assign(rosterHref(ws.kind, "archived"));
	}

	const rows = headerMenu(props.plan, {
		copyLink: () => {
			void copyLink(props.plan.profileHref).then((ok) =>
				notify(ok ? "Profile link copied" : "Couldn't copy the profile link", ok)
			);
		},
		archive: () => {
			confirmArchive.value = true;
		},
	});

	return (
		<>
			<ActionMenu
				model={rows}
				surface={props.surface}
				placement={props.placement ?? "bottom-end"}
				avoid={[".ui-app-shell__sidebar"]}
				aria-label={props.label}
				trigger={(api) => (
					<Tooltip content={props.label} placement={props.tooltipPlacement ?? "bottom"}>
						<Button
							class={props.class}
							triggerRef={api.ref}
							variant="text"
							severity="secondary"
							size="sm"
							iconOnly
							icon={cloneGlyph(MoreGlyph)}
							aria-label={props.label}
							aria-haspopup="menu"
							aria-expanded={api.expanded}
							aria-controls={api.panelId}
							onClick={api.toggle}
						/>
					</Tooltip>
				)}
			/>
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
		</>
	);
}
