/**
 * profile-types — the app-local re-export of the profile + discovery Zod SSOT shapes.
 *
 * Feature components/islands import from this one local path (mirrors `explore-types.ts` /
 * `projects-types.ts`) so a future shape move only touches this file. Nothing here adds shape — the
 * SSOT stays in `@projective/types/profile` (+ the reused `@projective/types/explore` item shapes the
 * profile tabs render through).
 */
export * from "@projective/types/profile";
export type {
	ArticleItem,
	DualRating,
	ExploreItem,
	ExploreOwner,
	ProductItem,
	ProfileItem,
	ProjectItem,
	RatingTrack,
	ServiceItem,
	SkillRef,
} from "@projective/types/explore";
