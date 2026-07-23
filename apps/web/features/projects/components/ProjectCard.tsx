import type { JSX, RefObject, VNode } from "preact";
import { useSignal } from "@preact/signals";
import { Avatar } from "@projective/ui/display";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { StatusIcon } from "./StatusIcon.tsx";
import {
	ExternalLinkIcon,
	FlagIcon,
	KebabIcon,
	LeaveIcon,
	OwnerRoleIcon,
	ShareIcon,
	StarIcon,
	TrashIcon,
	WorkerRoleIcon,
} from "./glyphs.tsx";
import { isOwnerRole } from "../types/projects-types.ts";
import type { ProjectStatus, ProjectSummary } from "../types/projects-types.ts";

/**
 * ProjectCard — one streamlined engagement card in the `/projects` lane, laid out in three strict
 * rows:
 *   Row 1 (header): the counterparty avatar (left), the title + a status dot when live/unread with the
 *     project owner's name beneath (centre), and the hover-only Star + kebab menu (right).
 *   Row 2 (metadata, conditional): a one-off deliverable shows a run-to-completion progress bar; a
 *     session-based engagement shows its next scheduled session; pipelines show nothing.
 *   Row 3 (footer): the owning team/business mark (left, shared workspaces only — hidden for
 *     individual freelancer work) and a single icon-only {@link StatusIcon} for the viewer's current
 *     involvement state (right, label on hover).
 *
 * Uses the stretched-link pattern so the whole card navigates while the star and kebab stay
 * independently clickable (§B.4: a hover/active tint + focus ring is allowed on interactive rows).
 */

// #region Status vocabulary
/** Human title for the status dot / link aria (no visible pill — the label rides `title`/aria). */
const STATUS_TITLE: Record<ProjectStatus, string> = {
	draft: "Draft",
	active: "Active",
	on_hold: "On hold",
	completed: "Completed",
	cancelled: "Cancelled",
};

/** Statuses that read as "rested" — the card dims to a low-contrast state (opacity shift, no pill). */
const RESTED = new Set<ProjectStatus>(["completed", "cancelled"]);
// #endregion

// #region Kebab menu
/** One row in the per-card action menu. `danger` styles the destructive Delete action. */
interface CardMenuItem {
	action: CardMenuAction;
	label: string;
	icon: VNode;
	danger?: boolean;
}

/** The actions offered by the kebab menu. */
export type CardMenuAction = "open" | "share" | "report" | "leave" | "delete";

const MENU_ITEMS: readonly CardMenuItem[] = [
	{ action: "open", label: "Open in new tab", icon: ExternalLinkIcon },
	{ action: "share", label: "Share", icon: ShareIcon },
	{ action: "report", label: "Report", icon: FlagIcon },
	{ action: "leave", label: "Leave project", icon: LeaveIcon },
	{ action: "delete", label: "Delete", icon: TrashIcon, danger: true },
];

/**
 * Higher-level layout zone the kebab menu must never slide under. A `bottom-end` menu triggered near
 * the far edge of the narrow middle-nav lane would otherwise clamp only to the viewport and overlap
 * the primary site sidebar; passed to the {@link Popover} edge-detection so the panel shifts clear
 * (re-measured live, so a collapsed/expanded rail stays honoured).
 */
const SHELL_AVOID = [".ui-app-shell__sidebar"] as const;
// #endregion

export interface ProjectCardProps {
	item: ProjectSummary;
	/** Whether this card is the focused engagement (drives the active surface + `aria-current`). */
	active?: boolean;
	/** Toggle the star (optimistic; real persistence lands with the live backend). */
	onToggleStar: (id: string) => void;
	/** A kebab-menu action was picked (report / leave / delete are routed to the parent to own). */
	onMenuAction?: (id: string, action: CardMenuAction) => void;
}

