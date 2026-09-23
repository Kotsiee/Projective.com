import { z } from "zod";
import { CropStateSchema } from "../files/crop.ts";
import { ImagePlaceholderSchema } from "../files/metadata.ts";
import {
	LanguageLevel,
	ProfileKind,
	ProfileOwnerType,
	ProfileSettingsSchema,
	ProfileVisibility,
	SHOWCASE_SLOTS,
} from "./profile.ts";

/**
 * profile.edit — the Zod SSOT for the OWNER's side of a profile: the edit model the
 * `/[handle]/edit` surface is seeded with, the patch it saves, the six-slot showcase grid, and the
 * media-apply request that turns a library asset into the profile photo or a showcase slot.
 *
 * The save patch is validated here for the person (a friendly, field-keyed refusal) and again in
 * the database (`org.save_profile` re-checks every hard limit), because a definer function is the
 * last thing between a crafted request and the row. The limits below and the SQL's must agree; a
 * contract test pins the ones a reader would trip over.
 */

// #region Shared field shapes

/** A four-digit year, as a profile states it ("2019"). Text, like the columns it maps to. */
const Year = z.string().regex(/^\d{4}$/, "Use a four-digit year.");

/** An https link, or nothing. A `javascript:` or plaintext URL on a public profile is a trap. */
const HttpsUrl = z.string().trim().max(500).regex(/^https:\/\/\S+$/i, "Links must start with https://");

/** A trimmed line of text with a length cap. */
function line(max: number, min = 0) {
	return z.string().trim().min(min).max(max);
}

// #endregion

// #region Ledger entries (Experience section)

export const ExperienceEditSchema = z.object({
	/** The existing row's id; absent for a new entry. Kept on save so links to a row survive. */
	id: z.string().uuid().optional(),
	orgName: line(120, 1),
	role: line(120, 1),
	startYear: Year,
	endYear: Year.nullable().optional(),
	isCurrent: z.boolean(),
	summary: z.string().max(600),
}).refine((e) => !e.isCurrent || !e.endYear, {
	message: "A current role has no end year.",
	path: ["endYear"],
}).refine((e) => !e.endYear || e.endYear >= e.startYear, {
	message: "The end year can't be before the start year.",
	path: ["endYear"],
});
export type ExperienceEdit = z.infer<typeof ExperienceEditSchema>;

export const EducationEditSchema = z.object({
	id: z.string().uuid().optional(),
	school: line(120, 1),
	credential: line(80, 1),
	field: line(120),
	startYear: Year,
	endYear: Year.nullable().optional(),
}).refine((e) => !e.endYear || e.endYear >= e.startYear, {
	message: "The end year can't be before the start year.",
	path: ["endYear"],
});
export type EducationEdit = z.infer<typeof EducationEditSchema>;

export const CertificationEditSchema = z.object({
	id: z.string().uuid().optional(),
	name: line(120, 1),
	issuer: line(120, 1),
	issuedYear: Year,
	expiresYear: Year.nullable().optional(),
	credentialUrl: HttpsUrl.nullable().optional(),
	/**
	 * READ-ONLY here: a platform claim the owner cannot make. Carried so the editor can show it;
	 * the save ignores it and the database keeps it only while name + issuer are unchanged.
	 */
	verified: z.boolean().optional(),
});
export type CertificationEdit = z.infer<typeof CertificationEditSchema>;

export const LanguageEditSchema = z.object({
	code: z.string().regex(/^[A-Za-z]{2,3}$/, "Choose a language."),
	level: LanguageLevel,
});
export type LanguageEdit = z.infer<typeof LanguageEditSchema>;

// #endregion

// #region The save patch

/** The caps a profile's lists are held to — mirrored by `org.save_profile`. */
export const PROFILE_LIMITS = {
	headline: 160,
	story: 4000,
	languages: 12,
	skills: 15,
	experience: 30,
	education: 20,
	certifications: 20,
} as const;

/**
 * What one save sends. Every key is optional — only the sections that changed travel — and a list
 * REPLACES the whole list. `.strict()` so a key this schema does not name (a `ratingAverage`, an
 * `isFreelancer`) is refused rather than silently dropped: a request that tries to set one is not
 * one the editor sent.
 */
export const ProfileSavePatchSchema = z.object({
	firstName: line(60, 1).optional(),
	lastName: line(60).optional(),
	/** A team / business / organisation name (an individual's name is first + last). */
	name: line(80, 1).optional(),
	headline: line(PROFILE_LIMITS.headline).optional(),
	story: z.string().max(PROFILE_LIMITS.story).optional(),
	city: line(80).optional(),
	country: line(80).optional(),
	timezone: z.string().max(60).optional(),
	visibility: ProfileVisibility.optional(),
	languages: z.array(LanguageEditSchema).max(PROFILE_LIMITS.languages).optional(),
	skills: z.array(line(40, 1)).max(PROFILE_LIMITS.skills).optional(),
	experience: z.array(ExperienceEditSchema).max(PROFILE_LIMITS.experience).optional(),
	education: z.array(EducationEditSchema).max(PROFILE_LIMITS.education).optional(),
	certifications: z.array(CertificationEditSchema).max(PROFILE_LIMITS.certifications).optional(),
	settings: ProfileSettingsSchema.partial().optional(),
}).strict();
export type ProfileSavePatch = z.infer<typeof ProfileSavePatchSchema>;

