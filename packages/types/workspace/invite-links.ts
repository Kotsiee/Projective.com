import { z } from "zod";
import { InviteRecipientsSchema } from "../invites/recipients.ts";
import { WorkspaceKind } from "./common.ts";

/**
 * workspace.invite-links — a team's or business's ask-to-join link and the join requests it files,
 * plus the multi-recipient invite batch (Decision #318).
 *
 * **A link asks; it never seats.** It REVERSES the 2026-09-28 cut of share links and join requests for
 * workspaces on the same terms as a stage invite link (Decision #145): holding the URL lets a signed-in
 * person ASK to join at the role the link names, which files a pending join request; somebody holding
 * `invite_members` approves (seating them at that role, or another they may grant) or declines it. No
 * seat, wallet authority or money moves until the approval, which runs every guard an accepted
 * invitation runs (seat cap, manager cap, persona, payout readiness, adulthood).
 *
 * One active link per entity. `ensure` reads or mints it, `reset` revokes the old URL and mints a new
 * one in one transaction, `revoke` turns it off, `role` changes the role it offers. Lifecycles in
 * PRODUCT_MANAGEMENT.md §3.5: link `active → revoked` (terminal); request `pending → accepted |
 * declined | withdrawn` (all terminal).
 */

// #region Token
/**
 * A workspace link token: `w-` and 18 random bytes as unpadded base64url. The prefix keeps it apart
 * from a stage link's bare 24 characters on the one `/invite/:token` landing route.
 */
export const ORG_INVITE_LINK_TOKEN_RE = /^w-[A-Za-z0-9_-]{24}$/;

/** A syntactically valid workspace invite-link token. */
export const OrgInviteLinkTokenSchema = z.string().trim().regex(ORG_INVITE_LINK_TOKEN_RE);

/** Whether a landing token is a workspace link's (rather than a stage link's). */
export function isOrgInviteLinkToken(token: string): boolean {
	return ORG_INVITE_LINK_TOKEN_RE.test(token);
}

/** The app path a token lands on — the same route a stage link uses. */
export function orgInviteLinkPath(token: string): string {
	return `/invite/${token}`;
}
// #endregion

// #region Inviting side
/**
 * The entity's active link (`get_workspace_detail`'s `inviteLink`), answered only to an
 * `invite_members` holder; `null` for everybody else and while no link is active.
 */
export const OrgInviteLinkSchema = z.object({
	id: z.string().max(64),
	token: OrgInviteLinkTokenSchema,
	/** `/invite/{token}`; the client prefixes its own origin. */
	path: z.string().max(80),
	/** The role a request through this link asks for (a {@link WorkspaceRoleDef} id). */
	roleId: z.string().max(64),
	createdAt: z.string().max(40),
});
export type OrgInviteLink = z.infer<typeof OrgInviteLinkSchema>;

/** What the invite modal asks of the link. `role` re-points the active link at `roleId`. */
export const OrgInviteLinkAction = z.enum(["ensure", "reset", "revoke", "role"]);
export type OrgInviteLinkAction = z.infer<typeof OrgInviteLinkAction>;

/** `POST /api/workspace/invite-link`. `roleId` is required for `role`, and seeds a first mint. */
export const OrgInviteLinkActionInputSchema = z.object({
	kind: WorkspaceKind,
	workspaceId: z.string().max(64),
	action: OrgInviteLinkAction,
	roleId: z.string().max(64).optional(),
});
export type OrgInviteLinkActionInput = z.infer<typeof OrgInviteLinkActionInputSchema>;

/** The answer to a link action: the active link, or `null` once it is turned off. */
export const OrgInviteLinkResultSchema = z.object({ link: OrgInviteLinkSchema.nullable() });
export type OrgInviteLinkResult = z.infer<typeof OrgInviteLinkResultSchema>;

/**
 * A pending request to join (`get_workspace_detail`'s `joinRequests`), answered only to an
 * `invite_members` holder; `[]` for everybody else. Only `pending` rows are projected.
 */
