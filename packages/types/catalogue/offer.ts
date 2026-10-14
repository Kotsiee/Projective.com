import { z } from "zod";
import {
	BlueprintStageSchema,
	BlueprintTeamRoleSchema,
	ProductManifestEntrySchema,
} from "../explore/stored.ts";
import { MeetingProvider } from "../scheduling/meeting.ts";
import { AvailabilityBindingMode } from "../scheduling/presets.ts";

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

/** A Pipeline's offer: its stage blueprint and team. Publishing needs at least one stage. */
export const PipelineOfferSchema = z.object({
	archetype: z.literal("pipeline"),
	stages: z.array(MilestoneSchema).max(STAGES_MAX),
	teamRoles: z.array(TeamRoleSchema).max(STAGES_MAX),
});
export type PipelineOffer = z.infer<typeof PipelineOfferSchema>;
// #endregion

// #region Session offers
/** The session lengths offered as one-tap presets, in minutes. */
export const SESSION_DURATIONS = [15, 30, 45, 60, 90] as const;

/** A session length in minutes: a preset, or a custom length of 5–600. */
export const SessionMinutes = z.number().int().min(5).max(600);

const sessionFields = {
	minutes: SessionMinutes,
	/** Sittings in one booking. */
	count: z.number().int().min(1).max(52),
	/** The room provider; `null` uses the seller's connected default. */
	meetingProvider: MeetingProvider.nullable(),
};

/**
 * A 1-on-1 Session's offer. Its availability is not part of the offer: the preset binding is written
 * by its own route and read as `ListingDetail.availabilityBinding`.
 */
export const SessionOfferSchema = z.object({
	archetype: z.literal("session"),
	...sessionFields,
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
// #endregion
