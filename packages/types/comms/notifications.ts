import { z } from "zod";
import {
	DeliveryStatus,
	NotificationCategory,
	NotificationChannel,
	NotificationContextType,
	NotificationTypeKey,
	NotificationUrgency,
	QueueStatus,
	timestamp,
	uuid,
} from "./common.ts";

/**
 * comms notifications — the event envelope and everything downstream of it.
 *
 * Mirrors migrations `20260724090000` (the envelope columns on `comms.notifications`) and
 * `20260724092000` (deliveries, the scheduled-send queue, digests, provider callbacks and
 * suppressions).
 *
 * THE ROUTING CONTRACT these shapes encode:
 *   1. A notification ROW IS ALWAYS WRITTEN. It is the ledger.
 *   2. `channels` records what the router decided to deliver over. An EMPTY array means "recorded,
 *      delivered nowhere" — the user muted it.
 *   3. The in-app inbox shows a row only when `in_app` is among its channels — which is exactly
 *      what the `comms.notification_feed` view ({@link NotificationFeedItemSchema}) filters on.
 */

// #region The notification row
/** A row of `comms.notifications`. */
export const NotificationSchema = z.object({
	id: uuid,
	userId: uuid,
	/** Canonical event key (aliases already resolved by `comms.fn_notify`). */
	type: NotificationTypeKey,
	title: z.string(),
	body: z.string(),
	/** Denormalised from the catalog at write time, so a re-classification never rewrites history. */
	category: NotificationCategory,
	urgency: NotificationUrgency,
	/** Source table/row of the event, e.g. `('project_stages', <stage id>)`. */
	entityTable: z.string().nullable(),
	entityId: uuid.nullable(),
	/** The workspace the event belongs to. */
	contextType: NotificationContextType.nullable(),
	contextId: uuid.nullable(),
	/** Who caused it. `null` = the platform itself (cron, webhook, system action). */
	actorUserId: uuid.nullable(),
	/** Resolved deep link, or `null` when no unambiguous link exists (never a broken one). */
	actionUrl: z.string().nullable(),
	/** Render/localization data only (amounts, counts, display names). NEVER PII or secrets. */
	payload: z.record(z.string(), z.unknown()),
	/** Collapse key for the catalog's `groupWindow`, e.g. `msg:{channel_id}`. */
	groupKey: z.string().nullable(),
	/** How many source events this row represents after collapsing (1 = not collapsed). */
	groupCount: z.number().int().min(1),
	/** What the router resolved. Empty = recorded but delivered nowhere. */
	channels: z.array(NotificationChannel),
	/** This specific notification was opened. */
	readAt: timestamp.nullable(),
	/** The badge was cleared (the inbox was opened). Distinct from `readAt` — do not conflate. */
	seenAt: timestamp.nullable(),
	/** Dismissed. Nothing is hard-deleted (root CLAUDE.md §5). */
	archivedAt: timestamp.nullable(),
	/** After this instant the row stops surfacing in the live inbox. */
	expiresAt: timestamp.nullable(),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type Notification = z.infer<typeof NotificationSchema>;

/**
 * A row of the `comms.notification_feed` view — the in-app inbox read model.
 *
 * Already filtered to live, unexpired, `in_app` rows and joined to its catalog policy, so the
 * client renders straight from it.
 */
export const NotificationFeedItemSchema = NotificationSchema.omit({
	archivedAt: true,
	updatedAt: true,
}).extend({
	isUnread: z.boolean(),
	/** From the catalog: the preference centre must render mandatory rows as read-only. */
	mandatory: z.boolean().nullable(),
	digestible: z.boolean().nullable(),
	typeDescription: z.string().nullable(),
});
export type NotificationFeedItem = z.infer<typeof NotificationFeedItemSchema>;
// #endregion

// #region Badge & list shapes
/** The return of `comms.get_notification_summary()` — the shell badge in one round trip. */
export const NotificationSummarySchema = z.object({
	unread: z.number().int().min(0),
	/** Rows never surfaced in the badge yet — drives the dot, per DESIGN_SYSTEM §D.1. */
	unseen: z.number().int().min(0),
	total: z.number().int().min(0),
	/**
	 * Sparse: a category with nothing unread is ABSENT, not zero — `comms.get_notification_summary`
	 * builds it with a `GROUP BY`. `partialRecord`, not `record`: an enum-keyed `z.record` is
	 * exhaustive in Zod 4 and would reject every real payload.
	 */
	byCategory: z.partialRecord(NotificationCategory, z.number().int().min(0)),
});
export type NotificationSummary = z.infer<typeof NotificationSummarySchema>;

/** Query params for the inbox list endpoint. */
export const NotificationListParamsSchema = z.object({
	category: NotificationCategory.optional(),
	/** Restrict to one workspace (the active context). */
	contextType: NotificationContextType.optional(),
	contextId: uuid.optional(),
	unreadOnly: z.boolean().optional(),
	/** Keyset pagination — rows strictly older than this instant. */
	before: timestamp.optional(),
	limit: z.number().int().min(1).max(100).optional(),
});
export type NotificationListParams = z.infer<typeof NotificationListParamsSchema>;

/** One page of the inbox. */
export const NotificationPageSchema = z.object({
	items: z.array(NotificationFeedItemSchema),
	summary: NotificationSummarySchema,
	nextCursor: timestamp.nullable(),
});
export type NotificationPage = z.infer<typeof NotificationPageSchema>;

/** Body of the mark-read / archive endpoints (`comms.mark_notifications_read` et al). */
export const NotificationIdsSchema = z.object({
	ids: z.array(uuid).min(1).max(500),
});
export type NotificationIds = z.infer<typeof NotificationIdsSchema>;

/** Body of `comms.mark_all_notifications_read` — omit the category to clear everything. */
export const MarkAllReadSchema = z.object({
	category: NotificationCategory.optional(),
});
export type MarkAllRead = z.infer<typeof MarkAllReadSchema>;
// #endregion

// #region Delivery
/**
 * A row of `comms.notification_deliveries` — one per (notification, channel, device).
 *
 * A notification is ONE event but MANY sends. This row is what answers "did the push arrive?" and
 * what stops the unread-escalation job double-sending on every cron tick.
 */
export const NotificationDeliverySchema = z.object({
	id: uuid,
	notificationId: uuid,
	userId: uuid,
	channel: NotificationChannel,
	status: DeliveryStatus,
	/** Only meaningful for `push` — one row per registered device. */
	deviceTokenId: uuid.nullable(),
	/** Gateway identity: `web_push` | `fcm` | `apns` | `resend` | `twilio` | `escalation`. */
	provider: z.string().nullable(),
	/** The gateway's own message id, used to correlate an inbound {@link DeliveryEvent}. */
	providerRef: z.string().nullable(),
	attempts: z.number().int().min(0),
	/**
	 * Why the router declined: `muted` | `quiet_hours` | `digest_deferred` |
	 * `suppressed_destination` | `no_target` | `channel_disabled`. Free text so a new reason needs
	 * no migration.
	 */
	suppressedReason: z.string().nullable(),
	error: z.string().nullable(),
	queuedAt: timestamp.nullable(),
	sentAt: timestamp.nullable(),
	deliveredAt: timestamp.nullable(),
	failedAt: timestamp.nullable(),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type NotificationDelivery = z.infer<typeof NotificationDeliverySchema>;
// #endregion

// #region Scheduled sends
/**
 * A row of `comms.notification_queue` — a PROMISE of a notification, not a notification.
 *
 * Backs every time-based flow: session T-60/T-15/T-5 reminders, the abandoned-basket nudge,
 * ghosting/auto-approve timers, and quiet-hours deferral.
 */
export const NotificationQueueEntrySchema = z.object({
	id: uuid,
	userId: uuid,
	type: NotificationTypeKey,
	scheduledFor: timestamp,
	status: QueueStatus,
	/**
	 * Idempotency + cancellation handle, e.g. `session:{id}:reminder_15m`. Re-running a scheduler
	 * with the same key updates in place; the event that invalidates the reminder cancels by key.
	 */
	dedupeKey: z.string().nullable(),
	title: z.string(),
	body: z.string(),
	entityTable: z.string().nullable(),
	entityId: uuid.nullable(),
	contextType: NotificationContextType.nullable(),
	contextId: uuid.nullable(),
	actorUserId: uuid.nullable(),
	payload: z.record(z.string(), z.unknown()),
	groupKey: z.string().nullable(),
	/** Set once materialised — links the promise to the notification it became. */
	notificationId: uuid.nullable(),
	attempts: z.number().int().min(0),
	lastError: z.string().nullable(),
	/** `scheduled` | `quiet_hours` | `digest` | `retry`. */
	reason: z.string(),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type NotificationQueueEntry = z.infer<typeof NotificationQueueEntrySchema>;

/** Input for `comms.fn_enqueue`. */
export const EnqueueNotificationSchema = z.object({
	userId: uuid,
	type: NotificationTypeKey,
	title: z.string().min(1).max(200),
	body: z.string().max(2000),
	scheduledFor: timestamp,
	dedupeKey: z.string().max(200).optional(),
	entityTable: z.string().max(120).optional(),
	entityId: uuid.optional(),
	contextType: NotificationContextType.optional(),
	contextId: uuid.optional(),
	payload: z.record(z.string(), z.unknown()).optional(),
	groupKey: z.string().max(200).optional(),
});
export type EnqueueNotification = z.infer<typeof EnqueueNotificationSchema>;
// #endregion

// #region Digests
/** A row of `comms.notification_digests` — the rolled-up periodic delivery. */
export const NotificationDigestSchema = z.object({
	id: uuid,
	userId: uuid,
	/** Always `daily` or `weekly` in practice; `off` users never get a digest row. */
	period: z.enum(["daily", "weekly"]),
	windowStart: timestamp,
	windowEnd: timestamp,
	/** `skipped` records an empty window, so the cron job is provably idempotent. */
	status: z.enum(["pending", "sent", "skipped", "failed"]),
	notificationIds: z.array(uuid),
	itemCount: z.number().int().min(0),
	/** Per-category counts + headline items for the email template. */
	summary: z.record(z.string(), z.unknown()),
	sentAt: timestamp.nullable(),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type NotificationDigest = z.infer<typeof NotificationDigestSchema>;
// #endregion

// #region Provider callbacks & suppressions
/**
 * A row of `comms.delivery_events` — an inbound gateway callback.
 *
 * `UNIQUE (provider, providerEventId)` in the database IS the platform's webhook idempotency
 * guarantee (SYSTEM_ARCHITECTURE §Webhook Standards): a replayed event can never double-apply.
 */
export const DeliveryEventSchema = z.object({
	id: uuid,
	provider: z.string(),
	/** The provider's own event identifier — the idempotency key. */
	providerEventId: z.string(),
	/** `null` for an orphan callback, which is kept anyway (a bounce still suppresses). */
	deliveryId: uuid.nullable(),
	/**
	 * `sent` | `delivered` | `opened` | `clicked` | `bounced` | `complained` | `unsubscribed` |
	 * `unregistered` | `failed`. Free text so a provider-specific event needs no migration.
	 */
	eventType: z.string(),
	occurredAt: timestamp,
	/** The raw provider body; emptied after 30 days by `comms.fn_compact_delivery_events`. */
	raw: z.record(z.string(), z.unknown()),
	processedAt: timestamp.nullable(),
	createdAt: timestamp,
});
export type DeliveryEvent = z.infer<typeof DeliveryEventSchema>;

/** A row of `comms.channel_suppressions` — a destination we must never contact again. */
export const ChannelSuppressionSchema = z.object({
	id: uuid,
	/** Only `email` | `sms` | `push` are suppressible. */
	channel: z.enum(["email", "sms", "push"]),
	destination: z.string(),
	/** The account that owned the destination at suppression time, when known. */
	userId: uuid.nullable(),
	/** `hard_bounce` | `complaint` | `unsubscribe` | `manual` | `invalid`. */
	reason: z.string(),
	/**
	 * `true` suppresses ONLY the `marketing` category — an unsubscribe can never silence a
	 * security or money-movement email.
	 */
	marketingOnly: z.boolean(),
	sourceEventId: uuid.nullable(),
	/** Lifting a suppression sets this; the row is never deleted. */
	liftedAt: timestamp.nullable(),
	liftedReason: z.string().nullable(),
	createdAt: timestamp,
});
export type ChannelSuppression = z.infer<typeof ChannelSuppressionSchema>;
// #endregion
