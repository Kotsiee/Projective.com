import { z } from "zod";
import {
	ExploreItemSchema,
	ExploreOwnerSchema,
	ProjectClassification,
	RatingTrackSchema,
	SkillRefSchema,
} from "./items.ts";

/**
 * explore.view — the Zod SSOT for the public Entity View page (`/view/[id]`).
 *
 * The item detail page is a composed READ projection over the discovery corpus: the item itself plus
 * its derived media gallery, resolved pricing/trust facts, cross-sell rails ("more by this creator" /
 * "similar"), and its aggregated reviews. The fat {@link ExploreBackendService.viewPage} builds this
 * (deterministically, from fixtures today; from the discovery + reviews tables when they land — the
 * same schema validates both). Only primitive/enum/object/array/number/string forms are used so the
 * schema stays stable across Zod majors (matching the rest of this domain).
 */

// #region Media gallery
/** One media asset in the hero showcase gallery. */
export const EntityMediaSchema = z.object({
	/** Full-resolution source (opened in the lightbox). */
	src: z.string(),
	/** A smaller thumbnail crop of the same asset (the vertical strip + lightbox tray). */
	thumb: z.string(),
	/** Alt text — empty for purely decorative crops. */
	alt: z.string(),
	kind: z.enum(["image", "video"]),
});
export type EntityMedia = z.infer<typeof EntityMediaSchema>;
// #endregion

// #region Pricing
/**
 * The resolved price block shown in the sidebar action panel. `mode` drives the presentation:
 * `fixed` → `$X`; `pipeline` → `$Min – $Max / ticket`; `session` → `$X / session`. `display` is the
 * fully-formatted primary string; `caption` is an optional secondary line (e.g. the range basis).
 */
export const EntityPricingSchema = z.object({
	mode: z.enum(["fixed", "pipeline", "session", "quote"]),
	display: z.string(),
	caption: z.string().optional(),
	/** Numeric bounds (for a pipeline range) — presentation already formatted into `display`. */
	min: z.number().optional(),
	max: z.number().optional(),
});
export type EntityPricing = z.infer<typeof EntityPricingSchema>;
// #endregion

// #region Trust & operational meta
/** One trust/operational fact chip in the sidebar (response time, delivery guarantee, …). */
export const TrustFactSchema = z.object({
	/** Iconographic key the UI maps to a glyph. */
	icon: z.enum(["response", "delivery", "seller", "escrow", "revisions", "returns"]),
	label: z.string(),
	value: z.string(),
});
export type TrustFact = z.infer<typeof TrustFactSchema>;
// #endregion

// #region Reviews
/** The 1★–5★ histogram (index 0 = 1★ … index 4 = 5★). */
export const ReviewDistributionSchema = z.array(z.number()).length(5);
export type ReviewDistribution = z.infer<typeof ReviewDistributionSchema>;

/** The aggregate reputation for the item's creator, powering the breakdown chart + summary line. */
export const ReviewSummarySchema = z.object({
	average: z.number(),
	count: z.number(),
	distribution: ReviewDistributionSchema,
	/** Optional split reputation tracks (a freelancer/user carries both). */
	asHelper: RatingTrackSchema.optional(),
	asClient: RatingTrackSchema.optional(),
});
export type ReviewSummary = z.infer<typeof ReviewSummarySchema>;

/** A single client/freelancer review in the filterable list. */
export const EntityReviewSchema = z.object({
	id: z.string(),
	author: ExploreOwnerSchema,
	rating: z.number(),
	/** Which reputation track this review scores. */
	track: z.enum(["helper", "client"]),
	title: z.string(),
	body: z.string(),
	/** ISO date — drives the "recent" sort. */
	createdAt: z.string(),
	/** Human date label (`Jun 2026`). */
	dateLabel: z.string(),
	/** The reciprocal-review badge: both parties rated each other on the engagement. */
	reciprocal: z.boolean(),
	/** "Verified purchase / completed engagement" trust marker. */
	verifiedEngagement: z.boolean(),
});
export type EntityReview = z.infer<typeof EntityReviewSchema>;
// #endregion

