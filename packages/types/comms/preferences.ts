import { z } from "zod";
import {
	DevicePlatform,
	DigestFrequency,
	interval,
	NotificationCategory,
	NotificationChannel,
	NotificationTypeKey,
	timestamp,
	uuid,
} from "./common.ts";

/**
 * comms preferences — who wants to hear what, how, and when.
 *
 * Mirrors migration `20260724091000_comms_notification_preferences.sql`: the additive columns on
 * `comms.notification_prefs` and `comms.device_tokens`, plus `comms.notification_category_prefs`
 * and `comms.notification_type_mutes`.
 *
 * PRECEDENCE, highest first (implemented by `comms.fn_resolve_channels`):
 *   catalog `mandatory` → global snooze (unless `critical`) → per-type mute →
 *   per-category toggles → global toggles → quiet hours → digest deferral.
 *
 * ⚠️ FLAGGED SUPERSESSIONS (root CLAUDE.md §8) — both legacy columns are kept under the Additive
 * Rule but are no longer authoritative:
 *   * `quiet_hours tstzrange` (absolute) → {@link NotificationPrefs.quietHoursStart}/`End` +
 *     `timezone`, which express a RECURRING nightly window.
 *   * `digest boolean` → {@link NotificationPrefs.digestFrequency} (backfilled from it).
 * A second, coarser copy of the email/push toggles also lives on `org.user_preferences`
 * (`notification_email` / `notification_push`); `comms.notification_prefs` is the engine's source
 * of truth and the two are NOT reconciled — reconcile with a human.
 */

