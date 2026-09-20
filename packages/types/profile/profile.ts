import { z } from "zod";
import { DualRatingSchema, SkillRefSchema } from "../explore/items.ts";
import { ImagePlaceholderSchema } from "../files/metadata.ts";
import { AvailabilityRuleSchema } from "../scheduling/scheduling.ts";
import { INTAKE_FIELDS_MAX, IntakeFieldSchema } from "../services/intake.ts";

/**
 * profile.profile — the Zod SSOT for a public profile's header + overview projection
 * (`/[handle]`, the `@handle` wildcard namespace).
 *
 * This is the chrome the profile page paints: the split hero (avatar + name + `@handle`, the
 * Hire ⁄ Message ⁄ Follow rig, the inline metrics strip, and the showcase media frame), the context
 * bar (headline + story beside the availability ⁄ at-a-glance facts and the skills / languages
 * cluster), the client-proof strip, and the counts that drive the four-section tab bar. It currently
 * backs deterministic fixtures; when the `org.users_public` / profile tables land, the same schema
 * validates the read (root CLAUDE.md §1, the Zod SSOT rule — a read projection over the eventual
 * tables, like projects `detail`).
 *
 * Two fields are carried but NOT painted: `online` (presence — the availability badge derives from
 * the published `hours` and the clock, never from a presence pip that can be wrong without anyone
 * noticing) and `availabilityLabel` (superseded on the profile by the derived badge; still the
 * subtitle of `/[handle]/availability`). They stay because the shape is additive-only and the live
 * path reads them regardless.
 *
 * It reuses the discovery SSOT's {@link SkillRefSchema} and {@link DualRatingSchema} so a profile's
 * skill pills and reputation render through the SAME explore atoms the cards use — no shape drift.
 * Only enum/array/object/number/string/boolean primitives are used, so the schema stays stable across
 * Zod majors (matching `@projective/types/org` + `@projective/types/explore`).
 */

// #region Taxonomy
/**
 * The profile entity types that drive the tab matrix + capability chrome (root CLAUDE.md
 * Decisions #9/#10 — organisations/businesses are client/buyer-only). Maps 1:1 from the discovery
 * `ProfileEntity` (`users`→`client`, `freelancers`→`freelancer`, `teams`→`team`,
 * `businesses`→`business`); **`organisation`** is the department-structured buyer entity (root
 * CLAUDE.md Decision #16 — the `organisation` context) surfaced as a profile: it adds the Departments
 * tab and a department-grouped Members view. Like a client/business it never sells (buyer-only).
 */
export const ProfileKind = z.enum([
	"client",
	"freelancer",
	"team",
	"business",
	"organisation",
]);
export type ProfileKind = z.infer<typeof ProfileKind>;

/**
 * Trust ladder marks surfaced as verification badges (PRODUCT_SPEC §Trust & Verification): L1 Basic ·
 * L2 Verified · L3 Business/KYB · the Architect Tier mark. A profile carries the tiers it has
 * ATTAINED; the badges render in ladder order.
 */
export const VerificationTier = z.enum(["L1", "L2", "L3", "architect"]);
export type VerificationTier = z.infer<typeof VerificationTier>;

/** Proficiency ramp for a spoken/working language, shown as a labelled level on the overview. */
export const LanguageLevel = z.enum([
	"native",
	"fluent",
	"professional",
	"conversational",
	"basic",
]);
export type LanguageLevel = z.infer<typeof LanguageLevel>;
// #endregion

// #region Sub-shapes
/** A spoken/working language + its proficiency (e.g. `{ code: "FR", label: "French", level: "fluent" }`). */
export const ProfileLanguageSchema = z.object({
	/** Short language code (e.g. `EN`, `FR`) — the compact chip label. */
	code: z.string(),
	/** Full language name for the tooltip / expanded readout. */
	label: z.string(),
	/** Proficiency ramp. */
	level: LanguageLevel,
});
export type ProfileLanguage = z.infer<typeof ProfileLanguageSchema>;

/** A verified notable client / organisation the profile has worked with (a trust signal, logo-led). */
export const NotableClientSchema = z.object({
	name: z.string(),
	/** Logo/avatar URL. */
	logo: z.string().optional(),
	/** When present, the client is itself a Projective entity — links to its `/@handle`. */
	handle: z.string().optional(),
	/** Whether the working relationship is platform-verified (a checkmark). */
	verified: z.boolean().optional(),
});
export type NotableClient = z.infer<typeof NotableClientSchema>;

/** Where the profile is based + its IANA timezone (drives the live local-time readout). */
export const ProfileLocationSchema = z.object({
	city: z.string(),
	country: z.string(),
	/** IANA timezone id (e.g. `Europe/London`) — the client renders a live local clock from it. */
	timezone: z.string(),
});
export type ProfileLocation = z.infer<typeof ProfileLocationSchema>;

/**
 * One slide of the hero's showcase — a still, or a full-length (not looping) video with the still it
 * shows before playback.
 */
