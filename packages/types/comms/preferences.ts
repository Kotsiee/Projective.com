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
 * `email` / `push` here are the platform's only email/push toggles — `org.user_preferences` carries
 * no copy (Decision #204).
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

/** base64url, as a browser's `PushSubscription.toJSON()` writes its keys. */
const b64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/);

/**
 * `POST /api/notifications/devices` (COMMS NT4): a browser's `PushSubscription.toJSON()`, plus an
 * optional label. The endpoint must be a known push service over https
 * (`transport-webpush.ts` `isPushEndpoint`), checked by the service.
 */
export const WebPushSubscriptionSchema = z.object({
	endpoint: z.string().url().max(2048),
	expirationTime: z.number().nullable().optional(),
	keys: z.object({
		/** The browser's P-256 public key: 65 raw octets, 87 base64url characters. */
		p256dh: b64url.min(86).max(90),
		/** The 16-octet auth secret: 22 base64url characters. */
		auth: b64url.min(21).max(26),
	}),
	label: z.string().trim().max(120).optional(),
});
export type WebPushSubscription = z.infer<typeof WebPushSubscriptionSchema>;

/** `DELETE /api/notifications/devices`: stop alerts on the browser that holds this endpoint. */
export const RevokeWebPushSchema = z.object({ endpoint: z.string().url().max(2048) });
export type RevokeWebPush = z.infer<typeof RevokeWebPushSchema>;

/**
 * `POST /api/notifications/devices/status` (body, never a query string: an endpoint is a capability
 * URL): is this browser's subscription the caller's own live device? A browser someone else turned
 * on, or one whose row was released, reads `live: false`, so Settings never shows "on" for it.
 */
export const PushDeviceStatusSchema = z.object({ live: z.boolean() });
export type PushDeviceStatus = z.infer<typeof PushDeviceStatusSchema>;

/** `GET /api/notifications/push/config`: the VAPID public key a browser subscribes with. */
export const PushConfigSchema = z.object({ publicKey: z.string() });
export type PushConfig = z.infer<typeof PushConfigSchema>;
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

// #region The settings console's notification centre
/** The four transports a person routes — `webhook` is an integration, never a preference. */
export const PersonalChannel = z.enum(["in_app", "push", "email", "sms"]);
export type PersonalChannel = z.infer<typeof PersonalChannel>;

/** Display order of the routing matrix's columns. */
export const PERSONAL_CHANNELS: readonly PersonalChannel[] = ["in_app", "push", "email", "sms"];

/** The personal channels that leave Projective, so need a dispatcher and a provider transport. */
export const OutboundChannel = PersonalChannel.exclude(["in_app"]);
export type OutboundChannel = z.infer<typeof OutboundChannel>;

/**
 * Which outbound channels actually deliver in this environment. A channel is live only while the
 * notification dispatcher runs AND that channel's transport is configured; it is resolved on the
 * server (`services/comms/channel-liveness.ts`), never from the browser. A preference for a channel
 * that is not live is still saved, and applies once that channel launches.
 */
export const ChannelLivenessSchema = z.object({
	email: z.boolean(),
	push: z.boolean(),
	sms: z.boolean(),
});
export type ChannelLiveness = z.infer<typeof ChannelLivenessSchema>;

/** Nothing leaves Projective: the answer wherever liveness could not be resolved. */
export const NO_LIVE_CHANNELS: ChannelLiveness = { email: false, push: false, sms: false };

/**
 * The Dev Context Switcher's `notificationDelivery` axis: draw every outbound channel as delivering
 * (`live`) or none (`off`). Absent = the server's own answer. Honoured in development only.
 */
export type ChannelLivenessOverride = "live" | "off";

/** The cookie that carries {@link ChannelLivenessOverride}. */
export const CHANNEL_LIVENESS_OVERRIDE_COOKIE = "pj.dev.notification-delivery";

/** Read the override from a cookie value; anything unrecognised means "no override". */
export function parseChannelLivenessOverride(
	raw: string | null | undefined,
): ChannelLivenessOverride | null {
	const value = raw?.trim();
	return value === "live" || value === "off" ? value : null;
}

/**
 * The Dev Context Switcher's `emailDeliverability` axis (COMMS NT3): `bounced` draws the person's
 * primary address as undeliverable (a hard bounce) in the account read, `deliverable` draws every
 * address as fine. Absent = the server's own answer. Honoured in development only.
 */
export type EmailDeliverabilityOverride = "deliverable" | "bounced";

