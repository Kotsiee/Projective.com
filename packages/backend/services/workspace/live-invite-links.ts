import {
	type InviteMembersInput,
	type InviteMembersResult,
	type OrgInviteLinkActionInput,
	type OrgInviteLinkRedeemed,
	type OrgInviteLinkResult,
	OrgInviteLinkState,
	type OrgInviteLinkView,
	type RedeemOrgInviteLink,
	type RespondJoinRequestInput,
	type WorkspaceDetail,
	type WorkspaceKind,
} from "@projective/types/workspace";
import { type InviteRecipientRefusal, recipientAddress } from "@projective/types/invites";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { fetchPublicMedia, mediaUrl } from "../files/public-media.ts";
import { clamp } from "../../core/text.ts";
import {
	badId,
	callRpc,
	clientFor,
	type DbError,
	isUuid,
	type LiveActor,
	refusalFrom,
} from "./live-support.ts";
import { forgetDetails, readDetail } from "./live-detail.ts";
import { avatarOf, type RawInviteLink, toInviteLink } from "./mappers.ts";

/**
 * live-invite-links — the multi-recipient invite batch, a workspace's ask-to-join link, and the join
 * requests it files (Decision #318), as the caller, through the definer doors of
 * `00001020_functions_org_entities.sql` §12 / §12b.
 *
 * A link only lets its holder ASK: `org.redeem_workspace_invite_link` files a pending request, and an
 * `invite_members` holder answers it (`org.respond_to_join_request`), seating through the same
 * admission an accepted invitation runs. Writes on the inviting side answer with the RE-READ detail,
 * so the console adopts the server's queue, link and seat count.
 */

// #region Shared

/** The entity's detail after a write — fresh, never the memoised pre-write read. */
function reread(
	kind: WorkspaceKind,
	id: string,
	actor: LiveActor,
): Promise<ServiceResult<WorkspaceDetail>> {
	return readDetail(kind, id, actor, { fresh: true });
}

/**
 * The short code a refused recipient carries, from the status its refusal earned: a duplicate
 * (`409`), a full plan (`402`), an authority the inviter lacks (`403`), a nobody (`404`/`422`).
 */
export function refusalCode(status: number): string {
	switch (status) {
		case 409:
			return "duplicate";
		case 402:
			return "plan";
		case 403:
			return "forbidden";
		case 404:
			return "not_found";
		case 429:
			return "rate_limited";
		default:
			return status >= 500 ? "unavailable" : "invalid";
	}
}

// #endregion

// #region The invite batch

/**
 * Invite up to ten people in one send, each at their own role — one `org.invite_workspace_member`
 * call per recipient, in order. A refusal on one never unsends the others: the answer names what was
 * issued and what was refused, with the database's sentence. Only when NOTHING was issued is the
 * whole send a failure, carrying the first refusal's status. One re-read at the end.
 */
export async function inviteMany(
	input: InviteMembersInput,
	actor: LiveActor,
): Promise<ServiceResult<InviteMembersResult>> {
	if (!isUuid(input.workspaceId)) return badId("workspaceId", input.kind);
	const note = input.note?.trim() || null;
	const sent: string[] = [];
	const refused: InviteRecipientRefusal[] = [];
	let first: ServiceResult<never> | null = null;
	for (const recipient of input.recipients) {
		const address = recipientAddress(recipient);
		const outcome = isUuid(recipient.roleId)
			? await callRpc(actor, "org", "invite_workspace_member", {
				p_kind: input.kind,
				p_entity: input.workspaceId,
				p_handle: recipient.type === "handle" ? recipient.value : null,
				p_email: recipient.type === "email" ? recipient.value : null,
				p_role: recipient.roleId,
				p_note: note,
			})
			: { ok: false as const, refusal: badId("roleId", "role") };
		if (!outcome.ok) {
			first ??= outcome.refusal;
			refused.push({
				address,
				message: clamp(outcome.refusal.message ?? "That invitation couldn't be sent.", 240),
				code: refusalCode(outcome.refusal.status),
			});
			continue;
		}
		sent.push(address);
	}
	if (sent.length === 0 && first) {
		return fail(first.status, {
			message: first.message,
			errors: first.errors,
			details: first.details,
		});
	}
	const detail = await reread(input.kind, input.workspaceId, actor);
	if (!detail.ok || !detail.data) {
		return fail(detail.status, { message: detail.message });
	}
	const message = refused.length === 0
		? sent.length === 1 ? "Invitation sent." : `${sent.length} invitations sent.`
		: `${sent.length} sent · ${refused.length} not sent.`;
	return ok({ detail: detail.data, sent, refused }, { status: 201, message });
}