export const ProfileShowcaseItemSchema = z.object({
	kind: z.enum(["video", "image"]),
	src: z.string(),
	/** The still a video draws before playback (and the only frame a reduced-motion viewer sees). */
	poster: z.string().optional(),
	alt: z.string(),
	/** What is known about the still before it loads — see `files/metadata.ts` `ImagePlaceholder`. */
	placeholder: ImagePlaceholderSchema.optional(),
});
export type ProfileShowcaseItem = z.infer<typeof ProfileShowcaseItemSchema>;

/** The most extra slides a showcase may carry beyond its primary image. */
export const SHOWCASE_EXTRA_MAX = 4;

/**
 * The hero's showcase — the carousel that fills the hero's second column: ONE primary image (the
 * thumbnail every card and preview of this profile leads with, so it is never a video) plus up to
 * {@link SHOWCASE_EXTRA_MAX} extra slides, each a still or a full-length video. The set is ordered:
 * the primary is always slide one.
 *
 * `null` is a real state, not an absence to paper over: the hero then collapses to a single
 * typography-first column rather than drawing an empty frame (root CLAUDE.md §8 Decision #96).
 */
export const ProfileShowcaseSchema = z.object({
	/** The lead slide — an image, never a video. */
	primary: ProfileShowcaseItemSchema.extend({ kind: z.literal("image") }),
	/** The slides after it, in order. Images or videos; at most {@link SHOWCASE_EXTRA_MAX}. */
	extras: z.array(ProfileShowcaseItemSchema).max(SHOWCASE_EXTRA_MAX),
});
export type ProfileShowcase = z.infer<typeof ProfileShowcaseSchema>;

/** Every slide of a showcase, in display order — the primary first. */
export function showcaseSlides(showcase: ProfileShowcase): ProfileShowcaseItem[] {
	return [showcase.primary, ...showcase.extras];
}

/**
 * The hero's inline metrics strip — the three facts a visitor weighs before reading anything else.
 *
 * `standing` is the EARNED rung of the Reliability Index (`@projective/types/org/standing`,
 * finance-model.md §16) — it is never purchasable, so the strip carries it as a plain label with no
 * upgrade affordance. `volumeLabel` is SERVER-formatted money ("£48k delivered") because a client
 * must never total or convert a figure; `null` means the entity has no disclosed volume, which
 * renders as absence rather than "£0".
 */
export const ProfileStandingSchema = z.object({
	level: z.number().int().min(1).max(5),
	/** "New" · "Established" · "Trusted" · "Expert" · "Elite". */
	label: z.string().max(40),
});
export type ProfileStanding = z.infer<typeof ProfileStandingSchema>;

export const ProfileStatsSchema = z.object({
	/** Stages signed off across every engagement (the volume gate of the Standing ladder). */
	completedStages: z.number().int().min(0),
	/** Lifetime delivered volume as a server-formatted display string; `null` when undisclosed. */
	volumeLabel: z.string().nullable(),
	/** The earned rung; `null` for a buyer-only entity, which has no seller standing. */
	standing: ProfileStandingSchema.nullable(),
});
export type ProfileStats = z.infer<typeof ProfileStatsSchema>;

/**
 * The weekly working hours a seller publishes, in the seller's OWN timezone — the same
 * `working_hours` bands the `/[handle]/availability` calendar paints (`scheduling.availability`),
 * carried here so the context bar's schedule summary, its "Available now ⁄ Away" badge and the
 * bookable calendar can never disagree about when this person is at their desk.
 *
 * Only the broad `working_hours` kind is carried; the narrower `call_window` bands are a booking
 * concern and stay on the schedule page. `null` on the projection means no hours are configured —
 * a buyer-only entity, or a seller who has not set any — and the bar then renders no availability
 * block at all rather than a badge with nothing behind it.
 */
export const ProfileHoursSchema = z.object({
	/** IANA timezone id the rules are expressed in (e.g. `Europe/London`). */
	timezone: z.string().max(60),
	rules: z.array(AvailabilityRuleSchema),
});
export type ProfileHours = z.infer<typeof ProfileHoursSchema>;

/**
 * Per-tab item counts — feed the tab-bar count chips + the "empty tab" gate. All optional so a kind
 * that never has a given tab simply omits it.
 */
export const ProfileMetricsSchema = z.object({
	services: z.number().optional(),
	products: z.number().optional(),
	projects: z.number().optional(),
	portfolio: z.number().optional(),
	education: z.number().optional(),
	experience: z.number().optional(),
	teams: z.number().optional(),
	businesses: z.number().optional(),
	articles: z.number().optional(),
	reviews: z.number().optional(),
	members: z.number().optional(),
	/** Organisation only — number of departments (drives the Departments tab count chip). */
	departments: z.number().optional(),
});
export type ProfileMetrics = z.infer<typeof ProfileMetricsSchema>;
// #endregion

// #region ProfileView
/**
 * The full public-profile header + overview projection the `/[handle]` shell renders. `handle` carries
 * the leading `@` (the canonical entity identifier, root CLAUDE.md Decision #3). `userId` lets the
 * shell compare against the hydrated `UserContext.userId` to unlock the owner-only chrome (Edit
 * Profile, inline editing, always-visible Settings).
 */
