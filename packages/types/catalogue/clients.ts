import { z } from "zod";
import { ImagePlaceholderSchema } from "../files/metadata.ts";
import { EventRescheduleSchema } from "../scheduling/coordination.ts";
import { ClientKey } from "./url.ts";

/**
 * catalogue.clients — the client pipeline: who is buying, asking about or booking a seller's
 * listings, grouped into lanes.
 *
 * Lanes are DERIVED groupings over each source's existing statuses, never statuses of their own
 * (root CLAUDE.md §5): an engagement is a thread, quote request, discovery call, order, session
 * booking or pipeline project, and {@link laneOf} reads where it stands from the status that source
 * already records.
 */

// #region Vocabularies
/** The pipeline board's lanes. */
export const ClientLane = z.enum(["inquiries", "active", "action_required", "closed"]);
export type ClientLane = z.infer<typeof ClientLane>;

/** The source an engagement row comes from. */
export const EngagementKind = z.enum([
	"inquiry",
	"quote",
	"discovery_call",
	"order",
	"session_booking",
	"pipeline_project",
]);
export type EngagementKind = z.infer<typeof EngagementKind>;

/** Why an engagement is waiting on the seller. */
export const ActionReason = z.enum([
	"revision_requested",
	"reschedule_open",
	"handshake_pending",
	"dispute_open",
	"inquiry_unanswered",
	"submission_pending",
]);
export type ActionReason = z.infer<typeof ActionReason>;

/**
 * The source statuses that end an engagement, per kind: an archived thread, a withdrawn quote, a
 * call that is over or never happened, a reversed order, a sitting that ran or was cancelled, and a
 * project that finished, was cancelled or archived.
 */
export const CLOSED_STATUSES: Readonly<Record<EngagementKind, readonly string[]>> = {
	inquiry: ["archived"],
	quote: ["withdrawn"],
	discovery_call: ["declined", "cancelled", "completed", "no_show", "expired"],
	order: ["refunded", "cancelled"],
	session_booking: ["completed", "cancelled", "cancelled_by_freelancer", "cancelled_by_client"],
	pipeline_project: ["completed", "cancelled", "archived"],
};

const PRE_SALE_KINDS: readonly EngagementKind[] = ["inquiry", "quote", "discovery_call"];
// #endregion

// #region Engagement
/** The buyer behind an engagement. */
export const ClientIdentitySchema = z.object({
	handle: ClientKey,
	name: z.string().max(120),
	avatar: z.string().max(600),
	avatarPlaceholder: ImagePlaceholderSchema.optional(),
});
export type ClientIdentity = z.infer<typeof ClientIdentitySchema>;

/** One thing a buyer has open with the seller. */
export const ClientEngagementSchema = z.object({
	/** Opaque per-kind reference. */
	id: z.string().min(1).max(120),
	kind: EngagementKind,
	/** The source row's own status, verbatim. */
	status: z.string().max(40),
	client: ClientIdentitySchema,
	/** The listing slug it concerns; `null` for a thread with no listing subject. */
	listingId: z.string().max(120).nullable(),
	listingTitle: z.string().max(200),
	/** Whether the buyer has gone on to order (turns a pre-sale engagement into active work). */
	hasOrder: z.boolean(),
	actionReasons: z.array(ActionReason).max(ActionReason.options.length),
	/** The engagement's money, in integer minor units, when it has any. */
	amountMinor: z.number().int().min(0).nullable(),
	currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
	openedAt: z.string(),
	lastActivityAt: z.string(),
	/** The next scheduled sitting, call or project event, when one lies ahead. */
	nextEventAt: z.string().nullable(),
	/** The canonical surface the drawer hands off to (thread, ticket, calendar event). */
	href: z.string().max(600),
});
export type ClientEngagement = z.infer<typeof ClientEngagementSchema>;

/**
 * One row of `catalogue.get_client_pipeline` (00001170), column for column. The service maps it to a
 * {@link ClientEngagement}: the listing uuid to its slug and title, the buyer to a
 * {@link ClientIdentity}, and `hasOrder` from whether the same buyer has an `order`,
 * `session_booking` or `pipeline_project` row on the same listing.
 */