// #region Project view — stage flow + finance
/**
 * explore.view (projects) — the extra composed data the custom **Projects** view template renders on
 * top of the base {@link EntityViewSchema}. A project view mirrors the profile page's banner/avatar
 * chrome (`banner` is the uploader's profile banner, resolved server-side so the two agree) and adds
 * the interactive Stage Flow (per-stage description, flexible seat/role openings, required skills) plus
 * a resolved finance summary + key-metric chips for the side nav. Present only when `item.type` is
 * `projects`; derived deterministically from the project's `classification`/`phases`/`roles`/`budget`.
 */

/** A stage's lifecycle position in the pipeline — drives the Stage Flow visualizer treatment. */
export const ProjectStageStatus = z.enum(["completed", "active", "upcoming"]);
export type ProjectStageStatus = z.infer<typeof ProjectStageStatus>;

/**
 * A per-ticket price — a single **fixed** amount when `min === max`, otherwise a **min/max range**.
 * Every seat pool / role prices its tickets this way, so the UI renders one shape for both (`label`
 * is pre-formatted: `$180 / ticket` for a fixed price, `$120 – $480 / ticket` for a range).
 */
export const TicketPriceSchema = z.object({
	min: z.number(),
	max: z.number(),
	/** Pre-formatted display label (`$180 / ticket` or `$120 – $480 / ticket`). */
	label: z.string(),
});
export type TicketPrice = z.infer<typeof TicketPriceSchema>;

/**
 * How a stage structures its openings: a flat pool of **open seats** (a general description + a shared
 * ticket price) or named **open roles** (each role carries its own open-seat count + ticket price).
 */
export const StageSeatKind = z.enum(["seats", "roles"]);
export type StageSeatKind = z.infer<typeof StageSeatKind>;

/**
 * A stage's revision allowance — how many rounds are included, and what one costs after that.
 *
 * It sits on the STAGE rather than on the listing because a revision is scoped to a deliverable: a
 * discovery stage and a production stage are revised against different acceptance criteria, and a
 * seller who includes three rounds on the artwork does not thereby owe three rounds on the brief. The
 * listing-level figure a seller declares is the DEFAULT every stage inherits; a stage may state its
 * own without the two contradicting each other, because only the stage's is ever rendered.
 *
 * `extraPrice` reuses {@link TicketPriceSchema} verbatim — a revision is billed as a ticket, so
 * forking a second money shape here would give the surface two ways to round the same amount.
 */
export const StageRevisionsSchema = z.object({
	/** Rounds included at no extra cost. `0` means none are included, which is a real offer. */
	free: z.number().int().min(0),
	/** The per-round cost once the free allowance is spent. `min === max === 0` means free beyond it. */
	extraPrice: TicketPriceSchema,
});
export type StageRevisions = z.infer<typeof StageRevisionsSchema>;

/**
 * Which of the three offers a revision allowance actually is.
 *
 * The two numbers interact, and reading them independently produces sentences that contradict
 * themselves: "2 free revisions, then free" says the 2 means something when it does not. So the
 * classification is made ONCE, here, and every surface that renders an allowance asks this rather than
 * branching on the fields itself — the lane, the stage ledger and the listing's trust row would
 * otherwise be three chances to describe one commitment differently.
 *
 * - `unlimited` — further rounds cost nothing, so the included count is irrelevant.
 * - `included`  — N rounds are part of the price, and the ones after that are billed.
 * - `metered`   — nothing is included; every round is billed.
 */
export type RevisionAllowanceKind = "unlimited" | "included" | "metered";

/** Classify a stage's revision allowance. Pure and total. */
export function revisionAllowanceKind(revisions: StageRevisions): RevisionAllowanceKind {
	if (revisions.extraPrice.max <= 0) return "unlimited";
	return revisions.free > 0 ? "included" : "metered";
}