/** The cookie that carries {@link EmailDeliverabilityOverride}. */
export const EMAIL_DELIVERABILITY_OVERRIDE_COOKIE = "pj.dev.email-deliverability";

/** Read the override from a cookie value; anything unrecognised means "no override". */
export function parseEmailDeliverabilityOverride(
	raw: string | null | undefined,
): EmailDeliverabilityOverride | null {
	const value = raw?.trim();
	return value === "deliverable" || value === "bounced" ? value : null;
}

/** The global row, trimmed to what the console edits. Times are `HH:MM` local to `timezone`. */
export const NotificationCenterPrefsSchema = z.object({
	inApp: z.boolean(),
	push: z.boolean(),
	email: z.boolean(),
	sms: z.boolean(),
	timezone: z.string(),
	quietHoursEnabled: z.boolean(),
	quietHoursStart: z.string().nullable(),
	quietHoursEnd: z.string().nullable(),
	mutedUntil: timestamp.nullable(),
	digestFrequency: DigestFrequency,
});
export type NotificationCenterPrefs = z.infer<typeof NotificationCenterPrefsSchema>;

/** One matrix row: a category's per-channel overrides, `null` = follow the channel's master. */
export const NotificationCenterCategorySchema = z.object({
	category: NotificationCategory,
	inApp: z.boolean().nullable(),
	push: z.boolean().nullable(),
	email: z.boolean().nullable(),
	sms: z.boolean().nullable(),
});
export type NotificationCenterCategory = z.infer<typeof NotificationCenterCategorySchema>;

/**
 * The catalog's MANDATORY events in one category, summarised — what no preference can silence
 * (`comms.fn_resolve_channels` step 1). Read from `comms.notification_types`, never restated here.
 */
export const RequiredAlertsSchema = z.object({
	category: NotificationCategory,
	/** How many enabled event types in the category are mandatory. */
	mandatory: z.number().int().min(0),
	/** How many enabled event types the category has in all. */
	total: z.number().int().min(0),
	/** The union of the mandatory types' default channels — where they always land. */
	channels: z.array(PersonalChannel),
});
export type RequiredAlerts = z.infer<typeof RequiredAlertsSchema>;

/** `GET /api/user/notifications` — everything the Notifications section draws. */
export const NotificationCenterSchema = z.object({
	prefs: NotificationCenterPrefsSchema,
	/** All eight categories, in `NotificationCategory` order, absent rows filled with `null`s. */
	categories: z.array(NotificationCenterCategorySchema),
	required: z.array(RequiredAlertsSchema),
	/** `false` when the live read failed and this is the seeded default — never shown as saved. */
	live: z.boolean(),
});
export type NotificationCenter = z.infer<typeof NotificationCenterSchema>;

/** `HH:MM` (24h), the shape a quiet-hours bound is edited in. */
const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time like 22:00.");

/**
 * `PUT /api/user/notifications` — a partial save.
 *
 * `resetChannels` is how a MASTER toggle behaves: because the router reads
 * `COALESCE(category, global)`, an explicit category value outranks the master, so flipping a master
 * alone would leave the overridden cells where they were. Naming the channel here sets every
 * category's value for it back to `null` in the same save — the column then follows its master.
 */
export const NotificationCenterUpdateSchema = z.object({
	prefs: z.object({
		inApp: z.boolean(),
		push: z.boolean(),
		email: z.boolean(),
		sms: z.boolean(),
		timezone: z.string().min(1).max(60),
		quietHoursEnabled: z.boolean(),
		quietHoursStart: ClockTime.nullable(),
		quietHoursEnd: ClockTime.nullable(),
		mutedUntil: timestamp.nullable(),
	}).partial().optional(),
	categories: z.array(
		NotificationCenterCategorySchema.pick({ category: true }).extend(
			NotificationCenterCategorySchema.pick({ inApp: true, push: true, email: true, sms: true })
				.partial().shape,
		),
	).max(8).optional(),
	resetChannels: z.array(PersonalChannel).max(4).optional(),
}).strict().refine(
	(body) => {
		const p = body.prefs;
		return !p?.quietHoursEnabled || (p.quietHoursStart !== null && p.quietHoursEnd !== null &&
			p.quietHoursStart !== undefined && p.quietHoursEnd !== undefined);
	},
	{ message: "Quiet hours need a start and an end.", path: ["prefs", "quietHoursStart"] },
);
export type NotificationCenterUpdate = z.infer<typeof NotificationCenterUpdateSchema>;
// #endregion
