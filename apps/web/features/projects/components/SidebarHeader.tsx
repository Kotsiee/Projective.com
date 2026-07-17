import type { JSX, RefObject, VNode } from "preact";
import { useSignal } from "@preact/signals";
import { Popover } from "@projective/ui/feedback";
import { BackIcon } from "./detail-glyphs.tsx";
import {
	ExternalLinkIcon,
	FlagIcon,
	KebabIcon,
	LeaveIcon,
	ShareIcon,
	StarIcon,
	TrashIcon,
} from "./glyphs.tsx";

/**
 * SidebarHeader — the top row of the Project Details sidebar: a Back arrow that returns to the
 * `/projects` feed, and, right-aligned inline with it, a Star toggle + a kebab (`…`) menu carrying the
 * SAME actions as the feed cards (Open in new tab · Share · Report · Leave · Delete). Kept dumb — the
 * island owns the star state and routes destructive actions; open/share resolve client-side here.
 */

/** The kebab menu actions — identical vocabulary to the feed card's {@link CardMenuAction}. */
export type SidebarMenuAction = "open" | "share" | "report" | "leave" | "delete";

interface MenuItem {
	action: SidebarMenuAction;
	label: string;
	icon: VNode;
	danger?: boolean;
}

const MENU_ITEMS: readonly MenuItem[] = [
	{ action: "open", label: "Open in new tab", icon: ExternalLinkIcon },
	{ action: "share", label: "Share", icon: ShareIcon },
	{ action: "report", label: "Report", icon: FlagIcon },
	{ action: "leave", label: "Leave project", icon: LeaveIcon },
	{ action: "delete", label: "Delete", icon: TrashIcon, danger: true },
];

/** The primary site sidebar the `bottom-end` kebab menu must never slide under (edge-detection). */
const SHELL_AVOID = [".ui-app-shell__sidebar"] as const;

export interface SidebarHeaderProps {
	/** Route slug — the Back link + the open/share targets resolve against `/projects/{slug}`. */
	slug: string;
	title: string;
	starred: boolean;
	onToggleStar: () => void;
	/** Report / Leave / Delete are routed to the island (need confirmation + the live backend). */
	onMenuAction?: (action: SidebarMenuAction) => void;
}

export function SidebarHeader(
	{ slug, title, starred, onToggleStar, onMenuAction }: SidebarHeaderProps,
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
			try {
				const url = new URL(href, globalThis.location?.origin ?? "").href;
				void globalThis.navigator?.clipboard?.writeText(url);
			} catch { /* clipboard unavailable — non-fatal */ }
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
						{MENU_ITEMS.map((mi) => (
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
