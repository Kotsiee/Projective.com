import { z } from "zod";

/**
 * explore.signals — the Zod SSOT for the DISCOVERY SIGNAL rows the ranking and the personalised Home
 * feed read (PRODUCT_SPEC §Reputation & Discovery): a person's viewing history (`org.recent_views`),
 * their saves (`org.user_bookmarks`), their topic affinity (`search.user_affinity`), the scoring
 * coefficients (`search.ranking_weights()`) and the k-anonymous Trending aggregate
 * (`search.trending_entities()`). Migrations 00000011 · 00001400 · 00002010 · 00004001; documented in
 * `documentation/database/{org,search}/*`.
 *
 * These are ROW shapes, keyed by the database's entity vocabulary and uuids. Discovery addresses items
 * by slug or handle instead; the catalogue maps between the two, so neither vocabulary leaks into the
 * other's surface.
 */

// #region Entity vocabularies
/** `org.bookmark_entity_type` — what a person can save. */
export const BookmarkEntityKind = z.enum([
	"project",
	"service_blueprint",
	"freelancer",
	"business",
	"team",
]);
export type BookmarkEntityKind = z.infer<typeof BookmarkEntityKind>;

/**
 * `org.recent_views.entity_type` (`recent_views_entity_type_check`) — what a person can open: the
 * bookmark vocabulary plus a product, an article and a buyer's profile, which can be opened but not
 * saved.
 */
export const DiscoveryEntityKind = z.enum([
	...BookmarkEntityKind.options,
	"product",
	"article",
	"user",
]);
export type DiscoveryEntityKind = z.infer<typeof DiscoveryEntityKind>;
// #endregion

// #region Rows
/** One `org.recent_views` row — read-own; written only by `search.record_view`. */
export const RecentViewRowSchema = z.object({
	id: z.string().uuid(),
	user_id: z.string().uuid(),
	entity_type: DiscoveryEntityKind,
	entity_id: z.string().uuid(),
	/** How many times the person opened it (≥ 1). */
	view_count: z.number().int().min(1),
	first_viewed_at: z.string(),
	/** The latest opening — what "Because you viewed" and the Trending window read. */
	viewed_at: z.string(),
});
export type RecentViewRow = z.infer<typeof RecentViewRowSchema>;

/** One `org.user_bookmarks` row — a person's own save. */
export const UserBookmarkRowSchema = z.object({
	id: z.string().uuid(),
	user_id: z.string().uuid(),
	entity_type: BookmarkEntityKind,
	entity_id: z.string().uuid(),
	created_at: z.string().nullable(),
});
export type UserBookmarkRow = z.infer<typeof UserBookmarkRowSchema>;

/**
 * One `search.user_affinity` row: a person's leaning toward a TOPIC (a lowercased skill label or
 * category of something they opened). The score decays with a 14-day half-life — stored as of
 * `updated_at`, so a reader applies the decay to now.
 */
export const UserAffinityRowSchema = z.object({
	id: z.string().uuid(),
	user_id: z.string().uuid(),
	category_slug: z.string(),
	/** `numeric(10,2)` — PostgREST may serialise it as text. */
	affinity_score: z.union([z.number(), z.string()]),
	updated_at: z.string().nullable(),
});
export type UserAffinityRow = z.infer<typeof UserAffinityRowSchema>;

/** One row of `search.ranking_weights()` — a coefficient of the scoring matrix. */
export const RankingWeightRowSchema = z.object({
	key: z.string(),
	weight: z.union([z.number(), z.string()]),
	is_active: z.boolean(),
});
export type RankingWeightRow = z.infer<typeof RankingWeightRowSchema>;

/** One row of `search.trending_entities()` — an entity three or more people opened or saved lately. */
export const TrendingEntityRowSchema = z.object({
	entity_type: DiscoveryEntityKind,
	entity_id: z.string().uuid(),
	/** Distinct people behind it — never fewer than three. */
	people: z.number().int().min(3),
	/** Views count one, saves two. */
	score: z.union([z.number(), z.string()]),
});
export type TrendingEntityRow = z.infer<typeof TrendingEntityRowSchema>;
// #endregion

// #region Requests
/** `POST /api/explore/views` — the discovery item (slug or handle) the signed-in viewer opened. */
export const RecordViewRequestSchema = z.object({
	id: z.string().trim().min(1).max(200),
});
export type RecordViewRequest = z.infer<typeof RecordViewRequestSchema>;
// #endregion

// #region Development simulation
/**
 * The viewer half of the cold-start simulation (Dev Context Switcher, root CLAUDE.md §5): `no_history`
 * drops the viewer's views, saves and affinity so the interest fallback shows; `no_signals` drops
 * their stated interests and skills too, leaving only the shared rails.
 */
export const DiscoveryViewerSim = z.enum(["auto", "no_history", "no_signals"]);
export type DiscoveryViewerSim = z.infer<typeof DiscoveryViewerSim>;

/** The platform half: `quiet` drops Trending's activity so its "New on Projective" fallback shows. */
export const DiscoveryActivitySim = z.enum(["auto", "quiet"]);
export type DiscoveryActivitySim = z.infer<typeof DiscoveryActivitySim>;

/** One cold-start simulation. Honoured by the server in development only. */
export interface DiscoverySim {
	viewer: DiscoveryViewerSim;
	activity: DiscoveryActivitySim;
}

/** No simulation — the real history and the real activity. */
export const NO_DISCOVERY_SIM: DiscoverySim = Object.freeze({ viewer: "auto", activity: "auto" });
// #endregion