// #endregion

// #region The link (inviting side)

/**
 * Read-or-mint (`ensure`), replace (`reset`), re-point (`role`) or turn off (`revoke`) the entity's
 * ask-to-join link. `role` needs a `roleId`; `ensure` and `reset` take one as the role to mint at.
 */
export async function actOnInviteLink(
	input: OrgInviteLinkActionInput,
	actor: LiveActor,
): Promise<ServiceResult<OrgInviteLinkResult>> {
	if (!isUuid(input.workspaceId)) return badId("workspaceId", input.kind);
	if (input.roleId !== undefined && !isUuid(input.roleId)) return badId("roleId", "role");
	if (input.action === "role" && !input.roleId) {
		return fail(422, {
			message: "Choose the role the link offers.",
			errors: { roleId: "Choose the role the link offers." },
		});
	}
	if (input.action === "revoke") {
		const res = await callRpc<boolean>(actor, "org", "revoke_workspace_invite_link", {
			p_kind: input.kind,
			p_entity: input.workspaceId,
		});
		if (!res.ok) return res.refusal;
		forgetDetails(actor);
		return ok({ link: null }, { message: "Invite link turned off." });
	}
	const res = await callRpc<RawInviteLink>(actor, "org", "get_workspace_invite_link", {
		p_kind: input.kind,
		p_entity: input.workspaceId,
		p_role: input.roleId ?? null,
		p_rotate: input.action === "reset",
	});
	if (!res.ok) return res.refusal;
	forgetDetails(actor);
	const link = toInviteLink(res.data);
	if (!link) return fail(500, { message: "That couldn't be completed. Try again in a moment." });
	const message = input.action === "reset"
		? "Invite link reset — the old link no longer works."
		: input.action === "role"
		? "Invite link updated."
		: undefined;
	return ok({ link }, { message });
}

// #endregion

// #region The link (holder side)

/** The landing page's empty answer — what an unknown token means. */
export const INVALID_LINK_VIEW: OrgInviteLinkView = {
	state: "invalid",
	kind: null,
	workspaceName: null,
	workspaceHandle: null,
	workspaceAvatar: null,
	roleName: null,
	sharedByName: null,
	sharedByHandle: null,
};

/** What `org.resolve_workspace_invite_link` answers, before the avatar is resolved to a URL. */
interface RawLinkView {
	state: string;
	kind?: WorkspaceKind | null;
	workspaceName?: string | null;
	workspaceHandle?: string | null;
	workspaceAvatarFileId?: string | null;
	roleName?: string | null;
	sharedByName?: string | null;
	sharedByHandle?: string | null;
}

/** What a workspace link means to the signed-in person holding it. */
export async function resolveInviteLink(
	token: string,
	actor: LiveActor,
): Promise<ServiceResult<OrgInviteLinkView>> {
	const res = await callRpc<RawLinkView>(actor, "org", "resolve_workspace_invite_link", {
		p_token: token,
	});
	if (!res.ok) return res.refusal;
	const raw = res.data;
	const state = OrgInviteLinkState.safeParse(raw?.state);
	if (!state.success || state.data === "invalid") return ok(INVALID_LINK_VIEW);
	let avatar: string | null = null;
	if (raw.workspaceAvatarFileId) {
		const media = await fetchPublicMedia(clientFor(actor), [raw.workspaceAvatarFileId]);
		avatar = avatarOf(mediaUrl(media.get(raw.workspaceAvatarFileId), "md")) || null;
	}
	return ok({
		state: state.data,
		kind: raw.kind === "team" || raw.kind === "business" ? raw.kind : null,
		workspaceName: raw.workspaceName ? clamp(raw.workspaceName, 120) : null,
		workspaceHandle: raw.workspaceHandle ? clamp(raw.workspaceHandle, 40) : null,
		workspaceAvatar: avatar,
		roleName: raw.roleName ? clamp(raw.roleName, 48) : null,
		sharedByName: raw.sharedByName ? clamp(raw.sharedByName, 160) : null,
		sharedByHandle: raw.sharedByHandle ? clamp(raw.sharedByHandle, 60) : null,
	});
}