// #endregion

// #region The showcase grid

/** A slot position, 1–6. Slot 1 is the primary still. */
export const ShowcasePosition = z.number().int().min(1).max(SHOWCASE_SLOTS);

/** One filled slot as the editor draws it. */
export const ShowcaseSlotSchema = z.object({
	position: ShowcasePosition,
	/** The showcase RENDITION's asset id — what a save refers to. */
	fileId: z.string(),
	kind: z.enum(["image", "video"]),
	/** A tile-sized still: the image itself, or a video's poster. */
	thumb: z.string(),
	/** The playable/viewable source (the video itself, or the image at hero size). */
	src: z.string(),
	alt: z.string().max(200),
	placeholder: ImagePlaceholderSchema.optional(),
});
export type ShowcaseSlot = z.infer<typeof ShowcaseSlotSchema>;

/**
 * Save the whole grid. Positions must be unique, and a video can never occupy slot 1 — that slot is
 * the thumbnail every card of this profile leads with. (`kind` is re-derived server-side from the
 * stored file; the refinement here is the friendly early answer.)
 */
export const SaveShowcaseSchema = z.object({
	slots: z.array(z.object({
		position: ShowcasePosition,
		fileId: z.string().uuid(),
		alt: z.string().max(200).default(""),
	})).max(SHOWCASE_SLOTS),
}).refine((v) => new Set(v.slots.map((s) => s.position)).size === v.slots.length, {
	message: "Each slot can hold one item.",
	path: ["slots"],
});
export type SaveShowcase = z.infer<typeof SaveShowcaseSchema>;

// #endregion

// #region Applying media (library asset → avatar / showcase slot)

/**
 * Turn a library asset into the profile photo or one showcase slot. The server re-reads the asset
 * under the caller's session (it must be theirs to read), decodes it, clamps `crop` against the
 * pixels it actually decoded, and writes a public rendition — a still is cropped to the surface's
 * aspect (1:1 avatar, 16:10 showcase); a video (showcase slots 2–6 only) is published as uploaded
 * with its poster still. `crop` is ignored for a video.
 */
export const ApplyMediaSchema = z.object({
	target: z.enum(["avatar", "showcase"]),
	/** Required for `showcase`. */
	position: ShowcasePosition.optional(),
	/** The LIBRARY asset to cut the rendition from. */
	sourceAssetId: z.string().uuid(),
	crop: CropStateSchema.optional(),
	alt: z.string().max(200).optional(),
}).refine((v) => v.target === "avatar" || v.position !== undefined, {
	message: "Choose a showcase slot.",
	path: ["position"],
});
export type ApplyMedia = z.infer<typeof ApplyMediaSchema>;

// #endregion

// #region The edit model

/**
 * Everything `/[handle]/edit` is seeded with — the owner's current values in the shape the editor
 * edits, not the display projection. Built server-side from the same RPCs the public read uses
 * (the owner sees their own private data through them).
 */
export const ProfileEditModelSchema = z.object({
	handle: z.string(),
	kind: ProfileKind,
	ownerType: ProfileOwnerType,
	/** Individual only. */
	firstName: z.string(),
	lastName: z.string(),
	/** Team / business / organisation only. */
	name: z.string(),
	headline: z.string(),
	story: z.string(),
	city: z.string(),
	country: z.string(),
	timezone: z.string(),
	visibility: ProfileVisibility,
	languages: z.array(LanguageEditSchema),
	skills: z.array(z.string()),
	experience: z.array(ExperienceEditSchema),
	education: z.array(EducationEditSchema),
	certifications: z.array(CertificationEditSchema),
	settings: ProfileSettingsSchema,
	avatar: z.object({ url: z.string(), placeholder: ImagePlaceholderSchema.optional() }).nullable(),
	showcase: z.array(ShowcaseSlotSchema),
	/** Which sections this kind can edit (a team has no Experience ledger, a business no skills). */
	sections: z.object({
		identity: z.boolean(),
		about: z.boolean(),
		languages: z.boolean(),
		skills: z.boolean(),
		experience: z.boolean(),
		location: z.boolean(),
		visibility: z.boolean(),
	}),
});
export type ProfileEditModel = z.infer<typeof ProfileEditModelSchema>;

// #endregion
