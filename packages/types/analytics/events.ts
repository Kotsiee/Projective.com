import { z } from "zod";

/**
 * `analytics` schema shapes — the platform event substrate.
 *
 * Mirrors `analytics.event_catalogue` / `analytics.events` / `analytics.daily_rollups` and the
 * `analytics.fn_emit` RPC (migration `20260724110000_analytics_event_substrate.sql`). The migration,
 * this SSOT, and `documentation/database/analytics/*` land together (root CLAUDE.md §1).
 *
 * WHY IT EXISTS: every allowance magnitude, entitlement cap and Standing threshold in the
 * subscription system is an explicitly *tunable dial*, not a law. Those dials are only re-fittable if
 * the platform records what actually happened — so allowance grants/consumption, entitlement denials,
 * rung transitions and achievement awards all write here.
 */

// #region Vocabulary
/**
 * `analytics.subject_kind` — the entity an event is *about*. Distinct from the ACTOR (the user who
 * caused it), which is recorded separately.
 */
export const AnalyticsSubjectKind = z.enum([
	"user",
	"freelancer",
	"business",
	"team",
	"organisation",
	"project",
	"stage",
	"ticket",
	"listing",
	"platform",
]);
export type AnalyticsSubjectKind = z.infer<typeof AnalyticsSubjectKind>;

/**
 * The registered event names emitted by the subscription / Standing / allowance systems.
 *
 * The DB column is deliberately `text` (a new event must never require an enum migration mid-feature)
 * and `analytics.event_catalogue` is the registry; this enum is the *typed* subset the app emits and
 * reads. `analytics.v_unregistered_events` surfaces any drift.
 */
export const KnownAnalyticsEvent = z.enum([
	// Billing
	"subscription.started",
	"subscription.changed",
	"subscription.cancelled",
	// Entitlements & allowances
	"entitlement.checked",
	"entitlement.denied",
	"allowance.consumed",
	"allowance.exhausted",
	"allowance.period_rolled",
	"allowance.buffer_replenished",
	// Standing & gamification
	"standing.recomputed",
	"standing.level_changed",
	"mastery.progressed",
	"achievement.awarded",
	"streak.extended",
	"streak.broken",
]);
export type KnownAnalyticsEvent = z.infer<typeof KnownAnalyticsEvent>;
// #endregion

// #region Rows
/** A row of `analytics.event_catalogue` — the documented event vocabulary. */
export const EventCatalogueEntrySchema = z.object({
	name: z.string().min(1).max(120),
	domain: z.string().min(1).max(60),
	description: z.string().min(1),
	subjectKinds: z.array(AnalyticsSubjectKind),
	propertyKeys: z.array(z.string()),
	isActive: z.boolean(),
	createdAt: z.string(),
});
export type EventCatalogueEntry = z.infer<typeof EventCatalogueEntrySchema>;

/**
 * A row of `analytics.events` — append-only. `value` is the numeric payload lifted out of
 * `properties` so rollups aggregate without JSON extraction.
 */
export const AnalyticsEventSchema = z.object({
	id: z.string(),
	occurredAt: z.string(),
	name: z.string().min(1).max(120),
	domain: z.string().min(1).max(60),
	subjectKind: AnalyticsSubjectKind,
	/** `null` only when `subjectKind` is `platform`. */
	subjectId: z.string().nullable(),
	actorUserId: z.string().nullable(),
	projectId: z.string().nullable(),
	value: z.number().nullable(),
	properties: z.record(z.string(), z.unknown()),
});
export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>;

/** A row of `analytics.daily_rollups` — one pre-calculated metric per day per subject. */
export const DailyRollupSchema = z.object({
	id: z.string(),
	/** `YYYY-MM-DD`. */
	day: z.string(),
	metric: z.string().min(1).max(120),
	subjectKind: AnalyticsSubjectKind,
	subjectId: z.string().nullable(),
	/** Optional breakdown (plan code, entitlement key, standing level, CREATE category). */
	dimensions: z.record(z.string(), z.unknown()),
	value: z.number(),
	sampleCount: z.number().int().min(0),
	computedAt: z.string(),
});
export type DailyRollup = z.infer<typeof DailyRollupSchema>;
// #endregion

// #region RPC input
/**
 * Input to `analytics.fn_emit`. The actor is resolved server-side from the session — a client-supplied
 * actor is honoured only for privileged callers, so an event can never be attributed to someone else.
 */
export const EmitEventSchema = z.object({
	name: z.string().min(1).max(120),
	subjectKind: AnalyticsSubjectKind,
	subjectId: z.string().nullable().optional(),
	properties: z.record(z.string(), z.unknown()).optional(),
	value: z.number().nullable().optional(),
	projectId: z.string().nullable().optional(),
	domain: z.string().max(60).nullable().optional(),
});
export type EmitEvent = z.infer<typeof EmitEventSchema>;
// #endregion
