import type { JSX, RefObject, VNode } from "preact";
import { useSignal } from "@preact/signals";
import { requestShare } from "@web/features/share/core/share-request.ts";
import { Popover } from "@projective/ui/feedback";
import { BackIcon } from "./detail-glyphs.tsx";
import { ArchiveIcon, ExternalLinkIcon, KebabIcon, ShareIcon, StarIcon } from "./glyphs.tsx";

/**
 * SidebarHeader — the top row of the Project Details sidebar: a Back arrow that returns to the
 * `/projects` feed, and, right-aligned inline with it, a Star toggle + a kebab (`…`) menu carrying the
 * SAME actions as the feed cards (Open in new tab · Share · Archive project). Kept dumb — the island
 * owns the star state and routes the archive; open/share resolve client-side here.
 */

/** The kebab menu actions — identical vocabulary to the feed card's `CardMenuAction`. */
export type SidebarMenuAction = "open" | "share" | "archive";

interface MenuItem {
	action: SidebarMenuAction;
	label: string;
	icon: VNode;
	danger?: boolean;
	/** Offered only when the island says the viewer may archive (an authority role). */
	ownerOnly?: boolean;
}

/**
 * Only actions that DO something (root CLAUDE.md §3.11). Report and Leave are absent rather than
 * inert: neither has a backend or a product rule yet.
 */
const MENU_ITEMS: readonly MenuItem[] = [
	{ action: "open", label: "Open in new tab", icon: ExternalLinkIcon },
	{ action: "share", label: "Share", icon: ShareIcon },
	{ action: "archive", label: "Archive project", icon: ArchiveIcon, danger: true, ownerOnly: true },
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
	/** Archive is routed to the island, which confirms and writes. */
	onMenuAction?: (action: SidebarMenuAction) => void;
}

export function SidebarHeader(
	{ slug, title, starred, onToggleStar, canArchive, onMenuAction }: SidebarHeaderProps,
): JSX.Element {
	const menuOpen = useSignal(false);
	const href = `/projects/${slug}`;

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
			<a class="proj-detail__back" href="/projects" aria-label="Back to all projects">
				<span class="proj-detail__back-icon" aria-hidden="true">{BackIcon}</span>
				<span class="proj-detail__back-label">Back</span>
			</a>

			<div class="proj-detail__header-actions">
				<button
					type="button"
					class="proj-detail__star"
					data-on={starred ? "true" : undefined}
					aria-pressed={starred}
					aria-label={starred ? "Unstar project" : "Star project"}
					onClick={onToggleStar}
				>
					{StarIcon}
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
						{MENU_ITEMS.filter((mi) => !mi.ownerOnly || canArchive).map((mi) => (
							<button
								key={mi.action}
								type="button"
								role="menuitem"
								class="proj-cardmenu__item"
								data-danger={mi.danger ? "true" : undefined}
								onClick={() => handleMenu(mi.action)}
							>
								<span class="proj-cardmenu__icon" aria-hidden="true">{mi.icon}</span>
								<span class="proj-cardmenu__label">{mi.label}</span>
							</button>
						))}
					</div>
				</Popover>
			</div>
		</div>
	);
}