/** The state a redeem refusal's DETAIL names (`state=…`), or `null`. */
export function refusedState(detail: string | null | undefined): OrgInviteLinkState | null {
	const match = /state=([a-z_]+)/.exec(detail ?? "");
	const parsed = OrgInviteLinkState.safeParse(match?.[1]);
	return parsed.success ? parsed.data : null;
}

/**
 * The redeem door's refusals: a state the landing page also names keeps its status — `409` for
 * somebody already in, invited or asking; `422` for a link that is off, an archived entity or a
 * persona a team cannot take — with `details.reason` the state. Everything else (the payout gate, a
 * minor, an unknown token) is {@link refusalFrom}'s.
 */
export function redeemRefusal(error: DbError): ServiceResult<never> {
	const state = refusedState(error.details);
	if (state) {
		const status = state === "member" || state === "invited" || state === "requested" ? 409 : 422;
		return fail(status, {
			message: error.message ?? "This invite link can't be used.",
			errors: { token: state },
			details: { reason: state },
		});
	}
	return refusalFrom(error, "redeem_workspace_invite_link");
}

/** The holder asks to join: a pending request the entity's admins answer. 201; never a seat. */
export async function redeemInviteLink(
	input: RedeemOrgInviteLink,
	actor: LiveActor,
): Promise<ServiceResult<OrgInviteLinkRedeemed>> {
	const res = await callRpc<OrgInviteLinkRedeemed>(
		actor,
		"org",
		"redeem_workspace_invite_link",
		{ p_token: input.token, p_message: input.message.trim() || null },
		redeemRefusal,
	);
	if (!res.ok) return res.refusal;
	return ok({
		id: res.data.id,
		kind: res.data.kind,
		workspaceHandle: res.data.workspaceHandle,
		status: "pending",
	}, { status: 201, message: "Request sent." });
}

// #endregion

// #region Join requests

/** Approve (seating them) or decline a pending request; answers with the re-read detail. */
export async function respondToJoinRequest(
	input: RespondJoinRequestInput,
	actor: LiveActor,
): Promise<ServiceResult<WorkspaceDetail>> {
	if (!isUuid(input.workspaceId)) return badId("workspaceId", input.kind);
	if (!isUuid(input.requestId)) return badId("requestId", "request");
	if (input.roleId !== undefined && !isUuid(input.roleId)) return badId("roleId", "role");
	const res = await callRpc(actor, "org", "respond_to_join_request", {
		p_request: input.requestId,
		p_accept: input.accept,
		p_role: input.roleId ?? null,
	});
	if (!res.ok) return res.refusal;
	const detail = await reread(input.kind, input.workspaceId, actor);
	if (!detail.ok) return detail;
	return ok(detail.data!, { message: input.accept ? "Request approved." : "Request declined." });
}

/** The requester takes their own pending request back. */
export async function withdrawJoinRequest(
	requestId: string,
	actor: LiveActor,
): Promise<ServiceResult<{ id: string; status: "withdrawn" }>> {
	if (!isUuid(requestId)) return badId("requestId", "request");
	const res = await callRpc(actor, "org", "withdraw_join_request", { p_request: requestId });
	if (!res.ok) return res.refusal;
	return ok({ id: requestId, status: "withdrawn" as const }, { message: "Request withdrawn." });
}

// #endregion
