import type { JSX, VNode } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import {
	HourglassIcon,
	InviteIcon,
	RevisionIcon,
	ServiceRequestIcon,
	TicketIcon,
} from "./glyphs.tsx";
import type { ProjectActivity } from "../types/projects-types.ts";

/**
 * StatusIcon — the single, icon-ONLY involvement indicator pinned to the right of a card's footer. It
 * strictly renders a glyph for the viewer's current {@link ProjectActivity}; the human description is
 * revealed ONLY on hover/focus through a floating `@projective/ui` {@link Tooltip} (never inline
 * text). A tonal `data-tone` colours the glyph so states read at a glance without a label.
 */

// #region Activity vocabulary
interface ActivityMeta {
	/** The tooltip label + accessible name (the only place the text appears). */
	label: string;
	icon: VNode;
	/** Tonal key → colour via CSS (`.proj-statusicon[data-tone]`). */
	tone: string;
}

const ACTIVITY: Record<ProjectActivity, ActivityMeta> = {
	new_ticket: { label: "New ticket available", icon: TicketIcon, tone: "ticket" },
	revision_requested: { label: "Revision requested", icon: RevisionIcon, tone: "revision" },
	pending_review: { label: "Pending review", icon: HourglassIcon, tone: "pending" },
	client_invite: { label: "Client invite to project", icon: InviteIcon, tone: "invite" },
	service_request: {
		label: "Service request — awaiting your acceptance",
		icon: ServiceRequestIcon,
		tone: "request",
	},
};
// #endregion

export interface StatusIconProps {
	activity: ProjectActivity;
}

export function StatusIcon({ activity }: StatusIconProps): JSX.Element {
	const meta = ACTIVITY[activity];
	return (
		<Tooltip content={meta.label} placement="left">
			<span
				class="proj-statusicon"
				data-tone={meta.tone}
				role="img"
				aria-label={meta.label}
				tabIndex={0}
			>
				{meta.icon}
			</span>
		</Tooltip>
	);
}
