import type { JSX } from "preact";
import { batch, useSignal } from "@preact/signals";
import "../styles/workspace.css";
import { ConfirmDialog } from "@projective/ui/feedback";
import { kindCopy, type WorkspaceDetail, type WorkspaceMember } from "@projective/types/workspace";
import {
	type InviteRecipient,
	type ParsedRecipient,
	recipientAddress,
} from "@projective/types/invites";
import { absoluteUrl } from "@features/share/core/share-request.ts";
import { UniversalInviteModal } from "@features/invites/components/UniversalInviteModal.tsx";
import type { InviteSendOutcome, QueuedRecipient } from "@features/invites/core/invite-queue.ts";
import type { AccessPerson } from "@features/invites/core/access-people.ts";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import {
	closeInvite,
	inviteModalOpen,
	inviteSeedRoleId,
	openInvite,
} from "../core/workspace-state.ts";
import {
	actionInputFor,
	assignableRoles,
	grantableRoles,
	inviteManagerOverflow,
	inviteRefusalText,
	inviteRoleSeed,
	managerCapContextOf,
	managerCapNotice,
	memberAbilities,
	roleName,
	seatsFull,
	viewerRankOf,
} from "../core/members-model.ts";

/**
 * InviteModal — a team's or business's Invite, on the Universal Invite modal (Decisions #318, #405).
 *
 * The bar invites handles and emails at one role; the link row is the entity's ask-to-join link; and
 * "People with access" is the active roster, each row offering exactly what `memberAbilities` allows —
 * a role picker over `assignableRoles` where the viewer outranks the member and holds
 * `manage_roles`, and Remove where they also hold `remove_members`. Shared by teams and businesses
 * (Decision #61) and mounted on EVERY console module, so Invite opens in place wherever it is pressed
 * and nothing ever navigates to Members to open it — which is why the removal confirmation is this
 * island's own: it replaces the modal (§B.10.9), and Cancel brings the modal back.
 *
 * **The role list holds only roles the inviter may grant** — never the owner seat, never one carrying
 * a capability they lack, never one at or above their own rank (`grantableRoles`, the mirror of
 * `org.invite_workspace_member`). The plan's free seats caption the header and cap the batch; on a
 * business, a role past the plan's manager headroom closes Invite with the manager-cap notice (BU7,
 * `inviteManagerOverflow`). People already in the entity, already invited, or the entity's own handle
 * are refused before anything is sent; everything else is the server's call.
 *
 * **The link asks; it never seats**: whoever holds it may ASK to join at the link's role, and an
 * `invite_members` holder approves or declines each request in Members › Requests.
 */

export interface InviteModalProps {
	workspace: WorkspaceDetail;
	onUpdated: (next: WorkspaceDetail) => void;
}

export default function InviteModal(props: InviteModalProps): JSX.Element {
	const ws = props.workspace;
	const copy = kindCopy(ws.kind);
	const viewerRank = viewerRankOf(ws);
	const grantable = grantableRoles(ws.roles, ws.viewerCapabilities, viewerRank);
	const roles = grantable.map((r) => ({ id: r.id, name: r.name }));
	const defaultRoleId = inviteRoleSeed(grantable, inviteSeedRoleId.value);
	const memberHandles = new Set(ws.members.map((m) => m.handle.toLowerCase()));
	const pendingHandles = new Set(ws.invites.map((i) => i.handle.toLowerCase()).filter(Boolean));
	const pendingEmails = new Set(
		ws.invites.map((i) => i.email?.toLowerCase() ?? "").filter(Boolean),
	);
	const capContext = managerCapContextOf(ws);
	const viewer = ws.members.find((m) => m.isSelf) ?? null;

	// The link the modal last saw: the detail's, until an act here answers with a newer one.
	const link = useSignal(ws.inviteLink);
	const linkFor = useSignal(ws.id);
	if (linkFor.peek() !== ws.id) {
		linkFor.value = ws.id;
		link.value = ws.inviteLink;
	}
	const linkBusy = useSignal(false);
	const linkError = useSignal<string | null>(null);

	const removing = useSignal<WorkspaceMember | null>(null);
	const confirmRemove = useSignal(false);

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

	const people: AccessPerson[] = ws.members
		.filter((m) => m.state === "active")
		.map((m) => {
			const can = memberAbilities(actionInputFor(viewer, m, ws.viewerCapabilities));
			return {
				key: m.id,
				name: m.name,
				handle: m.handle || null,
				avatar: m.avatar || null,
				roleId: m.roleId,
				roleLabel: roleName(m, ws.roles),
				roles: can.edit
					? assignableRoles(ws.roles, ws.viewerCapabilities, viewerRank, m.roleId)
						.map((r) => ({ id: r.id, name: r.name }))
					: null,
				removable: can.remove,
				self: m.isSelf,
				owner: m.rolePreset === "owner",
			};
		});
	// #endregion

	// #region Transport
	async function send(recipients: InviteRecipient[]): Promise<InviteSendOutcome> {
		const res = await WorkspaceService.inviteMany({
			kind: ws.kind,
			workspaceId: ws.id,
			recipients,
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
				(sent === 0 ? null : sent === 1 ? "Invitation sent." : `${sent} invitations sent.`),
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
			if (res.ok && res.data) link.value = res.data.link;
			else linkError.value = res.message ?? "Couldn't update the invite link.";
		});
	}

	async function changeRole(memberId: string, roleId: string): Promise<string | null> {
		const res = await WorkspaceService.updateMember({
			kind: ws.kind,
			workspaceId: ws.id,
			memberId,
			roleId,
		});
		if (!res.ok || !res.data) {
			return res.errors?.member ?? res.message ?? "That role couldn't be changed.";
		}
		props.onUpdated(res.data);
		return null;
	}

	async function remove(member: WorkspaceMember): Promise<void> {
		const res = await WorkspaceService.updateMember({
			kind: ws.kind,
			workspaceId: ws.id,
			memberId: member.id,
			remove: true,
		});
		if (res.ok && res.data) props.onUpdated(res.data);
		openInvite();
	}
	// #endregion

	const current = link.value;

	return (
		<>
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
				suggest
				excludeHandles={memberHandles}
				link={grantable.length > 0
					? {
						url: current ? absoluteUrl(current.path) : null,
						roles,
						roleId: current?.roleId ?? defaultRoleId,
						onRoleChange: (id) => void act("role", id),
						busy: linkBusy.value,
						error: linkError.value,
						onEnable: () => void act("ensure", defaultRoleId ?? undefined),
						onDisable: () => void act("revoke"),
						onReset: () => void act("reset"),
					}
					: null}
				people={people}
				onRoleChange={changeRole}
				onRemove={(key) => {
					const member = ws.members.find((m) => m.id === key);
					if (!member) return;
					batch(() => {
						removing.value = member;
						inviteModalOpen.value = false;
						confirmRemove.value = true;
					});
				}}
			/>

			<ConfirmDialog
				visible={confirmRemove}
				header={`Remove ${removing.value?.name ?? "this member"}?`}
				message={`They lose access to ${ws.name} straight away. Their work stays on record — nothing is deleted — and you can invite them back.`}
				acceptLabel="Remove"
				rejectLabel="Keep them"
				acceptSeverity="danger"
				onAccept={() => {
					const member = removing.peek();
					if (member) void remove(member);
				}}
				onReject={() => openInvite()}
			/>
		</>
	);
}
