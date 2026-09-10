import { z } from "zod";
import {
	ArticleItemSchema,
	DualRatingSchema,
	ProjectItemSchema,
	ServiceItemSchema,
} from "../explore/items.ts";

/**
 * profile.tabs — the Zod SSOT for the consolidated profile tab system.
 *
 * The profile carries FOUR sections (root CLAUDE.md §8 Decision #96): **Work** (the index — client
 * proof, services, completed projects, the portfolio masonry, and the roster of a multi-member
 * entity) · **Experience** (career history, education, verified certifications) · **Reviews** ·
 * **Posts** (published articles). The eleven legacy tabs (services · products · projects · portfolio ·
 * education · teams · businesses · articles · members · departments · about) are RETIRED as routes and
 * 308 into their consolidated section via {@link LEGACY_TAB_TARGET}, so a bookmark never dies.
 *
 * Item collections still REUSE the discovery item SSOT (`@projective/types/explore`) so a profile
 * section renders through the SAME explore cards as `/explore` — the profile is another read
 * projection, not a parallel corpus. The masonry tile and the certification row are the two shapes
 * the discovery corpus has no analogue for, so they are owned here.
 */

// #region Tab vocabulary
/**
 * The four profile sections. `work` is the index (`/[handle]`); the rest map 1:1 to a
 * `/[handle]/<tab>` sub-route. Which of the four a kind shows is decided by the app's entity matrix
 * (`tabsFor`) — the vocabulary itself is closed.
 */
export const ProfileTab = z.enum(["work", "experience", "reviews", "posts"]);
export type ProfileTab = z.infer<typeof ProfileTab>;

/**
 * Every retired tab segment that used to be a `/[handle]/<segment>` route. Kept ONLY so the dynamic
 * `[tab]` route can recognise an old address and redirect it (308) rather than answer "section not
 * found" to a link that worked last week. Never rendered, never accepted by the API.
 */
export const LegacyProfileTab = z.enum([
	"about",
	"services",
	"products",
	"projects",
	"portfolio",
	"education",
	"teams",
	"businesses",
	"articles",
	"members",
	"departments",
]);
export type LegacyProfileTab = z.infer<typeof LegacyProfileTab>;

/**
 * Where each retired segment lands. Anything that was WORK a visitor could buy, browse or hire
 * against folds into the Work index; the two learning-history tabs fold into Experience; articles
 * become Posts. The multi-member rosters (members · departments · teams · businesses) also land on
 * Work, which is where the roster now renders for a team / business / organisation.
 */
export const LEGACY_TAB_TARGET: Record<LegacyProfileTab, ProfileTab> = {
	about: "work",
	services: "work",
	products: "work",
	projects: "work",
	portfolio: "work",
	education: "experience",
	teams: "work",
	businesses: "work",
	articles: "posts",
	members: "work",
	departments: "work",
};
// #endregion

// #region Structured (non-item) tab entries
/** An education entry (individuals only). */
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

/** A work-experience entry (individuals only). */
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

/**
 * A professional certification (Experience section). `verified` is a PLATFORM claim — the credential
 * was checked against its issuer — and is the only reason the row may carry the trust crest; an
 * unverified row renders the same text with no mark, never a "pending" chip (§B.11: a status is a
 * state that can change, and an unverified certificate is simply a certificate).
 */
export const CertificationEntrySchema = z.object({
	id: z.string(),
	name: z.string(),
	issuer: z.string(),
	/** Year (or ISO date) the credential was issued. */
	issued: z.string(),
	/** Year the credential lapses, when it does. */
	expires: z.string().optional(),
	verified: z.boolean(),
	logo: z.string().optional(),
	/** Public verification URL at the issuer, when one exists. */
	credentialUrl: z.string().optional(),
});
export type CertificationEntry = z.infer<typeof CertificationEntrySchema>;

/** A member of a team / business / organisation (Work roster), links to their own `/@handle`. */
export const MemberEntrySchema = z.object({
	handle: z.string(),
	name: z.string(),
	avatar: z.string(),
	/** Their role in the entity (e.g. "Founder", "Design lead"). */
	role: z.string(),
	/** Entity kind of the member (drives which reputation applies). */
	kind: z.enum(["user", "freelancer"]),
	/**
	 * Department ids this member belongs to (Organisation only). A member may sit in MORE than one
	 * department — the grouped roster renders their row under every listed department. Empty for
	 * team/business members (a flat roster). Ids reference {@link DepartmentEntry.id}.
	 */
	departments: z.array(z.string()).default([]),
});
export type MemberEntry = z.infer<typeof MemberEntrySchema>;

