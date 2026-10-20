import { z } from "zod";
import { ExploreCategory, ExploreEntity, ExploreOwnerSchema } from "./items.ts";
import { SUGGEST_QUERY_MAX } from "./limits.ts";

export { SUGGEST_QUERY_MAX };

/**
 * explore.suggest — the Zod SSOT for search-as-you-type: the `/api/explore/suggest` query and the
 * {@link Suggestions} payload the fat `ExploreBackendService.suggest` answers with. A read projection
 * over the live catalogue — no table of its own.
 */

// #region Query
/** `GET /api/explore/suggest?q=&scope=` — the typed prefix and the scope the bar is searching in. */
export const SuggestQuerySchema = z.object({
	q: z.string().trim().max(SUGGEST_QUERY_MAX, "Keep the search under 80 characters."),
	scope: ExploreCategory.default("all"),
});
export type SuggestQuery = z.infer<typeof SuggestQuerySchema>;
// #endregion

// #region Payload
/** One listing that matched the typed prefix — enough to render a row and build its link. */
export const SuggestHitSchema = z.object({
	id: z.string(),
	type: ExploreEntity,
	title: z.string(),
	/** The owner's display name — the row's meta line. */
	ownerName: z.string(),
	/** The owner's `@handle`; profile entities link here rather than to `/view`. */
	ownerHandle: z.string(),
	media: z.string().optional(),
});
export type SuggestHit = z.infer<typeof SuggestHitSchema>;

/** A skill or listing category that matched, with how many listings in scope carry it. */
export const SuggestTermSchema = z.object({
	label: z.string(),
	kind: z.enum(["skill", "category"]),
	count: z.number().int().nonnegative(),
});
export type SuggestTerm = z.infer<typeof SuggestTermSchema>;

/** A person, team or business whose name or `@handle` matched. */
export const SuggestHandleSchema = ExploreOwnerSchema.pick({
	handle: true,
	name: true,
	avatar: true,
	kind: true,
	verified: true,
});
export type SuggestHandle = z.infer<typeof SuggestHandleSchema>;

/**
 * The typeahead answer. An empty `q` returns only `trending`; a non-empty one returns the matches and
 * an empty `trending`, so one round trip never pays for a section the bar will not show.
 */
export const SuggestionsSchema = z.object({
	q: z.string(),
	scope: ExploreCategory,
	/** Top hits, at most a few per entity type, in the Search-Results section order. */
	hits: z.array(SuggestHitSchema),
	terms: z.array(SuggestTermSchema),
	handles: z.array(SuggestHandleSchema),
	/**
	 * The skills and categories of the most-active items in scope (last week's opens and saves),
	 * topped up by what is most listed over 30 days.
	 */
	trending: z.array(z.string()),
});
export type Suggestions = z.infer<typeof SuggestionsSchema>;
// #endregion
