import type { ServiceResult } from "@server/services/ServiceResult.ts";
import type { ExploreResult } from "../types/results.ts";

/**
 * Fold a fat-service {@link ServiceResult} into the client {@link ExploreResult} HTTP body and echo
 * its suggested status. The single mapper every `/api/explore/*` route uses (mirrors the auth
 * feature's `respond.ts`), so the transport shape stays consistent and defined in one place.
 */
export function toExploreResponse<T>(result: ServiceResult<T>): Response {
	const body: ExploreResult<T> = {
		ok: result.ok,
		message: result.message,
		errors: result.errors,
		data: result.data,
	};
	return Response.json(body, { status: result.status });
}
