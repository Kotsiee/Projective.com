import { z } from "zod";

/**
 * comms — shared primitives for the `comms` schema Zod SSOT (the notification engine).
 *
 * These mirror the Postgres enums added by migration `20260724090000_comms_notification_catalog.sql`
 * exactly. Only regex/min/max/enum/int primitives are used so the schemas stay stable across Zod
 * majors (matching `packages/types/finance/common.ts` and `packages/types/org/organisations.ts`).
 *
 * The migration, these schemas, and `documentation/database/comms/*` land together
 * (root CLAUDE.md §1).
 */

// #region Scalar primitives
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An opaque UUID id. */
export const uuid = z.string().regex(UUID_RE, "Expected a UUID.");
/** An ISO timestamp string as returned by PostgREST. */
export const timestamp = z.string();
/**
 * A Postgres `interval`, rendered by PostgREST as an ISO-8601 duration or a human string
 * ("15 minutes"). Kept as a tolerant string — the client never does interval arithmetic; the
 * database owns every deadline in this domain.
 */
export const interval = z.string();
// #endregion

// #region Routing vocabulary (mirrors the comms.* Postgres enums)
/**
 * `comms.notification_channel` — the transports a notification can be delivered over.
 *
 * `in_app` is the Supabase Realtime stream on `comms.notifications`; the rest are Edge-Function
 * gateways. `webhook` is an integration, not a user preference, so it has no preference toggle.
 */
export const NotificationChannel = z.enum(["in_app", "push", "email", "sms", "webhook"]);
export type NotificationChannel = z.infer<typeof NotificationChannel>;

/**
 * `comms.notification_urgency` — how loudly an event may interrupt.
 *
 * `critical` is the only tier that pierces a global snooze. Piercing QUIET HOURS is a separate,
 * per-type decision (`NotificationType.overridesQuietHours`), not a function of urgency.
 */
export const NotificationUrgency = z.enum(["critical", "high", "medium", "low"]);
export type NotificationUrgency = z.infer<typeof NotificationUrgency>;

/**
 * `comms.notification_category` — the user-facing grouping the preference centre and the inbox
 * filter tabs are built from. A UI taxonomy, deliberately short; the event namespace is
 * {@link NotificationTypeKey}.
 */
export const NotificationCategory = z.enum([
	"money",
	"work",
	"messages",
	"schedule",
	"discovery",
	"account",
	"system",
	"marketing",
]);
export type NotificationCategory = z.infer<typeof NotificationCategory>;

/**
 * `comms.delivery_status` — the outcome of one (notification, channel, device) send.
 *
 * `suppressed` = policy said no (muted, quiet hours, a suppressed destination); `skipped` = there
 * was nothing to send to (no registered device, no email on file). The distinction matters when
 * answering "why did this user not get told?".
 */
export const DeliveryStatus = z.enum([
	"pending",
	"queued",
	"sent",
	"delivered",
	"failed",
	"suppressed",
	"skipped",
]);
export type DeliveryStatus = z.infer<typeof DeliveryStatus>;

/** `comms.digest_frequency` — `off` means "deliver in real time", not "deliver nothing". */
export const DigestFrequency = z.enum(["off", "daily", "weekly"]);
export type DigestFrequency = z.infer<typeof DigestFrequency>;

/** `comms.device_platform` — `web` = Web Push (VAPID), `ios` = APNs, `android` = FCM. */
export const DevicePlatform = z.enum(["web", "ios", "android"]);
export type DevicePlatform = z.infer<typeof DevicePlatform>;

/** `comms.queue_status` — lifecycle of a deferred send in `comms.notification_queue`. */
export const QueueStatus = z.enum(["scheduled", "processing", "sent", "cancelled", "failed"]);
export type QueueStatus = z.infer<typeof QueueStatus>;
// #endregion

// #region Event keys
/**
 * A notification event key in canonical `domain.event` form (`stage.funded`, `message.mention`).
 *
 * Deliberately a validated STRING rather than an enum of the known catalog: `comms.fn_notify`
 * auto-registers an unrecognised key so an emit site inside an escrow RPC can never fail, which
 * means a key the client has not shipped a case for is a legitimate runtime value. Use
 * {@link KnownNotificationType} when you need exhaustive handling and treat everything else as a
 * generic row.
 */
export const NotificationTypeKey = z
	.string()
	.regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, "Expected a `domain.event` notification key.");

/**
 * The workspace a notification belongs to, so the inbox can scope to the active context
 * (root CLAUDE.md Decision #16). Mirrors the `notifications_context_type_check` constraint.
 */
export const NotificationContextType = z.enum([
	"personal",
	"project",
	"team",
	"business",
	"organisation",
	"conversation",
]);
export type NotificationContextType = z.infer<typeof NotificationContextType>;
// #endregion
