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