/** One named open role in a stage's Open Roles structure — its title, open-seat count, and ticket price. */
export const StageRoleSchema = z.object({
	name: z.string(),
	/** How many seats this role is recruiting. */
	openSeats: z.number(),
	/** The per-ticket price for this role (fixed or a range). */
	price: TicketPriceSchema,
});
export type StageRole = z.infer<typeof StageRoleSchema>;

/** One stage in the project — the unit the Stage Flow visualizer expands. */
export const ProjectStageSchema = z.object({
	/** Slug id — the stable in-page anchor the side-nav quick-jumps target. */
	id: z.string(),
	/** 1-based order in the pipeline. */
	index: z.number(),
	name: z.string(),
	description: z.string(),
	status: ProjectStageStatus,
	/** Which opening structure this stage uses — a general seat pool or named roles. */
	seatKind: StageSeatKind,
	/** Open Seats variant only — a general description of who the open seats are for. */
	seatSummary: z.string().optional(),
	/** Total open seats — the general pool count (`seats`) or the sum across `roles` (`roles`). */
	openSeats: z.number(),
	/** Total seats on this stage (open + filled) — drives the seat-fill meter. */
	seatsTotal: z.number(),
	seatsFilled: z.number(),
	/** Open Roles variant only — the named roles, each with its own open-seat count + ticket price. */
	roles: z.array(StageRoleSchema),
	/** The stage-level ticket price — the seat-pool price (`seats`) or the spanning range (`roles`). */
	price: TicketPriceSchema,
	/** Required stage skills, rendered as tags. */
	skills: z.array(SkillRefSchema),
	/**
	 * Concrete deliverables produced by this stage — the "what you get" bullets in the expanded card.
	 * Populated by the service stage showcase (Pipeline / One-Off services); optional so a project
	 * pipeline that omits them simply doesn't render the block.
	 */
	deliverables: z.array(z.string()).optional(),
	/** Estimated turnaround for this stage (`~1 week`), shown as a stage fact. */
	turnaround: z.string().optional(),
	/** A human dependency note (`After Discovery`) — the preceding stage this one follows. */
	dependency: z.string().optional(),
	/**
	 * The stage's revision allowance (§Stages). Optional so a project pipeline that has never declared
	 * one simply renders no revision row, rather than claiming zero included rounds.
	 */
	revisions: StageRevisionsSchema.optional(),
});
export type ProjectStage = z.infer<typeof ProjectStageSchema>;

/** One key-metric chip in the project side nav (iconographic key → glyph). */
export const ProjectMetricSchema = z.object({
	icon: z.enum(["stages", "seats", "type", "ticket", "roles"]),
	label: z.string(),
	value: z.string(),
});
export type ProjectMetric = z.infer<typeof ProjectMetricSchema>;

/** The resolved finance summary shown in the project side nav + main details block. */
export const ProjectFinanceSchema = z.object({
	/** The per-ticket price across the project — fixed (One-Off) or a spanning range (Pipeline). */
	ticketPrice: TicketPriceSchema,
	/** Aggregate open vs total seats across every stage. */
	openSeats: z.number(),
	totalSeats: z.number(),
});
export type ProjectFinance = z.infer<typeof ProjectFinanceSchema>;

/** The projects-only extension bundle attached to {@link EntityViewSchema}. */
export const ProjectViewSchema = z.object({
	/** The uploader's profile banner (7:2), resolved from the profile projection for chrome parity. */
	banner: z.string(),
	/** The uploader's headline/role line, shown under the project title. */
	ownerHeadline: z.string(),
	ownerVerified: z.boolean(),
	/** Pipeline vs One-Off — the prominently displayed project classification. */
	classification: ProjectClassification,
	/** The human classification label (`Pipeline` / `One-Off`). */
	classificationLabel: z.string(),
	/** Current stage label — Pipeline only (One-Off projects have no stage progression). */
	stage: z.string().optional(),
	stages: z.array(ProjectStageSchema),
	finance: ProjectFinanceSchema,
	metrics: z.array(ProjectMetricSchema),
});
export type ProjectViewExtra = z.infer<typeof ProjectViewSchema>;
// #endregion

