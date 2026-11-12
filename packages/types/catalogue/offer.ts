import { z } from "zod";
import {
	type BlueprintSessionPlanEntry,
	BlueprintSessionPlanEntrySchema,
	BlueprintStageSchema,
	BlueprintTeamRoleSchema,
	ProductManifestEntrySchema,
	SESSION_PLAN_MAX,
} from "../explore/stored.ts";
import { MeetingProvider } from "../scheduling/meeting.ts";
import { AvailabilityBindingMode } from "../scheduling/presets.ts";
import type { AvailabilityPreset } from "../scheduling/recurrence.ts";
import { stageCostCents } from "../projects/board.ts";

/**
 * catalogue.offer — what a listing actually sells, per form archetype (plan §7.1).
 *
 * One discriminated union keyed on the archetype `formArchetypeOf()` resolves, so the workspace's
 * Offer section and `save_listing` agree on which fields exist for which listing. The stored
 * documents underneath (`stage_template`, `team_roles`, `file_manifest`) keep their element shapes
 * in `explore/stored.ts`; this module only extends them with what the editor adds.
 */

// #region Product
/** The licence a product is sold under (`catalogue.product_licence`, Decision #217(i)). */
export const ListingLicence = z.enum(["personal", "commercial", "extended"]);
export type ListingLicence = z.infer<typeof ListingLicence>;

/**
 * How a product is delivered, as stored (`catalogue.product_format`). The `/view` page shows its own
 * display vocabulary (`ProductFormat`), derived from this one; the editor writes this one.
 */
export const ListingProductFormat = z.enum([
	"download",
	"template",
	"preset",
	"font",
	"course",
	"ebook",
	"source_code",
	"bundle",
]);
export type ListingProductFormat = z.infer<typeof ListingProductFormat>;

/**
 * One entry of a product's delivered bundle (`catalogue.products.file_manifest`). `fileId` names the
 * library file it delivers; an entry without one only describes the bundle and attaches nothing.
 */
export const AttachmentRefSchema = ProductManifestEntrySchema.extend({
	fileId: z.string().uuid().optional(),
});
export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;

/** The most files a product bundle lists. */
export const PRODUCT_ATTACHMENTS_MAX = 24;

/** A digital product's offer: how it is delivered, under which licence, and what is in it. */
export const ProductOfferSchema = z.object({
	archetype: z.literal("product"),
	format: ListingProductFormat,
	licence: ListingLicence,
	attributionRequired: z.boolean(),
	attachments: z.array(AttachmentRefSchema).max(PRODUCT_ATTACHMENTS_MAX),
});
export type ProductOffer = z.infer<typeof ProductOfferSchema>;
// #endregion

// #region Stages and roles
export { StartTrigger } from "../explore/stored.ts";

/** The `public.start_trigger_type` members a listing's stages instantiate as. */
export const StageTriggerDb = z.enum(["on_project_start", "dependent_on_stage"]);
export type StageTriggerDb = z.infer<typeof StageTriggerDb>;

/**
 * One stage or milestone as the workspace edits it (`service_blueprints.stage_template`). The stored
 * stage already carries its start trigger, so the editor's shape is the stored one.
 */
export const MilestoneSchema = BlueprintStageSchema;
export type Milestone = z.infer<typeof MilestoneSchema>;

/** One named role on the listing's team (`service_blueprints.team_roles`). */
export const TeamRoleSchema = BlueprintTeamRoleSchema;
export type TeamRole = z.infer<typeof TeamRoleSchema>;

/** The most stages, milestones or team roles one listing carries. */
export const STAGES_MAX = 12;

/** How a stage's trigger instantiates as `project_stages` columns. */
export interface StageTriggerColumns {
	startTriggerType: StageTriggerDb;
	/** `start_dependency_stage_id` points at the previous stage. */
	dependsOnPrevious: boolean;
	lagDays: number;
}

/**
 * Map an authored trigger onto `project_stages` (`start_trigger_type`, the dependency and its lag).
 * The first stage has nothing before it, so it always starts with the project.
 */
