import type { ComponentChildren, JSX, VNode } from "preact";
import { Button } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { MemberInvite, MemberRequest, ProjectMemberRow } from "../types/projects-types.ts";
import { inviteActionFor } from "../types/projects-types.ts";
import { ASSIGNMENT_META, inviteeLabel, roleMeta } from "../core/member-model.ts";
import type { MemberContext } from "../core/member-sections.ts";
import { canMessage, type ChatTarget } from "../core/member-chat.ts";
import { MemberCard } from "./MemberCard.tsx";
import { AttendanceTag, InviteStatusTag, RoleText } from "./MemberBadges.tsx";

/**
 * MemberSectionCards — the three sections' cards, each a composition of the one {@link MemberCard}
 * shell, plus the row-level atoms the list view shares with them (the Message button, the
 * Accept/Reject pair, the invitation's one action, the facts lines).
 *
 * What changes by section is the card's SLOTS, never its anatomy: a member shows their role, the
 * stages they hold and their workload; a request shows what was applied for and the applicant's own
 * note, and its foot is the decision; an invitation carries its lifecycle status and the single act
 * its state admits (`inviteActionFor`, Decision #116). Accept/Reject never appear on a member.
 */

// #region Shared atoms
/** The icon-only Message action — opens the viewer's conversation with the person. */
export function MessageButton(
	{ target, onMessage }: { target: ChatTarget; onMessage: (target: ChatTarget) => void },
): JSX.Element | null {
	if (!canMessage(target)) return null;
	const label = `Message ${target.name}`;
	return (
		<Tooltip content={label} placement="top">
			<button
				type="button"
				class="mem-iconbtn"
				aria-label={label}
				onClick={() => onMessage(target)}
			>
				<Icon name="message" size="sm" />
			</button>
		</Tooltip>
	);
}

/** The roster facts a member's meta line states, adapted to the engagement (see `MemberContext`). */
export function rosterFacts(member: ProjectMemberRow, context: MemberContext): string[] {
	if (context.stageChannel && member.assignment) return [ASSIGNMENT_META[member.assignment].label];
	if (!context.showStages) return [];
	return member.assignedStages.length > 0 ? member.assignedStages : ["No stage yet"];
}

/** What an application was made for — the stage, and the staffing role when one was named. */
export function requestTarget(request: MemberRequest): string {
	const stage = request.stageName ?? "the project";
	return request.roleName ? `${request.roleName} · ${stage}` : stage;
}

interface DecisionProps {
	request: MemberRequest;
	busy: boolean;
	onAccept: (request: MemberRequest) => void;
	onReject: (request: MemberRequest) => void;
}

/** The request's decision pair — Reject (secondary) and Accept (primary). */
export function RequestDecision(props: DecisionProps): JSX.Element {
	const who = props.request.applicant.name;
	return (
		<div class="mem-decide">
			<Tooltip content={`Decline ${who} — they are told, and nothing else changes`} placement="top">
				<Button
					variant="outlined"
					severity="secondary"
					size="sm"
					label="Reject"
					disabled={props.busy}
					onClick={() => props.onReject(props.request)}
				/>
			</Tooltip>
			<Tooltip content={`Confirm ${who}'s seat — you fund it next`} placement="top">
				<Button
					size="sm"
					label="Accept"
					loading={props.busy}
					disabled={props.busy}
					onClick={() => props.onAccept(props.request)}
				/>
			</Tooltip>
		</div>
	);
}

interface InviteActionProps {
	invite: MemberInvite;
	busy: boolean;
	/** An accepted invitation's member is on this roster and may be removed. */
	removable: boolean;
	onRevoke: (invite: MemberInvite) => void;
	onDismiss: (invite: MemberInvite) => void;
	onRemove: (invite: MemberInvite) => void;
}

/** The ONE act an invitation's state admits — Revoke · Dismiss · Remove — or nothing. */
export function InviteAction(props: InviteActionProps): JSX.Element | null {
	const { invite, busy } = props;
	const who = inviteeLabel(invite);
	switch (inviteActionFor(invite.status)) {
		case "cancel":
			return (
				<Tooltip content="Withdraw the offer — no re-invitation cooldown starts" placement="top">
					<Button
						variant="outlined"
						severity="secondary"
						size="sm"
						label="Cancel"
						aria-label={`Revoke the invitation to ${who}`}
						loading={busy}
						disabled={busy}
						onClick={() =>
							props.onRevoke(invite)}
					/>
				</Tooltip>
			);
		case "dismiss":
			return (
				<Tooltip content="Take it off the list — the answer is kept" placement="top">
					<Button
						variant="text"
						severity="secondary"
						size="sm"
						label="Dismiss"
						aria-label={`Dismiss the ${invite.status} invitation to ${who}`}
						loading={busy}
						disabled={busy}
						onClick={() => props.onDismiss(invite)}
					/>
				</Tooltip>
			);
		case "remove":
			if (!props.removable) return null;
			return (
				<Button
					variant="outlined"
					severity="danger"
					size="sm"
					label="Remove"
					aria-label={`Remove ${who} from ${invite.stageName ?? "the project"}`}
					disabled={busy}
					onClick={() => props.onRemove(invite)}
				/>
			);
		default:
			return null;
	}
}