// #region Article view — rich body + TOC + assets + comments
/**
 * explore.view (articles) — the extra composed data the custom **Articles** view template renders. The
 * article body is a stream of structured {@link ArticleBlock}s (headings, prose, inline images,
 * embedded YouTube, audio players) — NOT raw HTML — so the Table of Contents is derived server-side
 * from the heading blocks into `toc` (stable slug anchors), SSR-painted, then made interactive
 * (smooth-scroll + scrollspy) client-side. `assets` collects every media asset for the bottom gallery
 * carousel; `comments` backs the discussion section. Present only when `item.type` is `articles`.
 */

/** The block kinds the rich article body renders. */
export const ArticleBlockKind = z.enum([
	"heading",
	"subheading",
	"paragraph",
	"quote",
	"list",
	"image",
	"youtube",
	"audio",
]);
export type ArticleBlockKind = z.infer<typeof ArticleBlockKind>;

/** One block in the article body stream. Optional fields are populated per `type`. */
export const ArticleBlockSchema = z.object({
	type: ArticleBlockKind,
	/** heading/subheading: the stable slug anchor (matches a `toc` entry id). */
	id: z.string().optional(),
	/** heading/subheading/paragraph/quote: the text content. */
	text: z.string().optional(),
	/** list: the bullet items. */
	items: z.array(z.string()).optional(),
	/** image/audio: media source. */
	src: z.string().optional(),
	/** image thumbnail / video poster. */
	thumb: z.string().optional(),
	alt: z.string().optional(),
	caption: z.string().optional(),
	/** youtube: the video id (privacy facade — no third-party JS until the user plays). */
	videoId: z.string().optional(),
	/** audio: clip length + waveform envelope + fallback clock. */
	durationMs: z.number().optional(),
	durationLabel: z.string().optional(),
	peaks: z.array(z.number()).optional(),
	/** audio/embed: display title. */
	title: z.string().optional(),
});
export type ArticleBlock = z.infer<typeof ArticleBlockSchema>;

/** One entry in the derived Table of Contents (level 2 = heading, 3 = subheading). */
export const ArticleTocEntrySchema = z.object({
	id: z.string(),
	text: z.string(),
	level: z.number(),
});
export type ArticleTocEntry = z.infer<typeof ArticleTocEntrySchema>;

/** One media asset in the bottom "media used in this article" gallery carousel. */
export const ArticleAssetSchema = z.object({
	kind: z.enum(["image", "video", "audio"]),
	src: z.string(),
	thumb: z.string(),
	label: z.string(),
	durationLabel: z.string().optional(),
});
export type ArticleAsset = z.infer<typeof ArticleAssetSchema>;

/** A reply under a top-level article comment (one level of nesting). */
export const ArticleReplySchema = z.object({
	id: z.string(),
	author: ExploreOwnerSchema,
	body: z.string(),
	dateLabel: z.string(),
	likes: z.number(),
});
export type ArticleReply = z.infer<typeof ArticleReplySchema>;

/** A top-level article comment. */
export const ArticleCommentSchema = z.object({
	id: z.string(),
	author: ExploreOwnerSchema,
	body: z.string(),
	createdAt: z.string(),
	dateLabel: z.string(),
	likes: z.number(),
	replies: z.array(ArticleReplySchema),
});
export type ArticleComment = z.infer<typeof ArticleCommentSchema>;