export function stageTriggerToDb(
	stage: Pick<Milestone, "startTrigger" | "lagDays">,
	index: number,
): StageTriggerColumns {
	if (index === 0 || stage.startTrigger === "on_project_start") {
		return { startTriggerType: "on_project_start", dependsOnPrevious: false, lagDays: 0 };
	}
	return {
		startTriggerType: "dependent_on_stage",
		dependsOnPrevious: true,
		lagDays: stage.startTrigger === "fixed_offset" ? stage.lagDays : 0,
	};
}
// #endregion

// #region Delivery offers
/** One scope line on a One-Off ("Two rounds of logo concepts"). */
export const ScopeItem = z.string().trim().min(1).max(140);

/**
 * A One-Off's offer: its milestones, turnaround and scope. A Direct Deliverable uses the same form
 * and also names its team; `teamRoles` is empty for a plain One-Off.
 */
export const OneOffOfferSchema = z.object({
	archetype: z.literal("one_off"),
	milestones: z.array(MilestoneSchema).max(STAGES_MAX),
	/** Delivery time in days; `null` until the seller sets it. */
	turnaroundDays: z.number().int().min(1).max(90).nullable(),
	scope: z.array(ScopeItem).max(24),
	teamRoles: z.array(TeamRoleSchema).max(STAGES_MAX),
});
export type OneOffOffer = z.infer<typeof OneOffOfferSchema>;

/**
 * A Pipeline's offer: its stage blueprint and team. Publishing needs at least one stage.
 *
 * `allowTieredIntensity` (`service_blueprints.allow_tiered_intensity`, Decision #417) is how the stages
 * sell. Off, the default for a productised service, each stage sells at its one `intensity` and
 * `priceCents`, and a client cannot change either on a ticket. On, the client picks Low · Standard ·
 * High per ticket, at the stage's own `lowPriceCents` / `highPriceCents` where set.
 */
export const PipelineOfferSchema = z.object({
	archetype: z.literal("pipeline"),
	stages: z.array(MilestoneSchema).max(STAGES_MAX),
	allowTieredIntensity: z.boolean().default(false),
	teamRoles: z.array(TeamRoleSchema).max(STAGES_MAX),
});
export type PipelineOffer = z.infer<typeof PipelineOfferSchema>;

/** What one ticket in a stage costs a buyer, from its cheapest tier to its dearest, in minor units. */
export interface StagePriceSpan {
	low: number;
	high: number;
}

/**
 * A blueprint stage's per-ticket price as buyers see it (Decision #417): ONE price when the service
 * sells each stage at a fixed intensity, the Low–High span when it is tiered — the seller's own tier
 * prices where set, else the Standard price at the platform's tier multiples ({@link stageCostCents}).
 * The Standard price is the stage's own, else the listing's baseline ticket; `null` when neither is set.
 */
export function stagePriceSpan(
	stage: Pick<Milestone, "priceCents" | "lowPriceCents" | "highPriceCents">,
	tiered: boolean,
	baselineMinor: number | null,
): StagePriceSpan | null {
	const standard = stage.priceCents ?? baselineMinor;
	if (!tiered) return standard === null ? null : { low: standard, high: standard };
	const terms = { lowPriceCents: stage.lowPriceCents ?? null, highPriceCents: stage.highPriceCents ?? null };
	const low = stageCostCents(standard, "low", terms);
	const high = stageCostCents(standard, "high", terms);
	return low === null || high === null ? null : { low, high };
}

/**
 * Why a tiered stage's own prices cannot be saved, or `null` — Low never above the stage's price and
 * High never below it, each compared only where both are set (`catalogue.fn_tier_prices_ordered`).
 */
export function tierPriceProblem(
	stage: Pick<Milestone, "priceCents" | "lowPriceCents" | "highPriceCents">,
): string | null {
	const low = stage.lowPriceCents ?? null;
	const high = stage.highPriceCents ?? null;
	const standard = stage.priceCents ?? null;
	if (low !== null && high !== null && low > high) return "The Low price cannot be above the High price.";
	if (low !== null && standard !== null && low > standard) {
		return "The Low price cannot be above the stage's price.";
	}
	if (high !== null && standard !== null && high < standard) {
		return "The High price cannot be below the stage's price.";
	}
	return null;
}
// #endregion

