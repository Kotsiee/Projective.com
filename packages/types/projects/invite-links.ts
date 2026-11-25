import { z } from "zod";
import { HIRE_MESSAGE_MAX } from "./hire.ts";

/**
 * projects.invite-links — a stage's shareable invite link (Decision #145).
 *
 * Holding a link grants nothing: redeeming it files a pending request on the stage
 * (`projects.redeem_invite_link`), which the project's owner, admins and managers answer from the
 * Members tab's Requests section. One active link per stage; resetting revokes the old URL in the
 * same transaction that mints the new one. Lifecycle `active → revoked` (terminal), recorded in
 * PRODUCT_MANAGEMENT.md §3.5.
 */

// #region Token
/** A link token as `projects.get_stage_invite_link` mints it: 18 random bytes, unpadded base64url. */
export const INVITE_LINK_TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;

/** A syntactically valid invite-link token. */
export const InviteLinkTokenSchema = z.string().trim().regex(INVITE_LINK_TOKEN_RE);

/** The app path a token lands on — the one place the URL shape is spelled. */
export function inviteLinkPath(token: string): string {
	return `/invite/${token}`;
}
// #endregion

// #region Manager side
/** A stage's active invite link, as the share bar shows it. */
export const StageInviteLinkSchema = z.object({
	id: z.string().min(1).max(120),
	token: InviteLinkTokenSchema,
	stageId: z.string().min(1).max(120),
	/** The app path (`/invite/{token}`); the client prefixes its own origin. */
	path: z.string().min(1).max(160),
	createdAt: z.string(),
});
export type StageInviteLink = z.infer<typeof StageInviteLinkSchema>;

/** What the share bar asks of a stage's link: mint-or-read it, replace it, or turn it off. */
export const InviteLinkAction = z.enum(["ensure", "reset", "revoke"]);
export type InviteLinkAction = z.infer<typeof InviteLinkAction>;

/** `POST /api/projects/[id]/stages/[stageId]/invite-link`. */
export const InviteLinkActionInputSchema = z.object({
	projectId: z.string().trim().min(1).max(120),
	stageId: z.string().trim().min(1).max(120),
	action: InviteLinkAction,
});
export type InviteLinkActionInput = z.infer<typeof InviteLinkActionInputSchema>;

/** The answer to a link read or action: the active link, or `null` when the stage has none. */
export interface InviteLinkResult {
	link: StageInviteLink | null;
}
// #endregion

// #region Holder side
/**
 * What a link means to the signed-in person holding it — `projects.fn_invite_link_state`, the one
 * rule both the landing page and the redeem door read. Only `open` offers "Ask to join".
 */
export const InviteLinkState = z.enum([
	"invalid",
	"revoked",
	"closed",
	"manager",
	"member",
	"invited",
	"requested",
	"no_profile",
	"open",
]);
export type InviteLinkState = z.infer<typeof InviteLinkState>;

/** The landing page's read of a link. Everything but `state` is null for an `invalid` token. */
export const InviteLinkViewSchema = z.object({
	state: InviteLinkState,
	projectSlug: z.string().max(120).nullable(),
	projectTitle: z.string().max(160).nullable(),
	stageSlug: z.string().max(120).nullable(),
	stageName: z.string().max(120).nullable(),
	sharedByName: z.string().max(160).nullable(),
	sharedByHandle: z.string().max(60).nullable(),
});
export type InviteLinkView = z.infer<typeof InviteLinkViewSchema>;

/** `POST /api/projects/invite-links/redeem` — the holder asks to join the link's stage. */
export const RedeemInviteLinkSchema = z.object({
	token: InviteLinkTokenSchema,
	/** An optional note to the managers, plain text; PII-masked during the protected phase. */
	message: z.string().max(HIRE_MESSAGE_MAX).default(""),
});
export type RedeemInviteLink = z.infer<typeof RedeemInviteLinkSchema>;

/** The request a redeemed link filed. */
export interface InviteLinkRedeemed {
	id: string;
	projectSlug: string;
	stageId: string;
	status: "pending";
}
// #endregion

// #region Email invitations (PROJECTS NO1)
/**
 * An email invitation's own token, as `projects.invite_by_email` mints it: 32 random bytes in
 * lowercase hex. Its link is the same `/invite/{token}` path a stage link uses ({@link inviteLinkPath});
 * the shape alone tells the page whose token it is.
 */
export const EMAIL_INVITATION_TOKEN_RE = /^[0-9a-f]{64}$/;

/** A syntactically valid email-invitation token. */
export const EmailInvitationTokenSchema = z.string().trim().regex(EMAIL_INVITATION_TOKEN_RE);

/**
 * What an email invitation's link means to the signed-in reader (`projects.email_invitation`). The
 * token answers only for the account that holds the invited address verified: anyone else reads
 * `not_yours`, with a masked hint of the address and nothing to act on.
 */
export const EmailInvitationState = z.enum([
	"invalid",
	"not_yours",
	"open",
	"accepted",
	"declined",
	"expired",
	"withdrawn",
]);
export type EmailInvitationState = z.infer<typeof EmailInvitationState>;

/** The landing page's read of an email invitation. `projectSlug` is null unless it is the reader's. */
export const EmailInvitationViewSchema = z.object({
	state: EmailInvitationState,
	projectSlug: z.string().max(120).nullable(),
	projectTitle: z.string().max(160).nullable(),
	stageName: z.string().max(120).nullable(),
	inviterName: z.string().max(160).nullable(),
	/** The role the invitation offers (`project_invitations.role`). */
	role: z.string().max(20).nullable(),
	/** `j•••@example.com`, on `not_yours` only: which address to sign in with. */
	addressHint: z.string().max(170).nullable(),
	expiresAt: z.string().nullable(),
});
export type EmailInvitationView = z.infer<typeof EmailInvitationViewSchema>;

/** `POST /api/projects/invites/email` — the invitee accepts or declines by the link. */
export const AnswerEmailInvitationSchema = z.object({
	token: EmailInvitationTokenSchema,
	accept: z.boolean(),
});
export type AnswerEmailInvitation = z.infer<typeof AnswerEmailInvitationSchema>;

/** What an answer settled, for the landing to move to (`accepted` opens the project). */
export interface EmailInvitationAnswered {
	state: "accepted" | "declined";
	projectSlug: string | null;
}
// #endregion

/** How an invitation names the role it offers: `as a freelancer`. One wording for the page and the mail. */
export function invitationRolePhrase(role: string | null): string {
	switch (role) {
		case "admin":
			return "an admin";
		case "manager":
			return "a manager";
		case "freelancer":
			return "a freelancer";
		case "member":
			return "a member";
		case "guest":
			return "a guest";
		default:
			return "a collaborator";
	}
}
