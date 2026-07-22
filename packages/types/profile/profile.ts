import { z } from "zod";
import { DualRatingSchema, SkillRefSchema } from "../explore/items.ts";

/**
 * profile.profile — the Zod SSOT for a public profile's header + overview projection
 * (`/[handle]`, the `@handle` wildcard namespace).
 *
 * This is the chrome the profile page paints: the banner + avatar identity, the story/skills/
 * languages/notable-clients overview, the sticky meta rail (local time, online status, location,
 * DUAL-track reputation as a helper AND as a client, response time, verification tiers), and the
 * counts that drive the entity-conditional tab bar. It currently backs deterministic fixtures; when
 * the `org.users_public` / profile tables land, the same schema validates the read (root CLAUDE.md
 * §1, the Zod SSOT rule — a read projection over the eventual tables, like projects `detail`).
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
	/** Circular avatar (1:1) URL — overlaps the banner's bottom edge (§C.4). */
	avatar: z.string(),
	/** Wide cover banner (7:2) URL. */
	banner: z.string(),
	/** One-line LinkedIn-style headline (craft / value proposition). */
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
	 * Whether this profile has a configured availability calendar. Gates the sidebar's Profile ⁄
	 * Availability toggle (root CLAUDE.md — Part 4.3: the switch shows ONLY when availability is set up)
	 * and the meta rail's availability sub-line.
	 */
	hasAvailability: z.boolean(),
	/** Average response-time label (e.g. "Usually responds within 2 hours"). */
	responseTime: z.string(),
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
