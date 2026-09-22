import type { JSX } from "preact";
import { Tag } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { Icon, type IconName } from "@projective/ui/icons";
import type { Severity } from "@projective/ui/fields";
import type { InviteStatus, MemberInvite, MemberViewerCaps } from "../types/projects-types.ts";
import { inviteActionFor } from "../types/projects-types.ts";
import { MemberRoleBadge } from "./MemberBadges.tsx";

/**
 * InvitationList — the Invitations region of the Members tab: every invitation the roster carries
 * for THIS scope (the fat service has already narrowed a stage page to its own stage), each with its
 * lifecycle badge and the ONE action its state admits.
 *
 * The action vocabulary is `inviteActionFor`'s, read from the SSOT rather than restated here, so a
 * control is never offered for a state the write refuses: an open offer can be **cancelled**, an
 * answered or lapsed record **dismissed**, and an accepted one has its **freelancer removed** — which
 * is a roster act, so it is only offered when the accepted record still points at a member the
 * viewer can see. Every control is icon-only with a portal `Tooltip` and an `aria-label` (§B.6, never
 * a native `title`).
 *
 * The status badge is the one container on the row — a lifecycle status is exactly what §B.11
 * reserves containers for. The invitee, the stage, the inviter and the age are inline
 * `--text-secondary` text separated by middots, never chips.
 *
 * Presentation only: every mutation flows through the injected callbacks, and the island owns the
 * optimistic list.
 */
export interface InvitationListProps {
	invites: MemberInvite[];
	caps: MemberViewerCaps;
	/** Whether the viewer is looking at one stage — decides the empty copy, not the rows. */
	stageScoped: boolean;
	/** Whether an accepted invitation's member can be resolved on this roster (has a row to remove). */
	canRemove: (invite: MemberInvite) => boolean;
	onCancel: (invite: MemberInvite) => void;
	onDismiss: (invite: MemberInvite) => void;
	onRemove: (invite: MemberInvite) => void;
	/** Ids with a write in flight — their control is disabled while the server answers. */
	busy: ReadonlySet<string>;
}

/** The badge vocabulary — label + tint per lifecycle state. */
const STATUS_META: Record<InviteStatus, { label: string; severity: Severity }> = {
	pending: { label: "Pending", severity: "info" },
	accepted: { label: "Accepted", severity: "success" },
	declined: { label: "Declined", severity: "danger" },
	expired: { label: "Expired", severity: "warning" },
};

/** The lifecycle badge — a status IS a container's licence (§B.11.3). */
export function InviteStatusBadge({ status }: { status: InviteStatus }): JSX.Element {
	const meta = STATUS_META[status];
	return (
		<Tag
			value={meta.label}
			severity={meta.severity}
			variant="subtle"
			rounded
			class={`mem-invites__status mem-invites__status--${status}`}
		/>
	);
}

interface RowActionProps {
	icon: IconName;
	label: string;
	danger?: boolean;
	disabled: boolean;
	onClick: () => void;
}

/** One icon-only row control: tooltip + accessible name, soft circular hover (the `mem-iconbtn` idiom). */
function RowAction({ icon, label, danger, disabled, onClick }: RowActionProps): JSX.Element {
	return (
		<Tooltip content={label} placement="top">
			<button
				type="button"
				class={danger ? "mem-iconbtn mem-iconbtn--danger" : "mem-iconbtn"}
				aria-label={label}
				disabled={disabled}
				onClick={onClick}
			>
				<Icon name={icon} size="sm" />
			</button>
		</Tooltip>
	);
}

/** The person an invitation addressed, as the row prints them — the `@handle` or the address. */
function inviteeLabel(invite: MemberInvite): string {
	return invite.handle ?? invite.email;
}

export function InvitationList(props: InvitationListProps): JSX.Element {
	const { invites, caps, stageScoped, busy } = props;

	return (
		<section class="mem-invites" aria-labelledby="mem-invites-title">
			<div class="mem-invites__head">
				<h3 class="mem-invites__title" id="mem-invites-title">
					Invitations
					<span class="mem-invites__count" aria-label={`${invites.length} invitations`}>
						{invites.length}
					</span>
				</h3>
				<p class="mem-invites__sub">
					{stageScoped
						? "People invited to this stage, and where each invitation stands."
						: "Everyone invited to this project, and where each invitation stands."}
				</p>
			</div>

			{invites.length === 0
				? (
					<p class="mem-invites__empty" role="status">
						{stageScoped
							? "Nobody has been invited to this stage yet."
							: "No invitations yet — Invite someone to get started."}
					</p>
				)
				: (
					<ul class="mem-invites__list">
						{invites.map((invite) => {
							const action = inviteActionFor(invite.status);
							const who = inviteeLabel(invite);
							const wait = busy.has(invite.id);
							const removable = action === "remove" && caps.canRemove && props.canRemove(invite);
							return (
								<li key={invite.id} class="mem-invites__row" data-status={invite.status}>
									<div class="mem-invites__main">
										<span class="mem-invites__who">{who}</span>
										<span class="mem-invites__meta">
											<MemberRoleBadge role={invite.role} />
											<InviteStatusBadge status={invite.status} />
											{invite.placeholder && invite.status === "pending" && (
												<span class="mem-invites__note">staged until publish</span>
											)}
										</span>
										<span class="mem-invites__facts">
											{invite.stageName
												? <span>{invite.stageName}</span>
												: <span>Whole project</span>}
											<span aria-hidden="true">·</span>
											<span>Invited by {invite.invitedBy}</span>
											<span aria-hidden="true">·</span>
											<span>{invite.invitedLabel}</span>
											{invite.status === "declined" && invite.declinedAt && (
												<>
													<span aria-hidden="true">·</span>
													<span>Declined {dateLabel(invite.declinedAt)}</span>
												</>
											)}
											{invite.status === "accepted" && invite.acceptedAt && (
												<>
													<span aria-hidden="true">·</span>
													<span>Joined {dateLabel(invite.acceptedAt)}</span>
												</>
											)}
										</span>
									</div>
									<div class="mem-invites__actions">
										{action === "cancel" && caps.canInvite && (
											<RowAction
												icon="close"
												label={`Cancel the invitation to ${who}`}
												disabled={wait}
												onClick={() => props.onCancel(invite)}
											/>
										)}
										{action === "dismiss" && caps.canInvite && (
											<RowAction
												icon="archive-box"
												label={`Dismiss this ${invite.status} invitation to ${who}`}
												disabled={wait}
												onClick={() => props.onDismiss(invite)}
											/>
										)}
										{removable && (
											<RowAction
												icon="user-minus"
												// The removal's scope is the INVITATION's, on every page: a stage invitation is undone
												// by unassigning from that stage, a whole-project one by leaving the project. The
												// label says which, so a project-page reader is not promised a removal the dialog
												// then narrows to one stage.
												label={`Remove ${who} from ${invite.stageName ?? "the project"}`}
												danger
												disabled={wait}
												onClick={() => props.onRemove(invite)}
											/>
										)}
									</div>
								</li>
							);
						})}
					</ul>
				)}
		</section>
	);
}

/** "12 Jul 2026" from an ISO instant — UTC-derived so SSR and the client agree (the roster's convention). */
function dateLabel(iso: string): string {
	const at = new Date(iso);
	if (!Number.isFinite(at.getTime())) return "";
	return at.toLocaleDateString("en-GB", {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	});
}
