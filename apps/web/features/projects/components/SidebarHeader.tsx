import type { JSX, RefObject, VNode } from "preact";
import { useSignal } from "@preact/signals";
import { requestShare } from "@web/features/share/core/share-request.ts";
import { Popover } from "@projective/ui/feedback";
import { LaneBackLink } from "@projective/ui/navigation";
import {
	ArchiveIcon,
	BookmarkIcon,
	CloseIcon,
	ExternalLinkIcon,
	KebabIcon,
	ShareIcon,
} from "./glyphs.tsx";

/**
 * SidebarHeader — the top row of the Project Details sidebar: a Back arrow that returns to the
 * `/projects` feed, and, right-aligned inline with it, a Star toggle + a kebab (`…`) menu carrying the
 * SAME actions as the feed cards (Open in new tab · Share · Cancel · Archive project): Cancel for the
 * client side of an engagement that has not ended — a brief's owner or a bought service's client
 * (Decisions #456, #467). Kept dumb — the island owns the star state and routes the archive and the
 * cancellation; open/share resolve client-side here.
 */

/** The kebab menu actions — the feed card's `CardMenuAction` vocabulary. */
export type SidebarMenuAction = "open" | "share" | "archive" | "cancel";

interface MenuItem {
	action: SidebarMenuAction;
	label: string;
	icon: VNode;
	danger?: boolean;
}

/**
 * Only actions that DO something (root CLAUDE.md §3.11). Report and Leave are absent rather than
 * inert: neither has a backend or a product rule yet. Cancel and Archive render only when the island
 * says this viewer may take them; Cancel's label names the engagement's kind.
 */
const MENU_ITEMS: readonly MenuItem[] = [
	{ action: "open", label: "Open in new tab", icon: ExternalLinkIcon },
	{ action: "share", label: "Share", icon: ShareIcon },
	{ action: "cancel", label: "Cancel project", icon: CloseIcon, danger: true },
	{ action: "archive", label: "Archive project", icon: ArchiveIcon, danger: true },
];

/** The primary site sidebar the `bottom-end` kebab menu must never slide under (edge-detection). */
const SHELL_AVOID = [".ui-app-shell__sidebar"] as const;

export interface SidebarHeaderProps {
	/** Route slug — the Back link + the open/share targets resolve against `/projects/{slug}`. */
	slug: string;
	title: string;
	starred: boolean;
	onToggleStar: () => void;
	/** Whether the viewer holds an authority role and so is offered Archive project. */
	canArchive: boolean;
	/** Whether the viewer is the client side of an engagement that has not ended, and so may cancel it. */
	canCancel?: boolean;
	/** Cancel's label — "Cancel project" on a brief, "Cancel service" on a bought service. */
	cancelLabel?: string;
	/** Archive and Cancel are routed to the island, which confirms and writes. */
	onMenuAction?: (action: SidebarMenuAction) => void;
}

export function SidebarHeader(
	{ slug, title, starred, onToggleStar, canArchive, canCancel = false, cancelLabel, onMenuAction }:
		SidebarHeaderProps,
): JSX.Element {
	const menuOpen = useSignal(false);
	const href = `/projects/${slug}`;
	const offered = MENU_ITEMS
		.filter((mi) =>
			mi.action === "archive" ? canArchive : mi.action === "cancel" ? canCancel : true
		)
		.map((mi) => mi.action === "cancel" && cancelLabel ? { ...mi, label: cancelLabel } : mi);

	function handleMenu(action: SidebarMenuAction): void {
		menuOpen.value = false;
		if (action === "open") {
			globalThis.open?.(href, "_blank", "noopener");
			return;
		}
		if (action === "share") {
			requestShare({ href, title, noun: "project" });
			return;
		}
		onMenuAction?.(action);
	}

	return (
		<div class="proj-detail__header">
			<LaneBackLink href="/projects" label="Back to all projects" />

			<div class="proj-detail__header-actions">
				<button
					type="button"
					class="proj-detail__star"
					data-on={starred ? "true" : undefined}
					aria-pressed={starred}
					aria-label={starred ? "Remove project from saved" : "Save project"}
					onClick={onToggleStar}
				>
					{BookmarkIcon}
				</button>

				<Popover
					open={menuOpen}
					placement="bottom-end"
					avoid={SHELL_AVOID}
					allowOverflow={["bottom"]}
					class="proj-cardmenu-pop"
					trigger={(api) => (
						<button
							type="button"
							ref={api.ref as RefObject<HTMLButtonElement>}
							class="proj-detail__kebab"
							data-open={api.expanded ? "true" : undefined}
							aria-label="More actions"
							aria-haspopup="menu"
							aria-expanded={api.expanded}
							aria-controls={api.panelId}
							onClick={api.toggle}
						>
							{KebabIcon}
						</button>
					)}
				>
					<div class="proj-cardmenu" role="menu" aria-label={`Actions for ${title}`}>
						{offered.map((mi) => (
							<button
								key={mi.action}
								type="button"
								role="menuitem"
								class="ui-menu-item proj-cardmenu__item"
								data-danger={mi.danger ? "true" : undefined}
								onClick={() => handleMenu(mi.action)}
							>
								<span class="ui-menu-item__icon proj-cardmenu__icon" aria-hidden="true">
									{mi.icon}
								</span>
								<span class="proj-cardmenu__label">{mi.label}</span>
							</button>
						))}
					</div>
				</Popover>
			</div>
		</div>
	);
}
