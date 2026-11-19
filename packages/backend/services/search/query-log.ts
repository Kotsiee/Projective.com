import { type ExploreParams, isExploreFacetKey } from "@projective/types/explore";
import { isExploreBackendLive } from "../../core/supabase.ts";
import type { ReadActor } from "../read-actor.ts";
import { writeTelemetry } from "../telemetry-writer.ts";
import { vectorLiteral } from "./embedding-index.ts";

/** One executed discovery query, as `search.fn_log_query` records it. */
export interface DiscoveryQueryLog {
	params: ExploreParams;
	resultCount: number;
	/** Items in the searched category before filtering — the `matched_density` denominator. */
	candidatePool: number;
	durationMs: number;
	/** The voyage-4 query vector, when semantic ranking ran (Decision #179); otherwise absent. */
	queryEmbedding?: readonly number[];
}

/**
 * What `search.query_logs.filters_applied` stores for a query: its category, its order and its
 * facets, keyed by `EXPLORE_FACET_KEYS` only (CAS S37). The doors already drop any other key; this
 * keeps one that slipped past them out of the log.
 */
export function filtersApplied(
	params: ExploreParams,
): Pick<ExploreParams, "category" | "sort" | "filters"> {
	const filters = Object.fromEntries(
		Object.entries(params.filters).filter(([key]) => isExploreFacetKey(key)),
	);
	return { category: params.category, sort: params.sort, filters };
}

/**
 * Record a discovery query in `search.query_logs` (the `discovery.search` event) through the
 * guest-safe `search.fn_log_query` definer, the table's only writer. The RPC takes no user id and
 * attributes the row to `auth.uid()` itself (NULL for a guest or a minor), so a caller cannot name
 * another user. A no-op while `EXPLORE_BACKEND_LIVE` is off. Throws when the write fails both as the
 * caller and anonymously.
 */
export async function logDiscoveryQuery(actor: ReadActor, log: DiscoveryQueryLog): Promise<void> {
	if (!isExploreBackendLive()) return;
	await writeTelemetry(actor, (db) =>
		db.schema("search").rpc("fn_log_query", {
			p_query: log.params.q.trim(),
			p_entity_type: log.params.category,
			p_filters: filtersApplied(log.params),
			p_result_count: log.resultCount,
			p_duration_ms: Math.round(log.durationMs),
			p_candidate_pool: log.candidatePool,
			...(log.queryEmbedding ? { p_query_embedding: vectorLiteral(log.queryEmbedding) } : {}),
		}));
}
