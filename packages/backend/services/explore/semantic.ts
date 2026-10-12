import type {
	DiscoveryEntityKind,
	ExploreEntity,
	ExploreItem,
	ExploreParams,
	NearestEntityRow,
} from "@projective/types/explore";
import { categoryEntities, getResults, isExplicitSort } from "./query.ts";

/**
 * semantic — how voyage-4 similarity changes a discovery search (Decision #179). Pure.
 *
 * It never replaces the query: the text match, every facet, the category scope and an explicit sort
 * all hold. On the default "recommended" order the candidates are re-ranked by blending each one's
 * position in that order with its similarity to the query, through {@link SEMANTIC_BLEND_WEIGHT}; and
 * up to {@link SEMANTIC_EXTRA_LIMIT} close neighbours the text match missed — a typo, a synonym — are
 * added if they pass the same facets. Without similarity data nothing moves.
 */

// #region Constants
/**
 * How much the query similarity weighs against the existing order: 0 keeps today's order exactly, 1
 * orders by similarity alone.
 */
export const SEMANTIC_BLEND_WEIGHT = 0.5;

/** The most neighbours one search may add that the text match did not find. */
export const SEMANTIC_EXTRA_LIMIT = 12;

/**
 * The similarity a neighbour must reach to be added: at least this, and at least
 * {@link SEMANTIC_EXTRA_RELATIVE} of the best match. voyage-4 query-to-listing cosines run ≈ 0.34–0.42
 * for a real match and ≈ 0.19–0.30 for an unrelated listing (measured on the seed catalogue,
 * 2026-10-12), so the floor keeps a nonsense query from adding anything.
 */
export const SEMANTIC_EXTRA_MIN_SIMILARITY = 0.3;

/** A neighbour must also come within this share of the best match's similarity. */
export const SEMANTIC_EXTRA_RELATIVE = 0.8;

/** How many neighbours one search asks `search.fn_nearest` for — its own clamp. */
export const SEMANTIC_POOL = 100;
// #endregion

// #region Vocabulary
const ENTITY_KIND: Record<ExploreEntity, DiscoveryEntityKind> = {
	services: "service_blueprint",
	products: "product",
	articles: "article",
	projects: "project",
	freelancers: "freelancer",
	teams: "team",
	users: "user",
	businesses: "business",
};

/** The `fn_nearest` entity kinds a category searches, or `null` for every kind. */
export function nearestKindsFor(category: ExploreParams["category"]): DiscoveryEntityKind[] | null {
	return categoryEntities(category)?.map((entity) => ENTITY_KIND[entity]) ?? null;
}

/** The entity kind an item is stored under. */
export function entityKindOf(item: ExploreItem): DiscoveryEntityKind {
	return ENTITY_KIND[item.type];
}
// #endregion

// #region Ranking
/** Item id → cosine similarity to the query, best first (the map's order). */
export type SemanticSimilarity = ReadonlyMap<string, number>;

/**
 * Resolve `fn_nearest` rows to catalogue items. A row that resolves to nothing the catalogue holds is
 * dropped; `resolve` maps an entity to its item id.
 */
export function similarityFrom(
	rows: readonly NearestEntityRow[],
	resolve: (kind: DiscoveryEntityKind, id: string) => string | undefined,
): SemanticSimilarity {
	const out = new Map<string, number>();
	for (const row of rows) {
		const itemId = resolve(row.entity_type, row.entity_id);
		const score = Number(row.score);
		if (itemId && Number.isFinite(score) && !out.has(itemId)) out.set(itemId, score);
	}
	return out;
}

/**
 * Re-rank `candidates` (in their existing order) with `extras` appended: each item scores
 * `(1 − weight) × position + weight × similarity`, where position is 1 for the first of n candidates
 * and falls by 1/n a place (an extra has none) and similarity is normalised to the best in the list.
 * An item with no similarity keeps its position as its similarity, so it neither rises nor falls for
 * lack of a vector. Ties keep the existing order.
 */
export function blendSemantic(
	candidates: readonly ExploreItem[],
	extras: readonly ExploreItem[],
	similarity: SemanticSimilarity,
	weight = SEMANTIC_BLEND_WEIGHT,
): ExploreItem[] {
	const pool = [...candidates, ...extras];
	const best = Math.max(0, ...pool.map((it) => similarity.get(it.id) ?? 0));
	return pool
		.map((item, order) => {
			const position = order < candidates.length ? 1 - order / candidates.length : 0;
			const sim = similarity.get(item.id);
			const semantic = sim === undefined || best <= 0 ? position : Math.max(0, sim) / best;
			return { item, order, total: (1 - weight) * position + weight * semantic };
		})
		.sort((a, b) => b.total - a.total || a.order - b.order)
		.map((scored) => scored.item);
}

/**
 * The semantic result list for `params`: today's candidates ({@link getResults}) plus the neighbours
 * they missed that clear the similarity floors and pass the same category and facets, ordered by the
 * blend on the default sort, or by the reader's explicit sort.
 */
export function semanticResults(
	corpus: readonly ExploreItem[],
	params: ExploreParams,
	scores: ReadonlyMap<string, number> | undefined,
	similarity: SemanticSimilarity,
	weight = SEMANTIC_BLEND_WEIGHT,
): ExploreItem[] {
	const candidates = getResults(corpus, params, scores);
	const included = new Set(candidates.map((it) => it.id));
	const best = Math.max(0, ...similarity.values());
	const floor = Math.max(SEMANTIC_EXTRA_MIN_SIMILARITY, best * SEMANTIC_EXTRA_RELATIVE);
	const byId = new Map(corpus.map((it) => [it.id, it]));
	const neighbours: ExploreItem[] = [];
	for (const [id, sim] of similarity) {
		const item = byId.get(id);
		if (item && !included.has(id) && sim >= floor) neighbours.push(item);
	}
	const unfiltered = { ...params, q: "" };
	const passing = new Set(getResults(neighbours, unfiltered, scores).map((it) => it.id));
	const extras = neighbours.filter((it) => passing.has(it.id)).slice(0, SEMANTIC_EXTRA_LIMIT);
	if (isExplicitSort(params.sort)) {
		return getResults([...candidates, ...extras], unfiltered, scores);
	}
	return blendSemantic(candidates, extras, similarity, weight);
}
// #endregion
