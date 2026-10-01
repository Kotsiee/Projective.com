import { z } from "zod";
import { ConversationKind } from "./conversations.ts";

/**
 * messaging.context — the conversation context drawer's projection: who the counterpart is, what the
 * two people are negotiating (invitations and applications between them, either direction), and the
 * actions the viewer may take on it. Read by `GET /api/messaging/conversations/[id]/context`; the
 * fat service derives every action server-side, so a control only renders when its write would be
 * accepted.
 */

// #region Counterpart
/** The earned Standing rung of a SELLER (buyers are not gamified — PRODUCT_SPEC §Standing). */
export const CounterpartStandingSchema = z.object({
	level: z.number().int().min(1).max(5),
	label: z.string().min(1).max(40),
});
export type CounterpartStanding = z.infer<typeof CounterpartStandingSchema>;

/** The other person in a DM. */
export const ConversationCounterpartSchema = z.object({
	id: z.string().min(1).max(80),
	name: z.string().min(1).max(120),
	handle: z.string().max(40).nullable(),
	avatar: z.string().max(400).nullable(),
	standing: CounterpartStandingSchema.nullable(),
});
export type ConversationCounterpart = z.infer<typeof ConversationCounterpartSchema>;
// #endregion

// #region Engagements
/** An invitation (client → freelancer) or an application (freelancer → client). */
export const EngagementKind = z.enum(["invitation", "application"]);
export type EngagementKind = z.infer<typeof EngagementKind>;

/** Whether the VIEWER sent the request or received it. */
export const EngagementDirection = z.enum(["sent", "received"]);
export type EngagementDirection = z.infer<typeof EngagementDirection>;

/** The union of the invitation and application lifecycles (PRODUCT_MANAGEMENT §3.5). */
export const EngagementStatus = z.enum([
	"pending",
	"accepted",
	"declined",
	"expired",
	"rejected",
	"withdrawn",
]);
export type EngagementStatus = z.infer<typeof EngagementStatus>;

/** One answered question — an intake answer resolved against its question. */
export const EngagementAnswerSchema = z.object({
	label: z.string().min(1).max(200),
	value: z.string().max(2000),
});
export type EngagementAnswer = z.infer<typeof EngagementAnswerSchema>;

/** One stage of the project the request is about. */
export const EngagementMilestoneSchema = z.object({
	stageId: z.string().min(1).max(80),
	name: z.string().min(1).max(160),
	/** The stage's delivery in the owner's words, or "" when none was written. */
	detail: z.string().max(400),
	priceLabel: z.string().max(40).nullable(),
	/** The stage this request names. */
	current: z.boolean(),
});
export type EngagementMilestone = z.infer<typeof EngagementMilestoneSchema>;

/** One request between the two people. */
export const ConversationEngagementSchema = z.object({
	id: z.string().min(1).max(80),
	kind: EngagementKind,
	direction: EngagementDirection,
	status: EngagementStatus,
	projectSlug: z.string().min(1).max(40),
	projectTitle: z.string().min(1).max(200),
	/** Where the viewer can open the project: the workspace when they are on it, else its public view. */
	projectHref: z.string().max(200).nullable(),
	stageName: z.string().max(160).nullable(),
	roleTitle: z.string().max(160).nullable(),
	priceLabel: z.string().max(40).nullable(),
	/** Terms settle when the client prices and publishes (Decision #108's placeholder). */
	placeholder: z.boolean(),
	/** The intro (invitation) or cover note (application), PII-masked while the project is protected. */
	message: z.string().max(4000).nullable(),
	/** The brief, as plain text. */
	summary: z.string().max(600).nullable(),
	answers: z.array(EngagementAnswerSchema).max(12),
	milestones: z.array(EngagementMilestoneSchema).max(40),
	/** e.g. "Sent 3 Oct 2026". */
	sentLabel: z.string().max(40),
	/** e.g. "Expires 17 Oct 2026" for a pending invitation; null otherwise. */
	expiresLabel: z.string().max(40).nullable(),
});
export type ConversationEngagement = z.infer<typeof ConversationEngagementSchema>;
// #endregion

// #region Actions
/**
 * The acts the drawer's rig offers: the freelancer answers an invitation; the client confirms an
 * applicant's seat or funds a confirmed one.
 */
export const ContextActionKind = z.enum([
	"accept_invitation",
	"decline_invitation",
	"confirm_seat",
	"fund_escrow",
]);
export type ContextActionKind = z.infer<typeof ContextActionKind>;

/** One action the viewer may take, derived server-side. */
export const ContextActionSchema = z.object({
	kind: ContextActionKind,
	label: z.string().min(1).max(60),
	/** The invitations or application the act answers (a multi-stage hire answers as one request). */
	engagementIds: z.array(z.string().min(1).max(80)).min(1).max(20),
	/** Where the act lands the viewer afterwards; for `fund_escrow` it IS the act. */
	href: z.string().max(200).nullable(),
	/** One sentence saying what happens, read before the press. */
	note: z.string().max(240).nullable(),
});
export type ContextAction = z.infer<typeof ContextActionSchema>;
// #endregion

// #region Context
/** The drawer's whole read. */
export const ConversationContextSchema = z.object({
	conversationId: z.string().min(1).max(120),
	kind: ConversationKind,
	/** The other person of a DM; null for a group. */
	counterpart: ConversationCounterpartSchema.nullable(),
	/** The viewer's side of the most recent request; null when the two have none. */
	viewerRole: z.enum(["client", "freelancer"]).nullable(),
	engagements: z.array(ConversationEngagementSchema).max(20),
	actions: z.array(ContextActionSchema).max(6),
});
export type ConversationContext = z.infer<typeof ConversationContextSchema>;
// #endregion
