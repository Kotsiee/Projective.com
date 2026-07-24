import { z } from "zod";

/**
 * `org` Standing & progression shapes — the EARNED ladder.
 *
 * Mirrors `org.standing_levels` / `entity_standing` / `standing_events` / `create_mastery` /
 * `achievements` / `entity_achievements` / `quality_streaks` and their resolver functions
 * (migration `20260724111000_standing_reputation.sql`). The migration, this SSOT, and
 * `documentation/database/org/*` land together (root CLAUDE.md §1).
 *
 * Standing is the DISCRETISED rung of the continuous Reliability Index ($R_i$) already specified in
 * `PRODUCT_SPEC.md` §Reputation & Discovery — {@link EntityStandingSchema.score} is the composite and
 * `level` is the ladder derived from it. It does not fork or replace $R_i$.
 *
 * ⚠️ **Standing can never be purchased.** No subscription plan, entitlement grant or payment writes to
 * any shape in this file. The paid ladder (`@projective/types/finance/plans.ts`) accelerates
 * *capacity*; only delivery moves a rung. Keeping the two ladders strictly separate is what makes the
 * rung a trustworthy signal to a client.
 */

// #region Vocabulary
/**
 * Standing applies to the three EARNING subjects. Clients/businesses/organisations carry the separate
 * Client Trust Score (`PRODUCT_SPEC.md` §Reciprocal Reviews) and are deliberately not ranked here.
 */
export const StandingSubject = z.enum(["user", "freelancer", "team"]);
export type StandingSubject = z.infer<typeof StandingSubject>;

/** `org.create_category` — the CREATE framework (`PRODUCT_SPEC.md` §The CREATE Framework). */
export const CreateCategory = z.enum(["create", "run", "educate", "advise", "test", "empower"]);
export type CreateCategory = z.infer<typeof CreateCategory>;

/**
 * `org.streak_kind` — QUALITY streaks only. There is deliberately no login/attendance member: a
 * streak must celebrate good work, never mere presence.
 */
export const StreakKind = z.enum([
	"on_time_delivery",
	"fast_response",
	"dispute_free",
	"client_repeat",
]);
export type StreakKind = z.infer<typeof StreakKind>;

/** `org.achievement_tier`. `designation` carries real capability (e.g. "Architect"). */
export const AchievementTier = z.enum(["milestone", "bronze", "silver", "gold", "designation"]);
export type AchievementTier = z.infer<typeof AchievementTier>;

/** The five rungs, 1 (New) → 5 (Elite). */
export const StandingLevelValue = z.number().int().min(1).max(5);
export type StandingLevelValue = z.infer<typeof StandingLevelValue>;
// #endregion

// #region Ladder configuration
/**
 * A row of `org.standing_levels` — the tunable ladder. Money perks live in finance
 * (`StandingCommissionTierSchema`); this shape carries only the non-money rungs.
 */
export const StandingLevelSchema = z.object({
	level: StandingLevelValue,
	code: z.string().min(1).max(40),
	label: z.string().min(1).max(60),
	minScore: z.number().min(0).max(100),
	/** Volume floor — a flawless single engagement must not vault a subject to the top. */
	minCompletedStages: z.number().int().min(0),
	/** Published-listing allowance a FREE subject enjoys at this rung (Pro multiplies it). */
	listingBase: z.number().int().min(0),
	/** Extra weekly proposals on top of the plan's base allowance. */
	proposalBonus: z.number().int().min(0),
	/** Discovery ranking multiplier in basis points (10000 = 1.0x). */
	discoveryWeightBp: z.number().int().min(0),
	description: z.string().nullable(),
});
export type StandingLevel = z.infer<typeof StandingLevelSchema>;
// #endregion

// #region Per-subject standing
/**
 * A row of `org.entity_standing` — the cached composite and its inputs.
 *
 * Every input is CLIENT-VALUED. Raw earnings and raw proposal counts are deliberately absent: ranking
 * by spend or by volume is exactly the pay-to-win trap this ladder exists to avoid.
 */
export const EntityStandingSchema = z.object({
	id: z.string(),
	subjectType: StandingSubject,
	subjectId: z.string(),
	level: StandingLevelValue,
	score: z.number().min(0).max(100),
	stagesCompleted: z.number().int().min(0),
	completionRate: z.number().min(0).max(1),
	onTimeRate: z.number().min(0).max(1),
	/** Dual-track reviews: what clients say… */
	clientRatingAvg: z.number().min(0).max(5),
	/** …and what collaborating peers say. */
	peerRatingAvg: z.number().min(0).max(5),
	disputeRate: z.number().min(0).max(1),
	/** Delivering at capacity without dropping tickets — the $W_i$ reliability signal. */
	workloadReliability: z.number().min(0).max(1),
	tenureDays: z.number().int().min(0),
	/** Active `security.penalties` severity, subtracted at recompute. */
	penaltySeverity: z.number(),
	/** Per-component contribution, for the "why am I this rung" surface. */
	components: z.record(z.string(), z.number()),
	levelChangedAt: z.string().nullable(),
	computedAt: z.string(),
	createdAt: z.string(),
});
export type EntityStanding = z.infer<typeof EntityStandingSchema>;

