import { z } from "zod";

/**
 * explore.items — the Zod SSOT for the discovery domain shapes (freelancers, teams, users,
 * businesses, services, projects, products, articles) surfaced on `/explore`.
 *
 * These are the shapes the fat {@link ExploreBackendService} returns and the app's cards render. They
 * currently back curated fixtures; when the discovery API/tables land, the same schemas validate the
 * DB reads (root CLAUDE.md §1, the Zod SSOT rule). Only enum/array/object/number/string primitives are
 * used so the schema is stable across Zod majors (matching `org/organisations.ts`).
 */

// #region Entity taxonomy
/** The eight browseable entity formats — the lowercase-plural tokens used verbatim in `?category=`. */
export const ExploreEntity = z.enum([
	"users",
	"freelancers",
	"teams",
	"businesses",
	"services",
	"projects",
	"products",
	"articles",
]);
export type ExploreEntity = z.infer<typeof ExploreEntity>;

/** The search/category selector vocabulary: every entity plus the neutral `all`. */
export const ExploreCategory = z.enum([
	"all",
	"users",
	"freelancers",
	"teams",
	"businesses",
	"services",
	"projects",
	"products",
	"articles",
]);
export type ExploreCategory = z.infer<typeof ExploreCategory>;

/** The four profile-shaped entities (route to `/[handle]`, not `/view/:id`). */
export const ProfileEntity = z.enum(["users", "freelancers", "teams", "businesses"]);
export type ProfileEntity = z.infer<typeof ProfileEntity>;
// #endregion

// #region Ratings
/** One star track — an average out of five plus the sample size. */
export const RatingTrackSchema = z.object({
	value: z.number(),
	count: z.number(),
});
export type RatingTrack = z.infer<typeof RatingTrackSchema>;

/** Dual-track reputation: `asHelper` = delivery reputation; `asClient` = client-behaviour reputation. */
export const DualRatingSchema = z.object({
	asHelper: RatingTrackSchema.optional(),
	asClient: RatingTrackSchema.optional(),
});
export type DualRating = z.infer<typeof DualRatingSchema>;
// #endregion

// #region Availability + skills
/** A freelancer's current booking load + availability detail. */
export const WorkloadSchema = z.object({
	level: z.number(),
	status: z.string(),
});
export type Workload = z.infer<typeof WorkloadSchema>;

/** The visual skill categories a tag resolves to (drives the category glyph on skill pills). */
export const SkillCategoryId = z.enum([
	"technical",
	"design",
	"motion",
	"content",
	"data",
	"spatial",
	"strategy",
	"other",
]);
export type SkillCategoryId = z.infer<typeof SkillCategoryId>;

/** A resolved skill tag: its display label plus the category it maps to. */
export const SkillRefSchema = z.object({
	label: z.string(),
	category: SkillCategoryId,
});
export type SkillRef = z.infer<typeof SkillRefSchema>;
// #endregion

// #region Owner attribution
/** The owner attribution shown on every card — the individual, team, or business behind the item. */
export const ExploreOwnerSchema = z.object({
	handle: z.string(),
	name: z.string(),
	avatar: z.string(),
	kind: z.enum(["user", "freelancer", "team", "business"]),
	verified: z.boolean().optional(),
});
export type ExploreOwner = z.infer<typeof ExploreOwnerSchema>;
// #endregion

// #region Items
/** Fields shared by every explore item (the discriminating `type` is added per subtype). */
const itemBase = {
	id: z.string(),
	title: z.string(),
	owner: ExploreOwnerSchema,
	skills: z.array(SkillRefSchema),
	rating: DualRatingSchema.optional(),
	summary: z.string(),
	/** Thumbnail/media URL. ABSENT on projects (projects never carry item media). */
	media: z.string().optional(),
	/** Promoted/sponsored placement flag. */
	sponsored: z.boolean().optional(),
	/** ISO date — feeds the "Newest" sort. */
	createdAt: z.string(),
};

