import { z } from "zod";

/**
 * @projective/types/ops alerts — money and job alerts (MR4, Decision #461). Mirrors
 * `ops.fn_claim_alerts` (what the sweep leases to send), `ops.fn_record_alert_delivery` (one send's
 * outcome) and `ops.read_alert_deliveries` (`/admin/ledger`'s Alerts section), all in 00001660. The
 * database groups, dedupes and raises the dead-man switch; these are the shapes the service maps the
 * jsonb onto.
 */

// #region Vocabulary
/** Where an alert goes: an incoming webhook (Slack-compatible JSON) or the email digest (Resend). */
export const AlertChannel = z.enum(["webhook", "email"]);
export type AlertChannel = z.infer<typeof AlertChannel>;

/** A `level` rule matches rows at or above a level; a `silence` rule is a dead-man switch. */
export const AlertRuleKind = z.enum(["level", "silence"]);
export type AlertRuleKind = z.infer<typeof AlertRuleKind>;

/** The levels that alert; a `metric` row never does. */
export const AlertLevel = z.enum(["warn", "error"]);
export type AlertLevel = z.infer<typeof AlertLevel>;

/** A delivery is `pending` until a send succeeds, then `sent`. */
export const AlertDeliveryStatus = z.enum(["pending", "sent"]);
export type AlertDeliveryStatus = z.infer<typeof AlertDeliveryStatus>;

/**
 * What a delivery may carry of its row: numbers, and short codes (an 8-character id, a currency, a job
 * name). `ops.fn_alert_sample` already keeps only these; the service checks again before it sends.
 */
export const AlertSampleSchema = z.record(z.string(), z.union([z.number(), z.string().max(64)]));
export type AlertSample = z.infer<typeof AlertSampleSchema>;
// #endregion

// #region The sweep
/** One delivery the claim leased to send. `fingerprint` is cut to 8 characters when it is an id. */
export const ClaimedAlertSchema = z.object({
	id: z.string().uuid(),
	channel: AlertChannel,
	scope: z.string(),
	fingerprint: z.string(),
	level: AlertLevel,
	count: z.number().int().positive(),
	firstSeen: z.string(),
	lastSeen: z.string(),
	attempts: z.number().int().min(0),
	sample: AlertSampleSchema,
});
export type ClaimedAlert = z.infer<typeof ClaimedAlertSchema>;

/** `ops.fn_claim_alerts`: what the pass folded and opened, and what it leased. */
export const AlertClaimSchema = z.object({
	folded: z.number().int().min(0),
	opened: z.number().int().min(0),
	silent: z.number().int().min(0),
	deliveries: z.array(ClaimedAlertSchema),
});
export type AlertClaim = z.infer<typeof AlertClaimSchema>;

/** What one sweep did: the claim's counts, and how many alerts each channel sent or failed. */
export const AlertSweepTallySchema = z.object({
	folded: z.number().int().min(0),
	opened: z.number().int().min(0),
	silent: z.number().int().min(0),
	claimed: z.number().int().min(0),
	sent: z.number().int().min(0),
	failed: z.number().int().min(0),
});
export type AlertSweepTally = z.infer<typeof AlertSweepTallySchema>;
// #endregion

// #region The operator read
/** One rule, as `/admin/ledger` lists it. */
export const AlertRuleViewSchema = z.object({
	kind: AlertRuleKind,
	scope: z.string(),
	minLevel: AlertLevel.nullable(),
	maxSilenceMinutes: z.number().int().nullable(),
	channel: AlertChannel,
	dedupeWindowMinutes: z.number().int(),
	enabled: z.boolean(),
});
export type AlertRuleView = z.infer<typeof AlertRuleViewSchema>;

/** One dead-man scope and when it last wrote a server row (null: never). */
export const AlertSilenceViewSchema = z.object({
	scope: z.string(),
	lastRowAt: z.string().nullable(),
});
export type AlertSilenceView = z.infer<typeof AlertSilenceViewSchema>;

/** One delivery, as `/admin/ledger` lists it: no message, short ids only. */
export const AlertDeliveryViewSchema = z.object({
	id: z.string().uuid(),
	channel: AlertChannel,
	scope: z.string(),
	fingerprint: z.string(),
	level: AlertLevel,
	count: z.number().int().positive(),
	firstSeen: z.string(),
	lastSeen: z.string(),
	status: AlertDeliveryStatus,
	attempts: z.number().int().min(0),
	nextAttemptAt: z.string(),
	sentAt: z.string().nullable(),
	lastError: z.string().nullable(),
});
export type AlertDeliveryView = z.infer<typeof AlertDeliveryViewSchema>;

/** `ops.read_alert_deliveries()`: the Alerts section of `/admin/ledger`. */
export const AlertsReadSchema = z.object({
	asOf: z.string(),
	pending: z.number().int().min(0),
	rules: z.array(AlertRuleViewSchema),
	silence: z.array(AlertSilenceViewSchema),
	deliveries: z.array(AlertDeliveryViewSchema),
});
export type AlertsRead = z.infer<typeof AlertsReadSchema>;
// #endregion