/** The articles-only extension bundle attached to {@link EntityViewSchema}. */
export const ArticleViewSchema = z.object({
	/** The article thumbnail/cover. */
	thumbnail: z.string(),
	publishedAt: z.string(),
	publishedLabel: z.string(),
	readMinutes: z.number(),
	topic: z.string(),
	blocks: z.array(ArticleBlockSchema),
	toc: z.array(ArticleTocEntrySchema),
	assets: z.array(ArticleAssetSchema),
	comments: z.array(ArticleCommentSchema),
});
export type ArticleViewExtra = z.infer<typeof ArticleViewSchema>;
// #endregion

// #region Service view — delivery model, stage showcase, team roles, booking
/**
 * explore.view (services) — the extra composed data the **Services** view template renders on top of the
 * base {@link EntityViewSchema}, resolved from the service's {@link ServiceType} delivery model. Present
 * only when `item.type` is `services`.
 *
 * - **Pipeline / One-Off** → the {@link ServiceViewSchema.stages} showcase (mirrors the Projects view's
 *   Stage Flow: sequence, per-stage deliverables, turnaround, and dependencies).
 * - **Direct Deliverable** → no stages; instead {@link ServiceViewSchema.roles} defines the optional
 *   project-team roles (the right-column "Project Team Roles" block).
 * - **Session / Group Session** → `bookable` is true, so the side-nav offers the availability-calendar
 *   toggle; `group` distinguishes a multi-attendee workshop from a 1:1 slot.
 */

/** The normalised delivery-model key the Services template dispatches on (slug of the {@link ServiceType}). */
export const ServiceModel = z.enum(["pipeline", "one-off", "direct", "session", "group-session"]);
export type ServiceModel = z.infer<typeof ServiceModel>;

/**
 * One defined role in a **Direct Deliverable** service's team breakdown (e.g. Lead Designer, Copywriter):
 * its title, the skills it covers, and how many of that role the engagement staffs.
 */
export const ServiceRoleSchema = z.object({
	name: z.string(),
	/** A one-line description of the role's remit. */
	summary: z.string(),
	/** The skills / specialisms required for this role, rendered as tags. */
	skills: z.array(SkillRefSchema),
	/** How many people fill this role on the engagement (1 unless a role is doubled up). */
	count: z.number(),
});
export type ServiceRole = z.infer<typeof ServiceRoleSchema>;

/** The services-only extension bundle attached to {@link EntityViewSchema}. */
export const ServiceViewSchema = z.object({
	/** The normalised delivery model the template dispatches on. */
	model: ServiceModel,
	/** The human delivery-model label (`Pipeline` / `Direct Deliverable` / `Group Session` …). */
	modelLabel: z.string(),
	/**
	 * The stage showcase — Pipeline / One-Off only (mirrors the Projects view's Stage Flow). Empty for
	 * Direct Deliverable / Session / Group Session. `showcaseStages` is the convenience gate.
	 */
	showcaseStages: z.boolean(),
	stages: z.array(ProjectStageSchema),
	/** Defined project-team roles — Direct Deliverable only (the right-column block). Empty otherwise. */
	roles: z.array(ServiceRoleSchema),
	/** Whether the service is booked from a schedule (Session / Group Session) — gates the calendar toggle. */
	bookable: z.boolean(),
	/** Whether this is a multi-attendee **Group Session** (vs a 1:1 Session). */
	group: z.boolean(),
	/** Group Session only — the attendee cap per session, shown in the booking summary. */
	seatsPerSession: z.number().optional(),
	/** Session / Group Session — a one-line summary of the booking format (duration · cadence). */
	bookingSummary: z.string().optional(),
	/**
	 * How many sessions a single purchase commits to. `1` (or absent) is an ordinary Session; `> 1` is
	 * a **set-session block** — a course or a multi-session package sold as one unit.
	 *
	 * Additive, and it is what lets the booking layer distinguish `service_session` from `set_session`
	 * (both of which `finance.purchasable_item_kind` has always carried) WITHOUT adding a sixth member
	 * to {@link ServiceModel}. That vocabulary is the five delivery models of Decision #45, documented
	 * across four spec files and driving exhaustive `Record<ServiceType, …>` maps in the pricing,
	 * query, catalogue and card layers; a block of six sessions is not a sixth way of delivering work,
	 * it is a quantity of the fifth.
	 *
	 * Absent on every non-session model, where a count would be meaningless rather than one.
	 */
	sessionCount: z.number().int().min(1).max(52).optional(),
	/**
	 * Each session's length in minutes, from the provider's own service settings.
	 *
	 * The buyer never chooses it — `PRODUCT_SPEC.md` §Why Sessions are Fixed — so it is a property of
	 * the listing rather than of the booking, and the slot picker derives its grid from it rather than
	 * offering a duration control that would imply otherwise.
	 */
	sessionMinutes: z.number().int().min(5).max(600).optional(),
});
export type ServiceViewExtra = z.infer<typeof ServiceViewSchema>;
// #endregion