export const ClientEngagementRowSchema = z.object({
	engagement_kind: EngagementKind,
	engagement_id: z.string().uuid(),
	listing_id: z.string().uuid(),
	buyer_user_id: z.string().uuid().nullable(),
	buyer_handle: z.string().nullable(),
	status: z.string().max(40),
	opened_at: z.string(),
	last_activity_at: z.string(),
	amount_minor: z.number().int().min(0).nullable(),
	currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
	next_event_at: z.string().nullable(),
	action_reasons: z.array(ActionReason).max(ActionReason.options.length),
	href: z.string().max(600),
});
export type ClientEngagementRow = z.infer<typeof ClientEngagementRowSchema>;

/** The lane an engagement sits in. Pure: reads only the engagement's own recorded state. */
export function laneOf(e: ClientEngagement): ClientLane {
	if (e.actionReasons.length > 0) return "action_required";
	if (CLOSED_STATUSES[e.kind].includes(e.status)) return "closed";
	if (PRE_SALE_KINDS.includes(e.kind) && !e.hasOrder) return "inquiries";
	return "active";
}

const LANE_URGENCY: readonly ClientLane[] = ["action_required", "active", "inquiries", "closed"];

/** A buyer's lane: the most urgent lane among their engagements (`closed` when they have none). */
export function clientLaneOf(engagements: readonly ClientEngagement[]): ClientLane {
	const lanes = new Set(engagements.map(laneOf));
	return LANE_URGENCY.find((lane) => lanes.has(lane)) ?? "closed";
}

/** The lanes in board order, most urgent first. */
export const LANE_ORDER: readonly ClientLane[] = LANE_URGENCY;

/** Action reasons, most severe first: money at stake, then work, then time, then words. */
export const ACTION_SEVERITY: readonly ActionReason[] = [
	"dispute_open",
	"revision_requested",
	"reschedule_open",
	"handshake_pending",
	"submission_pending",
	"inquiry_unanswered",
];

/**
 * The rank of the most severe reason among engagements (0 = `dispute_open`), or
 * `ACTION_SEVERITY.length` when none waits on the seller.
 */
export function severityRank(engagements: readonly ClientEngagement[]): number {
	let rank = ACTION_SEVERITY.length;
	for (const e of engagements) {
		for (const reason of e.actionReasons) rank = Math.min(rank, ACTION_SEVERITY.indexOf(reason));
	}
	return rank;
}
// #endregion

// #region Read models
/** One buyer as a card on the board and as the client drawer's body. */
export const ClientSummarySchema = z.object({
	client: ClientIdentitySchema,
	lane: ClientLane,
	engagements: z.array(ClientEngagementSchema).max(100),
	/** Lifetime gross from this buyer, pre-formatted in the seller's display currency. */
	grossLabel: z.string().max(24),
	firstSeenAt: z.string(),
	lastActivityAt: z.string(),
});
export type ClientSummary = z.infer<typeof ClientSummarySchema>;

/** Buyers per lane. */
export const ClientLaneCountsSchema = z.object({
	inquiries: z.number().int().min(0),
	active: z.number().int().min(0),
	action_required: z.number().int().min(0),
	closed: z.number().int().min(0),
});
export type ClientLaneCounts = z.infer<typeof ClientLaneCountsSchema>;

/** The client pipeline board for one scope. */
export const ClientPipelineSchema = z.object({
	clients: z.array(ClientSummarySchema).max(200),
	counts: ClientLaneCountsSchema,
	hasMore: z.boolean(),
});
export type ClientPipeline = z.infer<typeof ClientPipelineSchema>;

/** A calendar event of the buyer's being renegotiated, with its open round and proposals. */
export const ClientRescheduleSchema = z.object({
	eventId: z.string().uuid(),
	title: z.string().max(200),
	/** The event's current start, epoch ms (UTC). */
	start: z.number().int(),
	href: z.string().max(600),
	reschedule: EventRescheduleSchema,
});
export type ClientReschedule = z.infer<typeof ClientRescheduleSchema>;

/** The client drawer: one buyer, their engagements in scope, the inline thread and open rounds. */
export const ClientDetailSchema = ClientSummarySchema.extend({
	/**
	 * The seller's one DM thread with the buyer (unified messaging keeps one per pair), `null` until
	 * either of them writes; the drawer then opens `/messages/dm-<handle>`, which mints it.
	 */
	threadId: z.string().uuid().nullable(),
	reschedules: z.array(ClientRescheduleSchema).max(20),
});
export type ClientDetail = z.infer<typeof ClientDetailSchema>;
// #endregion
