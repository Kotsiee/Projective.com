import type { JSX, VNode } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { InviteIcon, RevisionIcon, TicketIcon } from "./glyphs.tsx";
import type { StageActivity } from "../types/projects-types.ts";

/**
 * StageStatusIcon — the tiny icon-ONLY signal pinned beside a stage channel's name. Like the feed
 * card's {@link StatusIcon}, it renders a glyph for the stage's {@link StageActivity} and reveals the
 * human description ONLY on hover/focus through the portal-based `@projective/ui` {@link Tooltip} —
 * never inline text. A tonal `data-tone` colours the glyph so states read at a glance.
 */

// #region Activity vocabulary
interface StageActivityMeta {
	/** Tooltip label + accessible name (the sole place the text appears). */
	label: string;
	icon: VNode;
	/** Tonal key → colour via CSS (`.proj-statusicon[data-tone]`, shared with the card icon). */
	tone: string;
}

const STAGE_ACTIVITY: Record<StageActivity, StageActivityMeta> = {
	new_ticket: { label: "New ticket available", icon: TicketIcon, tone: "ticket" },
	revision_requested: { label: "Revision requested", icon: RevisionIcon, tone: "revision" },
	stage_invite: { label: "Request to join this stage", icon: InviteIcon, tone: "invite" },
};
// #endregion

export interface StageStatusIconProps {
	activity: StageActivity;
}

export function StageStatusIcon({ activity }: StageStatusIconProps): JSX.Element {
	const meta = STAGE_ACTIVITY[activity];
	return (
		<Tooltip content={meta.label} placement="top">
			<span
				class="proj-statusicon proj-statusicon--sm"
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