/** A row of `org.standing_events` — the append-only progression audit (private to the subject). */
export const StandingEventSchema = z.object({
	id: z.string(),
	subjectType: StandingSubject,
	subjectId: z.string(),
	eventType: z.enum(["recomputed", "promoted", "demoted", "penalty_applied", "manual_review"]),
	fromLevel: StandingLevelValue.nullable(),
	toLevel: StandingLevelValue.nullable(),
	score: z.number().nullable(),
	components: z.record(z.string(), z.number()),
	note: z.string().nullable(),
	createdAt: z.string(),
});
export type StandingEvent = z.infer<typeof StandingEventSchema>;
// #endregion

// #region Mastery
/**
 * A row of `org.create_mastery` — specialisation DERIVED from delivered work, never self-declared.
 * Because every stage is typed C/R/E/A/T/E, `shareBp` is a real matching signal that routes
 * Create-heavy stages to proven Create specialists. No other marketplace can compute this.
 */
export const CreateMasterySchema = z.object({
	id: z.string(),
	subjectType: StandingSubject,
	subjectId: z.string(),
	category: CreateCategory,
	stagesCompleted: z.number().int().min(0),
	/** Weighted by $W_i$ — a hard Create stage counts for more than a trivial one. */
	intensityDelivered: z.number().min(0),
	onTimeRate: z.number().min(0).max(1),
	/** This category's share of the subject's delivered intensity, in basis points. */
	shareBp: z.number().int().min(0).max(10000),
	masteryLevel: z.number().int().min(0).max(5),
	updatedAt: z.string(),
});
export type CreateMastery = z.infer<typeof CreateMasterySchema>;
// #endregion

// #region Achievements & streaks
/** A row of `org.achievements` — the catalogue. */
export const AchievementSchema = z.object({
	code: z.string().min(1).max(60),
	label: z.string().min(1).max(80),
	description: z.string().min(1),
	tier: AchievementTier,
	category: CreateCategory.nullable(),
	/** A reward a client would not respect must not be shown on a public profile. */
	isPublic: z.boolean(),
	isActive: z.boolean(),
});
export type Achievement = z.infer<typeof AchievementSchema>;

/** A row of `org.entity_achievements` — an award. Idempotent: one per (subject, code). */
export const EntityAchievementSchema = z.object({
	id: z.string(),
	subjectType: StandingSubject,
	subjectId: z.string(),
	achievementCode: z.string().min(1).max(60),
	awardedAt: z.string(),
	sourceRef: z.string().nullable(),
});
export type EntityAchievement = z.infer<typeof EntityAchievementSchema>;

/** A row of `org.quality_streaks` — consecutive good outcomes. */
export const QualityStreakSchema = z.object({
	id: z.string(),
	subjectType: StandingSubject,
	subjectId: z.string(),
	kind: StreakKind,
	currentCount: z.number().int().min(0),
	bestCount: z.number().int().min(0),
	lastEventAt: z.string().nullable(),
	brokenAt: z.string().nullable(),
});
export type QualityStreak = z.infer<typeof QualityStreakSchema>;
// #endregion

// #region Read projection
/** The public progression bundle a profile surface renders. */
export const StandingProfileSchema = z.object({
	standing: EntityStandingSchema,
	level: StandingLevelSchema,
	mastery: z.array(CreateMasterySchema),
	achievements: z.array(EntityAchievementSchema),
	streaks: z.array(QualityStreakSchema),
});
export type StandingProfile = z.infer<typeof StandingProfileSchema>;

/**
 * The pure rung resolver — mirrors `org.fn_level_for_score` exactly so the client can preview a rung
 * without a round trip. Both the score threshold AND the volume floor must be met.
 */
export function levelForScore(
	score: number,
	stagesCompleted: number,
	ladder: readonly StandingLevel[],
): StandingLevelValue {
	let resolved = 1;
	for (const rung of ladder) {
		if (score >= rung.minScore && stagesCompleted >= rung.minCompletedStages) {
			resolved = Math.max(resolved, rung.level);
		}
	}
	return resolved as StandingLevelValue;
}
// #endregion