export const WorkspaceJoinRequestSchema = z.object({
	id: z.string().max(64),
	handle: z.string().max(40),
	name: z.string().max(120),
	avatar: z.string().max(400),
	/** The role the link offered when they asked — the approval's default. */
	roleId: z.string().max(64),
	/** Their optional note, plain text. */
	message: z.string().max(400).nullable(),
	/** Pre-formatted relative time ("2 days ago"). */
	sentAt: z.string().max(40),
	/** Whether it arrived through an invite link (always, today; kept for provenance). */
	viaLink: z.boolean().default(true),
});
export type WorkspaceJoinRequest = z.infer<typeof WorkspaceJoinRequestSchema>;

/**
 * `POST /api/workspace/join-request` — approve (`accept`) or decline a pending request. An approval
 * may seat them at another role the approver may grant; absent, the request's own role.
 */
export const RespondJoinRequestInputSchema = z.object({
	kind: WorkspaceKind,
	workspaceId: z.string().max(64),
	requestId: z.string().max(64),
	accept: z.boolean(),
	roleId: z.string().max(64).optional(),
});
export type RespondJoinRequestInput = z.infer<typeof RespondJoinRequestInputSchema>;

/** `POST /api/workspace/join-request` `{ requestId, action: "withdraw" }` — the requester backs out. */
export const WithdrawJoinRequestInputSchema = z.object({
	requestId: z.string().max(64),
	action: z.literal("withdraw"),
});
export type WithdrawJoinRequestInput = z.infer<typeof WithdrawJoinRequestInputSchema>;
// #endregion

// #region Holder side
/**
 * What a workspace link means to the signed-in person holding it — `org.fn_org_invite_link_state`,
 * the one rule both the landing page and the redeem door read. Only `open` offers "Ask to join".
 * `persona`: a team takes freelancers only (Decision #228 (A)).
 */
export const OrgInviteLinkState = z.enum([
	"invalid",
	"revoked",
	"archived",
	"member",
	"invited",
	"requested",
	"persona",
	"open",
]);
export type OrgInviteLinkState = z.infer<typeof OrgInviteLinkState>;

/** The landing page's read of a workspace link. Everything but `state` is null for `invalid`. */
export const OrgInviteLinkViewSchema = z.object({
	state: OrgInviteLinkState,
	kind: WorkspaceKind.nullable(),
	workspaceName: z.string().max(120).nullable(),
	workspaceHandle: z.string().max(40).nullable(),
	workspaceAvatar: z.string().max(400).nullable(),
	roleName: z.string().max(48).nullable(),
	sharedByName: z.string().max(160).nullable(),
	sharedByHandle: z.string().max(60).nullable(),
});
export type OrgInviteLinkView = z.infer<typeof OrgInviteLinkViewSchema>;

/** The longest note a request may carry. */
export const JOIN_REQUEST_MESSAGE_MAX = 400;

/** `POST /api/workspace/invite-links/redeem` — the holder asks to join the link's entity. */
export const RedeemOrgInviteLinkSchema = z.object({
	token: OrgInviteLinkTokenSchema,
	message: z.string().max(JOIN_REQUEST_MESSAGE_MAX).default(""),
});
export type RedeemOrgInviteLink = z.infer<typeof RedeemOrgInviteLinkSchema>;

/** The request a redeemed link filed. */
export interface OrgInviteLinkRedeemed {
	id: string;
	kind: WorkspaceKind;
	workspaceHandle: string;
	status: "pending";
}
// #endregion

// #region Multi-recipient invite batch
/**
 * `POST /api/workspace/invite` — invite up to ten people in one send, each at their own role. Each
 * recipient is one `org.invite_workspace_member` call, in order; a refusal on one never unsends the
 * others. The note rides every invitation of the batch.
 */
export const InviteMembersInputSchema = z.object({
	kind: WorkspaceKind,
	workspaceId: z.string().max(64),
	recipients: InviteRecipientsSchema,
	note: z.string().max(400).optional(),
});
export type InviteMembersInput = z.infer<typeof InviteMembersInputSchema>;
