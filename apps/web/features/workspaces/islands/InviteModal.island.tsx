import type { JSX } from "preact";
import { batch, useSignal } from "@preact/signals";
import "../styles/workspace.css";
import { kindCopy, type WorkspaceDetail } from "@projective/types/workspace";
import {
	type InviteRecipient,
	type ParsedRecipient,
	recipientAddress,
} from "@projective/types/invites";
import { absoluteUrl } from "@features/share/core/share-request.ts";
import { UniversalInviteModal } from "@features/invites/components/UniversalInviteModal.tsx";
import { InviteLinkPanel } from "@features/invites/components/InviteLinkPanel.tsx";
import type { InviteSendOutcome, QueuedRecipient } from "@features/invites/core/invite-queue.ts";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { closeInvite, inviteModalOpen, inviteSeedRoleId } from "../core/workspace-state.ts";
import {
	grantableRoles,
	inviteManagerOverflow,
	inviteRefusalText,
	inviteRoleSeed,
	managerCapContextOf,
	managerCapNotice,
	seatsFull,
	viewerRankOf,
} from "../core/members-model.ts";

/**
 * InviteModal — a team's or business's Invite, on the Universal Invite modal (Decision #318).
 *
 * One field for handles and emails (the text decides which), a staged list where every person gets
 * their own role, and the entity's ask-to-join link underneath. Shared by teams and businesses
 * (Decision #61) and mounted on EVERY console module, so Invite opens in place wherever it is pressed
 * and nothing ever navigates to Members to open it.
 *
 * **The role list holds only roles the inviter may grant** — never the owner seat, never one carrying
 * a capability they lack, never one at or above their own rank (`grantableRoles`, the mirror of
 * `org.invite_workspace_member`). The plan's
 * free seats caption the header and cap the batch (pending invitations hold seats); on a business,
 * rows offered a manager's role past the plan's manager headroom close Send with the manager-cap
 * notice (BU7, `inviteManagerOverflow`). People already in the entity, already invited, or the
 * entity's own handle are refused before they are staged; everything else is the server's call, and
 * a refused row keeps the server's sentence.
 *
 * **The link asks; it never seats** (Decision #318): whoever holds it may ASK to join at the link's
 * role, and an `invite_members` holder approves or declines each request in Members › Requests.
 */

export interface InviteModalProps {
	workspace: WorkspaceDetail;
	onUpdated: (next: WorkspaceDetail) => void;
}

export default function InviteModal(props: InviteModalProps): JSX.Element {
	const ws = props.workspace;
	const copy = kindCopy(ws.kind);
	const grantable = grantableRoles(ws.roles, ws.viewerCapabilities, viewerRankOf(ws));
	const roles = grantable.map((r) => ({ id: r.id, name: r.name }));
	const defaultRoleId = inviteRoleSeed(grantable, inviteSeedRoleId.value);
	const memberHandles = new Set(ws.members.map((m) => m.handle.toLowerCase()));
	const pendingHandles = new Set(ws.invites.map((i) => i.handle.toLowerCase()).filter(Boolean));
	const pendingEmails = new Set(
		ws.invites.map((i) => i.email?.toLowerCase() ?? "").filter(Boolean),
	);
	const capContext = managerCapContextOf(ws);

	// The link the modal last saw: the detail's, until an act here answers with a newer one.
	const link = useSignal(ws.inviteLink);
	const linkFor = useSignal(ws.id);
	if (linkFor.peek() !== ws.id) {
		linkFor.value = ws.id;
		link.value = ws.inviteLink;
	}
	const linkRole = useSignal<string | null>(null);
	const linkBusy = useSignal(false);
	const linkError = useSignal<string | null>(null);

	// #region Rules
	function refuse(r: ParsedRecipient): string | null {
		if (r.type === "handle") {
			if (r.value === ws.handle.toLowerCase()) return `That's this ${copy.noun}'s own handle`;
			if (memberHandles.has(r.value)) return "Already a member";
			if (pendingHandles.has(r.value)) return "Already invited";
		} else if (pendingEmails.has(r.value)) {
			return "Already invited";
		}
		return null;
	}

	function queueProblem(queue: readonly QueuedRecipient[]): string | null {
		const over = inviteManagerOverflow(
			ws.kind,
			ws.managers,
			grantable,
			queue.map((r) => r.roleId),
		);
		return over > 0 ? managerCapNotice(capContext).sentence : null;
	}

	const blocked = grantable.length === 0
		? `You can offer only a role whose permissions you hold yourself, and none of this ${copy.noun}'s roles fits. Ask an admin to invite them.`
		: seatsFull(ws.seats)
		? `Every seat on the ${copy.noun}'s plan is taken or offered. Withdraw an invitation or upgrade the plan to invite someone else.`
		: null;
	// #endregion

	// #region Transport
	async function send(recipients: InviteRecipient[], note: string): Promise<InviteSendOutcome> {
		const res = await WorkspaceService.inviteMany({
			kind: ws.kind,
			workspaceId: ws.id,
			recipients,
			note: note || undefined,
		});
		if (!res.ok || !res.data) {
			const first = recipients[0] ? recipientAddress(recipients[0]) : "them";
			return {
				refused: [],
				error: inviteRefusalText(res, recipients.length === 1 ? first : "those people", capContext),
				message: null,
			};
		}
		props.onUpdated(res.data.detail);
		const sent = res.data.sent.length;
		return {
			refused: res.data.refused,
			error: null,
			message: res.message ??
				(sent === 1 ? "Invitation sent." : `${sent} invitations sent.`),
		};
	}

	async function act(
		action: "ensure" | "reset" | "revoke" | "role",
		roleId?: string,
	): Promise<void> {
		batch(() => {
			linkBusy.value = true;
			linkError.value = null;
		});
		const res = await WorkspaceService.inviteLink({
			kind: ws.kind,
			workspaceId: ws.id,
			action,
			roleId,
		});
		batch(() => {
			linkBusy.value = false;
			if (res.ok && res.data) {
				link.value = res.data.link;
				linkRole.value = null;
			} else {
				linkError.value = res.message ?? "Couldn't update the invite link.";
			}
		});
	}
	// #endregion

	const current = link.value;
	const shownRole = current?.roleId ?? linkRole.value ?? defaultRoleId;

	return (
		<UniversalInviteModal
			open={inviteModalOpen}
			targetType={ws.kind}
			targetId={ws.id}
			targetName={ws.name}
			availableRoles={roles}
			defaultRoleId={defaultRoleId}
			onClose={closeInvite}
			onSend={send}
			seats={ws.seats}
			refuse={refuse}
			queueProblem={queueProblem}
			blocked={blocked}
			allowNote
			notePlaceholder={`Come and help us on ${ws.name}`}
			suggest
			excludeHandles={memberHandles}
			footnote="Invitations last 14 days."
			link={grantable.length > 0 && (
				<InviteLinkPanel
					url={current ? absoluteUrl(current.path) : null}
					targetName={ws.name}
					roles={roles}
					roleId={shownRole}
					onRoleChange={(id) => {
						if (current) void act("role", id);
						else linkRole.value = id;
					}}
					hint={`Nobody joins by the link alone — you approve each request in Members › Requests.`}
					shareTitle={`Join ${ws.name} on Projective`}
					shareText={`You're invited to ask to join ${ws.name} on Projective.`}
					busy={linkBusy.value}
					error={linkError.value}
					onCreate={() => void act("ensure", shownRole)}
					onReset={() => void act("reset")}
					onRevoke={() => void act("revoke")}
				/>
			)}
		/>
	);
}
