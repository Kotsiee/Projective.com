import { IS_DEV } from "@web/utils/dev.ts";
import { embeddingsStatus, isEmbeddingsLive } from "@projective/backend/core/supabase.ts";
import {
	DISCOVERY_RANKING_HEADER,
	type DiscoveryRanking,
	type EmbeddingsStatus,
} from "@projective/types/explore";

/**
 * discovery-ranking — the request-scoped embeddings switch for the discovery routes (Decision #179).
 * Server-only (route handlers and middleware); islands reach discovery through `/api/explore/*`.
 *
 * The request is handed to the gate only from a development build — the same `IS_DEV` guard as the
 * `pj.dev.landing` cookie — so only there can the Dev Context Switcher's `pj.dev.embeddings` cookie
 * reach it; a production build passes nothing and the environment alone decides.
 */

/** Whether discovery may rank with voyage-4 vectors for `req`. */
export function semanticRankingFor(req: Request): boolean {
	return isEmbeddingsLive(IS_DEV ? req : undefined);
}

/** The effective switch with its inputs, for the development status endpoint. */
export function embeddingsStatusFor(req: Request): EmbeddingsStatus {
	return embeddingsStatus(IS_DEV ? req : undefined);
}

/** The development-only `x-discovery-ranking` header, as `page()` / `Response` header pairs. */
export function rankingHeaders(ranking: DiscoveryRanking): Array<[string, string]> {
	return IS_DEV ? [[DISCOVERY_RANKING_HEADER, ranking]] : [];
}