/** The facts an invitation's meta line states. */
export function inviteFacts(invite: MemberInvite, showStages: boolean): string[] {
	return [
		showStages ? (invite.stageName ?? "Whole project") : "",
		`by ${invite.invitedBy}`,
		invite.invitedLabel,
		invite.placeholder && invite.status === "pending" ? "Staged until publish" : "",
	].filter((fact) => fact.length > 0);
}
// #endregion

// #region Section cards
interface RosterCardProps {
	member: ProjectMemberRow;
	context: MemberContext;
	/** Workload is a delivery fact — hidden on a conversation and a session roster. */
	showWorkload: boolean;
	actions: VNode | null;
	onOpen: (member: ProjectMemberRow) => void;
}

/** A person on the roster — role, the stages they hold, workload and join date. */
export function RosterCard(props: RosterCardProps): JSX.Element {
	const { member: m, context } = props;
	const foot: ComponentChildren[] = [];
	if (props.showWorkload) {
		foot.push(
			<span class="mem-stat" data-has={m.openTickets > 0 ? "true" : undefined} key="tickets">
				{m.openTickets > 0
					? `${m.openTickets} open ticket${m.openTickets === 1 ? "" : "s"}`
					: "No open tickets"}
			</span>,
		);
	}
	foot.push(<span class="mem-stat" key="joined">Joined {m.joinedLabel}</span>);

	return (
		<MemberCard
			person={m.party}
			seed={m.id}
			role={m.role}
			viewer={m.isViewer}
			presence={m.presence}
			status={context.session && m.attendance ? <AttendanceTag attendance={m.attendance} /> : null}
			actions={props.actions}
			headline={<RoleText role={m.role} />}
			meta={rosterFacts(m, context)}
			foot={foot}
			onOpen={() => props.onOpen(m)}
		/>
	);
}

interface RequestCardProps {
	request: MemberRequest;
	busy: boolean;
	actions: VNode | null;
	onAccept: (request: MemberRequest) => void;
	onReject: (request: MemberRequest) => void;
	onOpen: (request: MemberRequest) => void;
}

/** An open application — what was applied for, the applicant's note, and the decision. */
export function RequestCard(props: RequestCardProps): JSX.Element {
	const { request: r } = props;
	return (
		<MemberCard
			person={{ ...r.applicant, entity: r.applicantKind === "team" }}
			seed={r.id}
			actions={props.actions}
			headline={`Applied to ${requestTarget(r)}`}
			meta={[r.applicantKind === "team" ? "Team" : "Freelancer", r.appliedLabel]}
			note={r.message}
			busy={props.busy}
			foot={
				<RequestDecision
					request={r}
					busy={props.busy}
					onAccept={props.onAccept}
					onReject={props.onReject}
				/>
			}
			onOpen={() => props.onOpen(r)}
		/>
	);
}

interface InviteCardProps extends InviteActionProps {
	showStages: boolean;
	actions: VNode | null;
	onOpen: (invite: MemberInvite) => void;
}

/**
 * The person an invitation addressed, as a card identity: a platform handle reads as a name
 * (`juno-park` → "Juno Park") over its `@handle`; an email-only invitee is their address, unlinked.
 */
export function inviteePerson(
	invite: MemberInvite,
): { name: string; handle: string | null; avatar: null } {
	const handle = invite.handle?.replace(/^@+/, "") ?? null;
	const name = handle
		? handle.split(/[-_.]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1))
			.join(" ")
		: invite.email;
	return { name: name || inviteeLabel(invite), handle, avatar: null };
}

/** An invitation the project sent — its status, what it offered, and its one act. */
export function InviteCard(props: InviteCardProps): JSX.Element {
	const { invite } = props;
	return (
		<MemberCard
			person={inviteePerson(invite)}
			seed={invite.id}
			status={<InviteStatusTag status={invite.status} />}
			actions={props.actions}
			headline={`Invited as ${roleMeta(invite.role).label}`}
			meta={inviteFacts(invite, props.showStages)}
			busy={props.busy}
			foot={<InviteAction {...props} />}
			onOpen={() => props.onOpen(invite)}
		/>
	);
}
// #endregion
