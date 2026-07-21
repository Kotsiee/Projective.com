import { z } from "zod";
import {
	ArticleItemSchema,
	ExploreItemSchema,
	ProductItemSchema,
	ProfileItemSchema,
	ProjectItemSchema,
	ServiceItemSchema,
} from "../explore/items.ts";
import { DualRatingSchema } from "../explore/items.ts";

/**
 * profile.tabs — the Zod SSOT for the entity-driven profile tab system.
 *
 * The tab bar is CONDITIONAL on the profile's {@link ProfileKind} (root CLAUDE.md — the entity tab
 * matrix): a client shows Projects/Articles/Businesses/Reviews; a freelancer the full craft set; a
 * business adds Members; a team is the union minus Education/Experience. This module owns the tab
 * vocabulary and the per-tab payload shape. Item grids REUSE the discovery item SSOT
 * (`@projective/types/explore`) so a profile tab renders through the SAME explore cards as `/explore`
 * — the profile is another read projection, not a parallel corpus.
 */

// #region Tab vocabulary
/**
 * Every profile tab. `about` is the always-present overview (the `/[handle]` index). The rest map 1:1
 * to a `/[handle]/<tab>` sub-route and are shown per the entity matrix.
 */
export const ProfileTab = z.enum([
	"about",
	"services",
	"products",
	"projects",
	"portfolio",
	"education",
	"experience",
	"teams",
	"businesses",
	"articles",
	"reviews",
	"members",
]);
export type ProfileTab = z.infer<typeof ProfileTab>;
// #endregion

// #region Structured (non-item) tab entries
/** An education entry (Freelancer only). */
export const EducationEntrySchema = z.object({
	id: z.string(),
	school: z.string(),
	credential: z.string(),
	field: z.string(),
	start: z.string(),
	end: z.string().optional(),
	logo: z.string().optional(),
});
export type EducationEntry = z.infer<typeof EducationEntrySchema>;

/** A work-experience entry (Freelancer only). */
export const ExperienceEntrySchema = z.object({
	id: z.string(),
	org: z.string(),
	role: z.string(),
	start: z.string(),
	end: z.string().optional(),
	/** Currently active (renders "Present"). */
	current: z.boolean().optional(),
	summary: z.string(),
	logo: z.string().optional(),
});
export type ExperienceEntry = z.infer<typeof ExperienceEntrySchema>;

/** A member of a team / business (Members tab), links to their own `/@handle`. */
export const MemberEntrySchema = z.object({
	handle: z.string(),
	name: z.string(),
	avatar: z.string(),
	/** Their role in the entity (e.g. "Founder", "Design lead"). */
	role: z.string(),
	/** Entity kind of the member (drives which reputation applies). */
	kind: z.enum(["user", "freelancer"]),
});
export type MemberEntry = z.infer<typeof MemberEntrySchema>;

/** The reviewer's stance — a review left as the counterparty's CLIENT or as their FREELANCER. */
export const ReviewRole = z.enum(["client", "freelancer"]);
export type ReviewRole = z.infer<typeof ReviewRole>;

/** A single reciprocal review (Reviews tab). */
export const ReviewEntrySchema = z.object({
	id: z.string(),
	authorName: z.string(),
	authorHandle: z.string(),
	authorAvatar: z.string(),
	/** Whether the author reviewed this profile as its client, or as its fellow freelancer. */
	role: ReviewRole,
	/** 0–5. */
	rating: z.number(),
	/** ISO date. */
	date: z.string(),
	body: z.string(),
	/** The engagement the review is attached to. */
	contextTitle: z.string().optional(),
});
export type ReviewEntry = z.infer<typeof ReviewEntrySchema>;
// #endregion

// #region Tab payload
/**
 * The payload for one profile tab. Discriminated by `tab`; only the relevant collection(s) are
 * populated (the renderer reads what it needs). Item collections reuse the discovery item schemas so
 * they flow straight into the shared explore cards/collections. Projects split into two sub-views —
 * open/available and past/completed (root CLAUDE.md — the Projects tab spec).
 */
export const ProfileTabPayloadSchema = z.object({
	handle: z.string(),
	tab: ProfileTab,
	/** Generic item grid (services · products · portfolio · articles · teams · businesses). */
	items: z.array(ExploreItemSchema).default([]),
	/** Projects tab — open/available engagements. */
	openProjects: z.array(ProjectItemSchema).default([]),
	/** Projects tab — past/completed engagements. */
	pastProjects: z.array(ProjectItemSchema).default([]),
	/** Education tab. */
	education: z.array(EducationEntrySchema).default([]),
	/** Experience tab. */
	experience: z.array(ExperienceEntrySchema).default([]),
	/** Members tab (team/business). */
	members: z.array(MemberEntrySchema).default([]),
	/** Reviews tab entries. */
	reviews: z.array(ReviewEntrySchema).default([]),
	/** Reviews tab — the dual-track summary (freelancer + client). */
	reviewSummary: DualRatingSchema.optional(),
});
export type ProfileTabPayload = z.infer<typeof ProfileTabPayloadSchema>;

/** Narrow helpers — the item subtypes a given tab yields (so the app can cast for a typed collection). */
export type ProfileServiceItem = z.infer<typeof ServiceItemSchema>;
export type ProfileProductItem = z.infer<typeof ProductItemSchema>;
export type ProfileArticleItem = z.infer<typeof ArticleItemSchema>;
export type ProfileProfileItem = z.infer<typeof ProfileItemSchema>;
// #endregion