/**
 * A department within an Organisation (the grouping key for the Work roster). A profile-level read
 * projection — no DB table yet; the eventual `org.departments` table validates against the same shape.
 */
export const DepartmentEntrySchema = z.object({
	/** Stable id — the grouping key {@link MemberEntry.departments} references. */
	id: z.string(),
	/** Display name (e.g. "Design", "Engineering", "Operations"). */
	name: z.string(),
	/** One-line remit of the department. */
	summary: z.string().optional(),
	/** Handle of the department lead (links to their `/@handle`), when set. */
	leadHandle: z.string().optional(),
	/** Number of members assigned to the department (a member in N departments counts in each). */
	memberCount: z.number(),
});
export type DepartmentEntry = z.infer<typeof DepartmentEntrySchema>;

/** The reviewer's stance — a review left as the counterparty's CLIENT or as their FREELANCER. */
export const ReviewRole = z.enum(["client", "freelancer"]);
export type ReviewRole = z.infer<typeof ReviewRole>;

/** A single reciprocal review (Reviews section). */
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

// #region Work pieces (the portfolio masonry)
/** The media a portfolio tile is made of. */
export const WorkPieceMediaSchema = z.object({
	kind: z.enum(["image", "video"]),
	src: z.string(),
	/** A still for a video tile (the frame drawn before playback, and the print fallback). */
	poster: z.string().optional(),
	/**
	 * Intrinsic width ÷ height. The masonry reserves the tile's box from this BEFORE the bytes arrive,
	 * so a column never reflows as images land — a tile that changes height under the pointer is the
	 * one class of layout shift a hover-revealed caption cannot survive.
	 */
	aspect: z.number().positive(),
	alt: z.string(),
});
export type WorkPieceMedia = z.infer<typeof WorkPieceMediaSchema>;

/**
 * One portfolio tile. The three captions (title · client · category) are the ONLY text a tile ever
 * carries, and it carries them on hover (or permanently below `--bp-md`) — a tile at rest is media.
 */
export const WorkPieceSchema = z.object({
	id: z.string(),
	title: z.string(),
	/** The client the piece was made for, when it is disclosed. */
	client: z.string().optional(),
	category: z.string(),
	media: WorkPieceMediaSchema,
	/** Where the tile opens — the profile-scoped item viewer. */
	href: z.string(),
});
export type WorkPiece = z.infer<typeof WorkPieceSchema>;
// #endregion

// #region Tab payload
/**
 * The payload for one profile section. Discriminated by `tab`; only the relevant collection(s) are
 * populated (the renderer reads what it needs). Item collections reuse the discovery item schemas so
 * they flow straight into the shared explore cards.
 *
 * Work: `services` · `openProjects` · `pastProjects` · `pieces` · `members` (+ `departments`).
 * Experience: `experience` · `education` · `certifications`.
 * Reviews: `reviews` · `reviewSummary`.
 * Posts: `articles`.
 */
export const ProfileTabPayloadSchema = z.object({
	handle: z.string(),
	tab: ProfileTab,
	/** Work — the seller's packaged offers (sellers only; empty for a buyer entity). */
	services: z.array(ServiceItemSchema).default([]),
	/** Work — open / hiring engagements (a buyer entity's live briefs). */
	openProjects: z.array(ProjectItemSchema).default([]),
	/** Work — past / completed engagements. */
	pastProjects: z.array(ProjectItemSchema).default([]),
	/** Work — the portfolio masonry. */
	pieces: z.array(WorkPieceSchema).default([]),
	/** Work — the roster of a team / business / organisation. */
	members: z.array(MemberEntrySchema).default([]),
	/** Work — the department set an organisation's roster is grouped by. */
	departments: z.array(DepartmentEntrySchema).default([]),
	/** Experience. */
	experience: z.array(ExperienceEntrySchema).default([]),
	education: z.array(EducationEntrySchema).default([]),
	certifications: z.array(CertificationEntrySchema).default([]),
	/** Reviews. */
	reviews: z.array(ReviewEntrySchema).default([]),
	/** Reviews — the dual-track summary (freelancer + client). */
	reviewSummary: DualRatingSchema.optional(),
	/** Posts. */
	articles: z.array(ArticleItemSchema).default([]),
});
export type ProfileTabPayload = z.infer<typeof ProfileTabPayloadSchema>;

/** Narrow helpers — the item subtypes a section yields (so the app can cast for a typed collection). */
export type ProfileServiceItem = z.infer<typeof ServiceItemSchema>;
export type ProfileArticleItem = z.infer<typeof ArticleItemSchema>;
export type ProfileProjectItem = z.infer<typeof ProjectItemSchema>;
// #endregion