/** A profile-shaped item (users / freelancers / teams / businesses). */
export const ProfileItemSchema = z.object({
	...itemBase,
	type: ProfileEntity,
	craft: z.string(),
	cover: z.string(),
	delivered: z.number(),
	members: z.number().optional(),
	/** Languages worked in, short codes (e.g. `["EN","FR"]`) — card metadata. */
	languages: z.array(z.string()).optional(),
	/** Freelancers/teams: thumbnail URLs of top-rated work, revealed on hover. */
	highlights: z.array(z.string()).optional(),
	/** Freelancers only: prices of active linked services (the card derives a fenced floor). */
	servicePrices: z.array(z.number()).optional(),
	/** Freelancers only: count of currently listed digital products. */
	products: z.number().optional(),
	/** Freelancers only: current booking load + availability detail. */
	workload: WorkloadSchema.optional(),
});
export type ProfileItem = z.infer<typeof ProfileItemSchema>;

/** The engagement shape of a service. */
export const ServiceType = z.enum(["Pipeline", "One-Off", "Session"]);
export type ServiceType = z.infer<typeof ServiceType>;

/** A fixed-price, buy-now service offering (grid, with media). */
export const ServiceItemSchema = z.object({
	...itemBase,
	type: z.literal("services"),
	price: z.string(),
	delivery: z.string(),
	category: z.string(),
	serviceType: ServiceType,
});
export type ServiceItem = z.infer<typeof ServiceItemSchema>;

/** An open project accepting applications (text-forward — projects never carry item media). */
export const ProjectItemSchema = z.object({
	...itemBase,
	type: z.literal("projects"),
	org: z.string(),
	stage: z.string(),
	budget: z.string(),
	roles: z.array(z.string()),
	phases: z.array(z.string()),
});
export type ProjectItem = z.infer<typeof ProjectItemSchema>;

/** A ready-to-buy digital product (masonry cell, with media). */
export const ProductItemSchema = z.object({
	...itemBase,
	type: z.literal("products"),
	price: z.string(),
	category: z.string(),
	/** Masonry cell weight — drives the staggered column rhythm (1 = short, 3 = tall). */
	span: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
export type ProductItem = z.infer<typeof ProductItemSchema>;

/** A help/editorial article (grid/list combo, with a descriptive thumbnail). */
export const ArticleItemSchema = z.object({
	...itemBase,
	type: z.literal("articles"),
	topic: z.string(),
	readMinutes: z.number(),
});
export type ArticleItem = z.infer<typeof ArticleItemSchema>;

/** The union over every explore item, discriminated by `type`. */
export const ExploreItemSchema = z.union([
	ProfileItemSchema,
	ServiceItemSchema,
	ProjectItemSchema,
	ProductItemSchema,
	ArticleItemSchema,
]);
export type ExploreItem = z.infer<typeof ExploreItemSchema>;
// #endregion

// #region Promos
/** A promoted/sponsored frame reserved in the feed. */
export const SponsoredSlotSchema = z.object({
	id: z.string(),
	eyebrow: z.string(),
	title: z.string(),
	body: z.string(),
	media: z.string(),
	owner: ExploreOwnerSchema,
	href: z.string(),
	cta: z.string(),
});
export type SponsoredSlot = z.infer<typeof SponsoredSlotSchema>;

/** A help/support article surfaced as an informative feed break. */
export const HelpArticleSchema = z.object({
	id: z.string(),
	title: z.string(),
	minutes: z.number(),
	href: z.string(),
});
export type HelpArticle = z.infer<typeof HelpArticleSchema>;

/** A conversion call-to-action banner ("Become a Freelancer" / "Launch a Team"). */
export const CtaBannerSchema = z.object({
	id: z.string(),
	eyebrow: z.string(),
	title: z.string(),
	body: z.string(),
	href: z.string(),
	cta: z.string(),
	tone: z.enum(["primary", "neutral"]),
});
export type CtaBanner = z.infer<typeof CtaBannerSchema>;
// #endregion