export function ProjectCard(
	{ item, active, onToggleStar, onMenuAction }: ProjectCardProps,
): JSX.Element {
	const menuOpen = useSignal(false);

	// The counterparty is the meaningful "other side" of the engagement (the client to a freelancer,
	// the provider to a client) — the card's primary identity; fall back to the owner when absent.
	const face = item.counterparty ?? item.owner;
	const href = `/projects/${item.slug}`;

	// A single status dot beside the title signals liveness: an unread accent takes priority, else an
	// active-engagement dot; nothing at rest.
	const showDot = item.unread || item.status === "active";
	const dotTone = item.unread ? "unread" : "active";

	// A very subtle Owner-vs-Worker marker: an authority role (owner/client/admin) owns the engagement;
	// everyone else contributes work to it. A muted icon on the secondary line, labelled on hover — it
	// informs without competing with the title (§B.6 icon-first, keep the header uncluttered).
	const isOwner = isOwnerRole(item.viewerRole);
	const roleLabel = isOwner ? "You own this project" : "You contribute to this project";

	// Row 2 metadata is format-driven: one-off → a finite progress bar; session → the next session.
	const isOneOff = item.format === "one_off";
	const isSession = item.format === "session";
	const hasProgress = isOneOff && item.totalStages !== null && item.totalStages > 0;
	const fraction = hasProgress
		? Math.max(0, Math.min(1, (item.completedStages ?? 0) / (item.totalStages as number)))
		: 0;

	// Row 3: a shared workspace (team/business/org) surfaces its owning mark; individual freelancer
	// (personal) work hides it. The footer renders when there's a mark or an involvement state to show.
	const isShared = item.scopeType !== "personal";
	const hasFooter = isShared || Boolean(item.activity);

	function handleMenu(action: CardMenuAction): void {
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
		onMenuAction?.(item.id, action);
	}

	return (
		<div
			class="proj-card"
			data-active={active ? "true" : undefined}
			data-status={item.status}
			data-rested={RESTED.has(item.status) ? "true" : undefined}
		>
			<a
				class="proj-card__link"
				href={href}
				aria-current={active ? "page" : undefined}
				aria-label={`${item.title} — ${face.name} · ${STATUS_TITLE[item.status]}`}
			>
			</a>

			{/* Row 1 — header */}
			<div class="proj-card__head">
				<span class="proj-card__lead">
					<Avatar image={face.avatar ?? undefined} label={face.name} size={40} shape="circle" />
				</span>

				<div class="proj-card__ident">
					<div class="proj-card__title-row">
						<span class="proj-card__title">{item.title}</span>
						{showDot && (
							<span
								class="proj-card__dot"
								data-tone={dotTone}
								role="status"
								aria-label={item.unread ? "Unread updates" : "Active"}
							/>
						)}
					</div>
					<span class="proj-card__owner">
						<Tooltip content={roleLabel} placement="bottom">
							<span
								class="proj-card__role"
								data-role={isOwner ? "owner" : "worker"}
								aria-label={roleLabel}
							>
								{isOwner ? OwnerRoleIcon : WorkerRoleIcon}
							</span>
						</Tooltip>
						<span class="proj-card__owner-name">{face.name}</span>
					</span>
				</div>

				<div class="proj-card__actions">
					<button
						type="button"
						class="proj-card__star"
						data-on={item.starred ? "true" : undefined}
						aria-pressed={item.starred}
						aria-label={item.starred ? "Unstar" : "Star"}
						onClick={() => onToggleStar(item.id)}
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
								class="proj-card__menu"
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
						<div class="proj-cardmenu" role="menu" aria-label={`Actions for ${item.title}`}>
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

			{/* Row 2 — conditional metadata */}
			{hasProgress && (
				<span
					class="proj-card__track"
					role="progressbar"
					aria-valuemin={0}
					aria-valuemax={item.totalStages as number}
					aria-valuenow={item.completedStages ?? 0}
					aria-label="Delivery progress"
				>
					<span
						class="proj-card__track-fill"
						style={{ inlineSize: `${Math.round(fraction * 100)}%` }}
					/>
				</span>
			)}
			{isSession && item.nextSessionLabel && (
				<p class="proj-card__session">
					<span class="proj-card__session-label">Next session</span>
					<span class="proj-card__session-value">{item.nextSessionLabel}</span>
				</p>
			)}

			{/* Row 3 — footer context */}
			{hasFooter && (
				<div class="proj-card__footer">
					{isShared && (
						<span class="proj-card__team">
							<Avatar
								label={item.scopeLabel}
								size={18}
								shape="circle"
								class="proj-card__team-avatar"
							/>
							<span class="proj-card__team-name">{item.scopeLabel}</span>
						</span>
					)}
					{item.activity && (
						<span class="proj-card__statuswrap">
							<StatusIcon activity={item.activity} />
						</span>
					)}
				</div>
			)}
		</div>
	);
}