// #region Session offers
/** The session lengths offered as one-tap presets, in minutes. */
export const SESSION_DURATIONS = [15, 30, 45, 60, 90] as const;

/** A session length in minutes: a preset, or a custom length of 5–600. */
export const SessionMinutes = z.number().int().min(5).max(600);

const sessionFields = {
	minutes: SessionMinutes,
	/** Sittings in one booking. */
	count: z.number().int().min(1).max(SESSION_PLAN_MAX),
	/** The room provider; `null` uses the seller's connected default. */
	meetingProvider: MeetingProvider.nullable(),
	/** What each sitting covers, by position (`session_plan`). At most {@link count} entries are read. */
	plan: z.array(BlueprintSessionPlanEntrySchema).max(SESSION_PLAN_MAX),
};

/**
 * A 1-on-1 Session's offer. Its availability is not part of the offer: the preset binding is written
 * by its own route and read as `ListingDetail.availabilityBinding`.
 *
 * `rolling` is the ongoing model (`session_rolling`): each booking is one session and the buyer books
 * again whenever they need another, so a rolling offer always carries `count: 1` and an empty plan.
 */
export const SessionOfferSchema = z.object({
	archetype: z.literal("session"),
	...sessionFields,
	rolling: z.boolean(),
});
export type SessionOffer = z.infer<typeof SessionOfferSchema>;

/** A Group Session's offer. Seats per sitting are priced, so they live on `ListingPricing`. */
export const CohortListingOfferSchema = z.object({
	archetype: z.literal("cohort"),
	...sessionFields,
	maxSeatsPerCohort: z.number().int().min(1).max(500),
	continuousEnrollment: z.boolean(),
});
export type CohortListingOffer = z.infer<typeof CohortListingOfferSchema>;

/**
 * A session offer's plan as it should be stored: one entry per sitting, cut to the count, with
 * trailing blank entries dropped. A rolling offer has no plan.
 */
export function normaliseSessionPlan(
	offer: Pick<SessionOffer | CohortListingOffer, "count" | "plan"> & { rolling?: boolean },
): BlueprintSessionPlanEntry[] {
	if (offer.rolling) return [];
	const plan = offer.plan.slice(0, offer.count).map((entry) => ({
		title: entry.title.trim(),
		description: entry.description.trim(),
	}));
	while (plan.length > 0 && !plan[plan.length - 1].title && !plan[plan.length - 1].description) {
		plan.pop();
	}
	return plan;
}
// #endregion

// #region Union
/** A listing's offer, discriminated by its form archetype. */
export const ListingOfferSchema = z.discriminatedUnion("archetype", [
	ProductOfferSchema,
	OneOffOfferSchema,
	PipelineOfferSchema,
	SessionOfferSchema,
	CohortListingOfferSchema,
]);
export type ListingOffer = z.infer<typeof ListingOfferSchema>;
// #endregion

// #region Availability binding
/**
 * Which availability a Session or Group Session books against (Decision #217(c)): the schedule's
 * default preset, a library preset, or a preset forked for this listing alone. `presetName` is the
 * resolved name, so the binding line reads "Uses General" without a second lookup.
 */
export const ListingAvailabilityBindingSchema = z.object({
	mode: AvailabilityBindingMode,
	presetId: z.string().max(64).nullable(),
	presetName: z.string().max(60),
}).refine((b) => (b.mode === "default") === (b.presetId === null), {
	message: "A preset binding names its preset; the default binding names none.",
	path: ["presetId"],
});
export type ListingAvailabilityBinding = z.infer<typeof ListingAvailabilityBindingSchema>;

/**
 * What `POST /api/catalogue/availability` answers: the listing's binding as now stored, and the
 * preset it resolves to (`null` when the schedule has no default yet).
 */
export interface BindListingAvailabilityResult {
	binding: ListingAvailabilityBinding | null;
	preset: AvailabilityPreset | null;
}
// #endregion
