import type { JSX } from "preact";
import type { MemberInvite, PendingStageInvite } from "../types/projects-types.ts";
import { InviteStatusTag } from "./MemberBadges.tsx";

/**
 * PendingStageInvites — a member's open stage invitations on their card or table row: "Invited to
 * {stage}" in the meta register, the Pending lifecycle tag, and an inline Cancel when the viewer may
 * withdraw it. `compact` keeps a table row to one line and folds the rest into a count.
 */
export interface PendingStageInvitesProps {
	pending: readonly PendingStageInvite[];
	compact?: boolean;
	canCancel: boolean;
	busy: ReadonlySet<string>;
	onCancel: (invite: MemberInvite) => void;
}

const CARD_LIMIT = 2;

export function PendingStageInvites(props: PendingStageInvitesProps): JSX.Element | null {
	if (props.pending.length === 0) return null;
	const limit = props.compact ? 1 : CARD_LIMIT;
	const shown = props.pending.slice(0, limit);
	const rest = props.pending.length - shown.length;
	return (
		<ul class="mem-stageinv" data-compact={props.compact ? "true" : undefined}>
			{shown.map(({ stage, invite }) => (
				<li class="mem-stageinv__item" key={invite.id}>
					<span class="mem-stageinv__text">Invited to {stage.name}</span>
					<InviteStatusTag status="pending" />
					{props.canCancel && (
						<button
							type="button"
							class="mem-stageinv__cancel"
							disabled={props.busy.has(invite.id)}
							aria-label={`Cancel the invitation to ${stage.name}`}
							onClick={() => props.onCancel(invite)}
						>
							Cancel
						</button>
					)}
				</li>
			))}
			{rest > 0 && (
				<li class="mem-stageinv__more">
					+{rest} more pending
				</li>
			)}
		</ul>
	);
}
