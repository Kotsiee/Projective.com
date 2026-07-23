import type { JSX, VNode } from "preact";
import { Avatar } from "@projective/ui/display";
import type { MemberScope, ProjectMemberRow } from "../types/projects-types.ts";
import { AssignmentTag, MemberRoleBadge, PresenceDot } from "./MemberBadges.tsx";
import { MailIcon, TicketIcon } from "./glyphs.tsx";

/**
 * MemberCard — the card presentation of a roster participant (the grid view, task §2.1). The same data
 * as {@link MemberTable} in a comfortable card: a large avatar with a presence dot, the name/handle +
 * "You" marker, the role badge, the stage relationship (Assignment tag on a stage channel · assigned-
 * stage chips otherwise), and a foot with the contact + workload + join date. The actions menu (when the
 * viewer manages) is pinned top-right via the injected {@link MemberCardProps.actions} slot. Presentation
 * only — zero client JS of its own.
 */
export interface MemberCardProps {
	member: ProjectMemberRow;
	scope: MemberScope;
	stageChannel: boolean;
	/** The per-row actions menu, or null when the row isn't manageable. */
	actions?: VNode | null;
}

export function MemberCard(props: MemberCardProps): JSX.Element {
	const { member: m, scope, stageChannel } = props;
	const stageCol = scope === "channel" && stageChannel;

	return (
		<article class="mem-card" data-viewer={m.isViewer ? "true" : undefined}>
			<header class="mem-card__head">
				<span class="mem-card__avatar">
					<Avatar image={m.party.avatar ?? undefined} label={m.party.name} size="lg" />
					<PresenceDot presence={m.presence} />
				</span>
				<div class="mem-card__id">
					<span class="mem-card__name">
						{m.party.name}
						{m.isViewer && <span class="mem-identity__you">You</span>}
					</span>
					{m.party.handle && <span class="mem-card__handle">@{m.party.handle}</span>}
					<span class="mem-card__role">
						<MemberRoleBadge role={m.role} />
					</span>
				</div>
				{props.actions && <div class="mem-card__actions">{props.actions}</div>}
			</header>

			<div class="mem-card__assign">
				{stageCol
					? (m.assignment
						? <AssignmentTag assignment={m.assignment} />
						: <span class="mem-dash">No assignment</span>)
					: (m.assignedStages.length > 0
						? (
							<span class="mem-stages">
								{m.assignedStages.map((s) => <span key={s} class="mem-stagechip">{s}</span>)}
							</span>
						)
						: <span class="mem-dash">No stage assignments</span>)}
			</div>

			<footer class="mem-card__foot">
				<a class="mem-card__contact" href={`mailto:${m.email}`}>
					<span class="mem-card__foot-icon" aria-hidden="true">{MailIcon}</span>
					<span class="mem-card__contact-email">{m.email}</span>
				</a>
				<span class="mem-card__meta">
					<span class="mem-tickets" data-has={m.openTickets > 0 ? "true" : undefined}>
						<span class="mem-card__foot-icon" aria-hidden="true">{TicketIcon}</span>
						{m.ticketsLabel}
					</span>
					<span class="mem-card__joined">Joined {m.joinedLabel}</span>
				</span>
			</footer>
		</article>
	);
}