// #region Product view — format, file manifest, specification ledger, licence
/**
 * explore.view (products) — the extra composed data the **Digital Product** template renders on top
 * of the base {@link EntityViewSchema}. Present only when `item.type` is `products`.
 *
 * A digital product is bought sight-unseen, so the specification ledger IS the offer: a buyer who
 * cannot see the formats, the payload size, the host-application compatibility and the licence terms
 * has not been told what they are purchasing. Every field here is therefore resolved SERVER-side and
 * rendered as given — a client that derives a file manifest re-derives it differently the moment a
 * fixture changes.
 */

/** The product format the template dispatches its live preview on. */
export const ProductFormat = z.enum([
	"template",
	"asset-3d",
	"audio",
	"video-preset",
	"code-kit",
	"graphic",
]);
export type ProductFormat = z.infer<typeof ProductFormat>;

/** One file in the delivered bundle. `bytes` is the UNCOMPRESSED payload — what the buyer unpacks. */
export const ProductFileSchema = z.object({
	/** Extension including the dot (`.blend`, `.wav`). */
	extension: z.string(),
	/** Human name for the format (`Blender scene`, `24-bit WAV stem`). */
	label: z.string(),
	/** Uncompressed size in bytes. */
	bytes: z.number(),
	/** Pre-formatted size (`412 MB`) — formatted once, server-side, so two surfaces cannot round differently. */
	sizeLabel: z.string(),
});
export type ProductFile = z.infer<typeof ProductFileSchema>;

/** One row in the key–value specification ledger (dimensions, sample rate, poly count, …). */
export const ProductSpecSchema = z.object({ label: z.string(), value: z.string() });
export type ProductSpec = z.infer<typeof ProductSpecSchema>;

/** One host application the bundle is verified against, and the versions it covers. */
export const ProductCompatSchema = z.object({ app: z.string(), versions: z.string() });
export type ProductCompat = z.infer<typeof ProductCompatSchema>;

/**
 * A single licence permission, stated as an explicit allowed/denied pair rather than a list of only
 * the things that are permitted. An omitted permission reads as an oversight; a denied one reads as a
 * term, and the buyer needs to see the terms.
 */
export const ProductPermissionSchema = z.object({ label: z.string(), allowed: z.boolean() });
export type ProductPermission = z.infer<typeof ProductPermissionSchema>;

/** The licence attached to the sale — never abbreviated to a label, because it is a term of the sale. */
export const ProductLicenceSchema = z.object({
	name: z.string(),
	summary: z.string(),
	permissions: z.array(ProductPermissionSchema),
});
export type ProductLicence = z.infer<typeof ProductLicenceSchema>;

/**
 * The live artefact the 16:10 canvas plays, rather than a screenshot of it. `kind` selects the
 * renderer; the remaining fields are populated per kind and the box itself never changes size, so
 * switching product format causes no reflow.
 */
