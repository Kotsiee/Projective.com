import { z } from "zod";
import {
	interval,
	NotificationCategory,
	NotificationChannel,
	NotificationTypeKey,
	NotificationUrgency,
	timestamp,
} from "./common.ts";

/**
 * comms catalog — `comms.notification_types`, the routing matrix as data.
 *
 * Mirrors migration `20260724090000_comms_notification_catalog.sql`. One row per event key declares
 * its category, urgency, default channel fan-out, whether a user may mute it, whether it pierces
 * quiet hours, and how long a collapse window lasts. The router
 * (`comms.fn_resolve_channels`) intersects this with the recipient's preferences.
 *
 * ⚠️ The catalog is POLICY, NOT A GATE. `comms.notifications.type` is deliberately not
 * foreign-keyed to it — an unregistered key must never raise inside an escrow or stage RPC.
 */

// #region The shipped vocabulary
/**
 * Every key seeded by the migration, grouped as the catalog seeds them.
 *
 * This is a convenience for exhaustive client handling (copy decks, icon maps, filter chips) — it
 * is NOT a closed set at runtime. `comms.fn_notify` auto-registers unknown keys, so always fall
 * back to a generic renderer. See {@link NotificationTypeKey}.
 */
export const KNOWN_NOTIFICATION_TYPES = [
	// money
	"escrow.funded",
	"escrow.released",
	"escrow.refunded",
	"escrow.disputed",
	"payout.sent",
	"payout.failed",
	"payout.method_required",
	"wallet.topup_succeeded",
	"wallet.topup_failed",
	"wallet.low_balance",
	"wallet.funds_pending",
	"wallet.funds_available",
	"invoice.issued",
	"invoice.overdue",
	"statement.ready",
	"chargeback.opened",
	"spend_approval.requested",
	"spend_approval.decided",
	"split.distributed",
	"smoother.deposit",
	// work
	"stage.funded",
	"stage.approved",
	"stage.cancelled",
	"stage.invite",
	"stage.deadline_approaching",
	"stage.deadline_missed",
	"ticket.assigned",
	"ticket.claimed",
	"ticket.revision_requested",
	"ticket.completed",
	"submission.received",
	"submission.accepted",
	"submission.revision_requested",
	"submission.awaiting_review",
	"submission.auto_approved",
	"project.handover",
	"project.completed",
	"project.member_joined",
	"application.received",
	"application.accepted",
	"application.declined",
	// messages
	"message.new",
	"message.mention",
	"message.reaction",
	"channel.invited",
	// schedule
	"session.booked",
	"session.rescheduled",
	"session.cancelled",
	"session.reminder_60m",
	"session.reminder_15m",
	"session.reminder_5m",
	"session.reschedule_vote",
	"availability.booking_request",
	// discovery
	"catalogue.listing_published",
	"catalogue.listing_paused",
	"basket.abandoned",
	"suggestion.next_steps",
	"review.received",
	"review.reminder",
	"profile.followed",
	"search.saved_alert",
	// account
	"account.email_verified",
	"account.password_changed",
	"account.new_device_login",
	"account.kyc_submitted",
	"account.kyc_verified",
	"account.kyc_rejected",
	"account.role_changed",
	"team.invite",
	"team.member_joined",
	"org.domain_colleague",
	"business.permission_changed",
	// system
	"system.security_alert",
	"system.maintenance",
	"system.policy_update",
	"dispute.opened",
	"dispute.resolved",
	"report.filed",
	"moderation.action",
	// marketing (opt-in only — a marketing type can never be mandatory)
	"marketing.newsletter",
	"marketing.product_update",
] as const;

/** The seeded event keys as a union type. Runtime values are NOT limited to these. */
export type KnownNotificationType = (typeof KNOWN_NOTIFICATION_TYPES)[number];

/**
 * Legacy underscored keys still emitted by the escrow/stage RPCs (migrations 0305 / 0311), mapped
 * to their canonical dotted key. Resolved in the database by `comms.fn_resolve_type_key`; mirrored
 * here so a client reading historic rows renders them correctly.
 *
 * ⚠️ FLAGGED (root CLAUDE.md §8): rewriting those RPCs to emit canonical keys is a behavioural
 * change to money-movement functions and needs human sign-off.
 */
export const NOTIFICATION_TYPE_ALIASES: Readonly<Record<string, KnownNotificationType>> = {
	stage_funded: "stage.funded",
	stage_approved: "stage.approved",
	stage_cancelled: "stage.cancelled",
	project_handover: "project.handover",
};

/** Resolves a canonical or legacy key to its canonical form. Total — unknown keys pass through. */
export function resolveNotificationType(key: string): string {
	return NOTIFICATION_TYPE_ALIASES[key] ?? key;
}
// #endregion

// #region Catalog row
/** A row of `comms.notification_types` — the routing policy for one event key. */
export const NotificationTypeSchema = z.object({
	/** Canonical dotted `domain.event` key. */
	key: NotificationTypeKey,
	/** Historic/alternate keys that resolve to this row. */
	aliases: z.array(z.string()),
	category: NotificationCategory,
	urgency: NotificationUrgency,
	/** The fan-out attempted BEFORE preferences are applied. Preferences may only narrow it. */
	defaultChannels: z.array(NotificationChannel).min(1),
	/** The user cannot mute this event (security, legal, money-movement, moderation). */
	mandatory: z.boolean(),
	/** Push/SMS still fire inside the recipient's quiet hours. */
	overridesQuietHours: z.boolean(),
	/** May be rolled into a daily/weekly digest instead of sent individually. */
	digestible: z.boolean(),
	/** Also writes a `security.audit_logs` row. */
	audit: z.boolean(),
	/** Collapse window — a second same-group event inside it refreshes rather than adds. */
	groupWindow: interval.nullable(),
	/** Deep-link template; `{id}` / `{entity_id}` / `{context_id}` are substituted server-side. */
	actionUrlTemplate: z.string().nullable(),
	/** Suggested lead time for reminder-style events, consumed by the schedulers. */
	defaultLeadTime: interval.nullable(),
	description: z.string(),
	/** `false` retires an event without deleting the row (root CLAUDE.md §5). */
	enabled: z.boolean(),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type NotificationType = z.infer<typeof NotificationTypeSchema>;
// #endregion
