import type { ExploreParams } from "@projective/types/explore";
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
 * Record a discovery query in `search.query_logs` (the `discovery.search` event) through the
 * guest-safe `search.fn_log_query` definer. The RPC attributes the row to `auth.uid()` itself, so a
 * caller cannot name another user. A no-op while `EXPLORE_BACKEND_LIVE` is off. Throws when the
 * write fails both as the caller and anonymously.
 */
export async function logDiscoveryQuery(actor: ReadActor, log: DiscoveryQueryLog): Promise<void> {
	if (!isExploreBackendLive()) return;
	const { q, ...filters } = log.params;
	await writeTelemetry(actor, (db) =>
		db.schema("search").rpc("fn_log_query", {
			p_query: q.trim(),
			p_entity_type: log.params.category,
			p_filters: filters,
			p_result_count: log.resultCount,
			p_duration_ms: Math.round(log.durationMs),
			p_candidate_pool: log.candidatePool,
			...(log.queryEmbedding ? { p_query_embedding: vectorLiteral(log.queryEmbedding) } : {}),
		}));
}
