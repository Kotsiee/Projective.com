import { IS_DEV } from "@web/utils/dev.ts";
import { clientKey } from "@web/utils/client-key.ts";
import { embeddingsStatus, isEmbeddingsLive } from "@projective/backend/core/supabase.ts";
import {
	DISCOVERY_RANKING_HEADER,
	DISCOVERY_RANKING_REASON_HEADER,
	type DiscoveryRanking,
	type DiscoveryRankingReason,
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

/**
 * The key a caller's query embeddings are counted under (COMMS SR2, CAS S30): the signed-in user,
 * else the client address `client-key.ts` resolves for the request.
 */
export function discoveryClientFor(
	remote: Deno.Addr,
	req: Request,
	userId: string | null | undefined,
): string {
	return userId ? `user:${userId}` : `ip:${clientKey(remote, req.headers)}`;
}

/**
 * The development-only `x-discovery-ranking` header, and `x-discovery-ranking-reason` when a search
 * fell back for a reason, as `page()` / `Response` header pairs.
 */
export function rankingHeaders(
	ranking: DiscoveryRanking,
	reason?: DiscoveryRankingReason,
): Array<[string, string]> {
	if (!IS_DEV) return [];
	const headers: Array<[string, string]> = [[DISCOVERY_RANKING_HEADER, ranking]];
	if (reason) headers.push([DISCOVERY_RANKING_REASON_HEADER, reason]);
	return headers;
}