export const ProfileViewSchema = z.object({
	/** The canonical `@handle`. */
	handle: z.string(),
	/** Display name. */
	name: z.string(),
	/** Entity type — drives the tab matrix + capabilities. */
	kind: ProfileKind,
	/** Circular avatar (1:1) URL — the 72px disc that leads the hero. */
	avatar: z.string(),
	/** What is known about `avatar` before it loads — see `files/metadata.ts` `ImagePlaceholder`. */
	avatarPlaceholder: ImagePlaceholderSchema.optional(),
	/**
	 * Wide cover (7:2) URL. The profile hero no longer paints a banner (Decision #96 — the showcase
	 * frame took its column); the field survives because the Projects view (`/view/[id]?type=projects`)
	 * still borrows a profile's cover for header parity (Decision #43).
	 */
	banner: z.string(),
	/** The hero showcase carousel (a primary image + up to four slides); `null` collapses the hero to one column. */
	showcase: ProfileShowcaseSchema.nullable(),
	/** The hero's inline metrics strip. */
	stats: ProfileStatsSchema,
	/**
	 * The entity's own one-line headline (craft / value proposition) — inline-editable by the owner,
	 * beside the story. Empty means none has been written yet: the owner sees the prompt to write one
	 * in its slot and a visitor sees nothing; it is never filled with a platform default, because a
	 * sentence the platform wrote reads as one the person wrote.
	 */
	headline: z.string(),
	/** The long-form story/description — inline-editable by the owner (auto-resizing textarea). */
	story: z.string(),
	/** Skill tag pills, resolved to their visual categories (reuses the discovery skill atom). */
	skills: z.array(SkillRefSchema),
	/** Languages + proficiency levels. */
	languages: z.array(ProfileLanguageSchema),
	/** Verified notable clients / organisations worked with. */
	notableClients: z.array(NotableClientSchema),
	/** Base location + timezone. */
	location: ProfileLocationSchema,
	/** Live online status. */
	online: z.boolean(),
	/** Short availability label (e.g. "Available for work", "Booked till Aug"). */
	availabilityLabel: z.string(),
	/**
	 * Whether this profile has a configured availability calendar (the bookable
	 * `/[handle]/availability` surface). Implied by a non-null `hours`; kept as its own flag because
	 * a calendar can exist with no published weekly bands.
	 */
	hasAvailability: z.boolean(),
	/**
	 * The published weekly working hours (+ their timezone), or `null` when none are configured. The
	 * context bar derives the schedule summary, the live "Available now ⁄ Away" badge and the local
	 * clock from this — never from `online`.
	 */
	hours: ProfileHoursSchema.nullable(),
	/** Average response-time label (e.g. "Usually responds within 2 hours"). */
	responseTime: z.string(),
	/**
	 * Typical first-response time in MINUTES — the measured datum behind `responseTime`. Drives the
	 * "Avg. response" line AND the "Fast responder" mark, which is gated on the same
	 * `FAST_REPLY_MINUTES` threshold the discovery card's "Fast replies" chip uses, so a profile and
	 * the card that linked to it cannot disagree about reply speed. `null` when unmeasured — the line
	 * and the mark are then both absent rather than inferred from anything else.
	 */
	responseMinutes: z.number().int().min(0).nullable(),
	/**
	 * Whether the entity offers a FREE (courtesy) discovery call — the public `courtesyEnabled`
	 * half of `scheduling.call_settings` (`PRODUCT_SPEC.md` §Discovery & Courtesy Calls). Surfaces
	 * as the "Free consultation" mark; a paid-only consultation is not one.
	 */
	freeConsultation: z.boolean(),
	/**
	 * The seller's own intake for being brought INTO a project — the questions a client answers in
	 * the "Add to project" assignment modal before the invitation is sent (`@projective/types/services`
	 * `IntakeField`). Seller-authored data, rendered by the modal and held server-side by the same
	 * rule; empty means the seller asks for nothing beyond the project itself and a message. Optional
	 * (not defaulted) so every projection built before it existed keeps compiling — an absent list
	 * reads as an empty one.
	 */
	hireIntake: z.array(IntakeFieldSchema).max(INTAKE_FIELDS_MAX).optional(),
	/** DUAL-track reputation: `asHelper` (freelancer) AND `asClient` — both may be present. */
	rating: DualRatingSchema,
	/** Whether the identity itself is platform-verified. */
	verified: z.boolean(),
	/** Highest attained trust tier (the headline mark). */
	tier: VerificationTier,
	/** Every attained tier, rendered as badges in ladder order. */
	verifications: z.array(VerificationTier),
	/** Follower / following counts. */
	followers: z.number(),
	following: z.number(),
	/** ISO join date. */
	memberSince: z.string(),
	/** The authenticated user id that owns this profile (owner-chrome gate). */
	userId: z.string(),
	/** Per-tab counts. */
	metrics: ProfileMetricsSchema,
});
export type ProfileView = z.infer<typeof ProfileViewSchema>;
// #endregion