// #region Global preferences
/** A row of `comms.notification_prefs` — one per user, seeded on signup. */
export const NotificationPrefsSchema = z.object({
	userId: uuid,
	/** Transport master switches. `mandatory` catalog types ignore all four. */
	inApp: z.boolean(),
	email: z.boolean(),
	push: z.boolean(),
	sms: z.boolean(),
	/** Authoritative digest cadence. `off` = deliver in real time. */
	digestFrequency: DigestFrequency,
	/** Local hour-of-day the digest is delivered, in `timezone`. */
	digestHour: z.number().int().min(0).max(23),
	/** ISO-8601 weekday for a weekly digest: 1 = Monday … 7 = Sunday. */
	digestWeekday: z.number().int().min(1).max(7).nullable(),
	/** IANA zone the local-time fields are evaluated in — without it "quiet at 22:00" is meaningless. */
	timezone: z.string(),
	quietHoursEnabled: z.boolean(),
	/** Local wall-clock `HH:MM[:SS]`. `start > end` legally means the window crosses midnight. */
	quietHoursStart: z.string().nullable(),
	quietHoursEnd: z.string().nullable(),
	/** Global snooze ("pause everything until…"). `critical` catalog rows still pierce it. */
	mutedUntil: timestamp.nullable(),
	/** Message-body language; falls back to `org.user_preferences.locale`. */
	locale: z.string().nullable(),
	/** How long an unread, escalatable notification waits before the email fallback fires. */
	escalateAfter: interval,
	createdAt: timestamp,
	updatedAt: timestamp,
	/** @deprecated Legacy absolute quiet-hours range (migration 0008). Superseded — see the header. */
	quietHours: z.string().nullable(),
	/** @deprecated Legacy boolean digest opt-in (migration 0008). Superseded by `digestFrequency`. */
	digest: z.boolean(),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;

/** The writable subset of {@link NotificationPrefsSchema}. Legacy columns are not writable. */
export const UpdateNotificationPrefsSchema = NotificationPrefsSchema.pick({
	inApp: true,
	email: true,
	push: true,
	sms: true,
	digestFrequency: true,
	digestHour: true,
	digestWeekday: true,
	timezone: true,
	quietHoursEnabled: true,
	quietHoursStart: true,
	quietHoursEnd: true,
	mutedUntil: true,
	locale: true,
}).partial();
export type UpdateNotificationPrefs = z.infer<typeof UpdateNotificationPrefsSchema>;
// #endregion

// #region Per-category overrides
/**
 * A row of `comms.notification_category_prefs` — sparse per-category narrowing.
 *
 * A `null` field inherits the corresponding global toggle; an ABSENT ROW inherits everything, so
 * the table stays sparse and a new category needs no backfill.
 */
export const NotificationCategoryPrefsSchema = z.object({
	userId: uuid,
	category: NotificationCategory,
	inApp: z.boolean().nullable(),
	push: z.boolean().nullable(),
	email: z.boolean().nullable(),
	sms: z.boolean().nullable(),
	digestFrequency: DigestFrequency.nullable(),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type NotificationCategoryPrefs = z.infer<typeof NotificationCategoryPrefsSchema>;

/** Upsert body for one category's overrides. */
export const UpsertCategoryPrefsSchema = NotificationCategoryPrefsSchema.pick({
	category: true,
}).extend(
	NotificationCategoryPrefsSchema.pick({
		inApp: true,
		push: true,
		email: true,
		sms: true,
		digestFrequency: true,
	}).partial().shape,
);
export type UpsertCategoryPrefs = z.infer<typeof UpsertCategoryPrefsSchema>;
// #endregion

// #region Per-type mutes
/**
 * A row of `comms.notification_type_mutes` — the finest grain, optionally time-boxed and optionally
 * per-transport.
 *
 * A mute on a `mandatory` catalog type is stored but IGNORED by the router: security, legal,
 * money-movement and moderation events are never suppressible.
 */
export const NotificationTypeMuteSchema = z.object({
	userId: uuid,
	typeKey: NotificationTypeKey,
	/** `null` = muted indefinitely. A past instant means the mute has lapsed (rows are kept). */
	mutedUntil: timestamp.nullable(),
	/** Mute only these transports. `null`/empty = mute every transport. */
	channels: z.array(NotificationChannel).nullable(),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type NotificationTypeMute = z.infer<typeof NotificationTypeMuteSchema>;

/** Upsert body for a single-type mute. */
export const UpsertTypeMuteSchema = z.object({
	typeKey: NotificationTypeKey,
	mutedUntil: timestamp.nullable().optional(),
	channels: z.array(NotificationChannel).optional(),
});
export type UpsertTypeMute = z.infer<typeof UpsertTypeMuteSchema>;
// #endregion

// #region Devices
/**
 * A row of `comms.device_tokens` — a push registration.
 *
 * ⚠️ `p256dh`/`authKey` are browser-generated, per-subscription Web Push transport credentials —
 * not user PII and not a platform secret (the VAPID private key lives in the Edge Function
 * environment, never in the database). They are cleared on revocation, and are NEVER returned to
 * the client by a read endpoint.
 */
export const DeviceTokenSchema = z.object({
	id: uuid,
	userId: uuid,
	platform: DevicePlatform,
	/** `web_push` | `fcm` | `apns`. */
	provider: z.string(),
	token: z.string(),
	/** Web Push subscription endpoint; FCM/APNs use `token` instead. */
	endpoint: z.string().nullable(),
	/** Human label for the device list in settings ("Chrome on Windows"). */
	label: z.string().nullable(),
	userAgent: z.string().nullable(),
	lastSeenAt: timestamp,
	/** Soft retirement — a revoked token is skipped by the router but kept for the audit trail. */
	revokedAt: timestamp.nullable(),
	revokedReason: z.string().nullable(),
	/** Consecutive gateway failures; the reaper auto-revokes at the threshold. */
	failureCount: z.number().int().min(0),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type DeviceToken = z.infer<typeof DeviceTokenSchema>;

/** Input for `comms.register_device`. Re-registering the same browser refreshes the live row. */
export const RegisterDeviceSchema = z.object({
	token: z.string().min(1).max(4000),
	platform: DevicePlatform.default("web"),
	provider: z.string().max(60).default("web_push"),
	endpoint: z.string().max(4000).optional(),
	p256dh: z.string().max(400).optional(),
	authKey: z.string().max(400).optional(),
	label: z.string().max(120).optional(),
	userAgent: z.string().max(400).optional(),
});
export type RegisterDevice = z.infer<typeof RegisterDeviceSchema>;
// #endregion

// #region The preference-centre projection
/**
 * Everything the notification settings screen needs in one payload: the global row, the sparse
 * category overrides, the active per-type mutes, and the registered devices.
 */
export const NotificationSettingsSchema = z.object({
	prefs: NotificationPrefsSchema,
	categories: z.array(NotificationCategoryPrefsSchema),
	mutes: z.array(NotificationTypeMuteSchema),
	devices: z.array(DeviceTokenSchema),
});
export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;
// #endregion