export const ProductPreviewSchema = z.object({
	kind: z.enum(["image", "audio", "video", "code", "model"]),
	src: z.string(),
	poster: z.string().optional(),
	/** audio: clip length + waveform envelope for `AudioVisualizer`. */
	durationMs: z.number().optional(),
	durationLabel: z.string().optional(),
	peaks: z.array(z.number()).optional(),
	/** code: the excerpt and its language hint. */
	code: z.string().optional(),
	language: z.string().optional(),
});
export type ProductPreview = z.infer<typeof ProductPreviewSchema>;

/** The products-only extension bundle attached to {@link EntityViewSchema}. */
export const ProductViewSchema = z.object({
	format: ProductFormat,
	/** Human format label (`3D asset`, `Audio stems`) — rendered as inline meta, never a chip (§B.11). */
	formatLabel: z.string(),
	files: z.array(ProductFileSchema),
	/** Total uncompressed payload across `files`, summed server-side. */
	payloadBytes: z.number(),
	payloadLabel: z.string(),
	specs: z.array(ProductSpecSchema),
	compatibility: z.array(ProductCompatSchema),
	licence: ProductLicenceSchema,
	preview: ProductPreviewSchema.optional(),
});
export type ProductViewExtra = z.infer<typeof ProductViewSchema>;
// #endregion

// #region Composed page payload
/**
 * The full composed Entity View page — the payload {@link ExploreBackendService.viewPage} returns and
 * the `/view/[id]` route hands to the view feature. Everything the hero, the sidebar action panel, and
 * the lower recommendation/reviews sections need in one server-resolved shape.
 */
export const EntityViewSchema = z.object({
	item: ExploreItemSchema,
	gallery: z.array(EntityMediaSchema),
	pricing: EntityPricingSchema,
	trust: z.array(TrustFactSchema),
	/**
	 * The seller's median first-reply time, in MINUTES.
	 *
	 * The same datum the `response` trust fact prints as prose, carried as a number because the
	 * conversion lane's "Fast replies" badge is a THRESHOLD and cannot be a string match — deriving a
	 * gate from presentation text means a copy change silently retires the badge. One value, so the
	 * badge and the trust row can never claim different response times.
	 *
	 * Optional: a listing whose owner has no measured reply history gets no badge rather than an
	 * inferred one.
	 */
	responseMinutes: z.number().int().positive().optional(),
	/** Deliverables / key specifications rendered in the right details column. */
	deliverables: z.array(z.string()),
	/** Other items by the same creator (the "More by …" rail). */
	moreByOwner: z.array(ExploreItemSchema),
	/** Algorithmically-adjacent items in the same category (the "Similar" rail). */
	similar: z.array(ExploreItemSchema),
	reviews: z.object({
		summary: ReviewSummarySchema,
		list: z.array(EntityReviewSchema),
	}),
	/**
	 * Projects-only extension — the Stage Flow, finance summary, key-metric chips, and the uploader's
	 * banner for the profile-mirroring chrome. Present iff `item.type === "projects"`. The custom
	 * Projects template reads this; the generic hero/rails/reviews are suppressed for projects.
	 */
	project: ProjectViewSchema.optional(),
	/**
	 * Articles-only extension — the rich body blocks, derived Table of Contents, media-asset gallery,
	 * and comments. Present iff `item.type === "articles"`. The custom Articles template reads this.
	 */
	article: ArticleViewSchema.optional(),
	/**
	 * Services-only extension — the resolved delivery model plus its stage showcase (Pipeline / One-Off),
	 * defined team roles (Direct Deliverable), or booking flags (Session / Group Session). Present iff
	 * `item.type === "services"`. The custom Services template reads this.
	 */
	service: ServiceViewSchema.optional(),
	/**
	 * Products-only extension — the resolved format, file manifest, specification ledger, host
	 * compatibility matrix and full licence terms. Present iff `item.type === "products"`. The Digital
	 * Product template reads this; without it the template degrades to the media canvas and summary
	 * rather than fabricating a manifest.
	 */
	product: ProductViewSchema.optional(),
});
export type EntityView = z.infer<typeof EntityViewSchema>;
// #endregion
