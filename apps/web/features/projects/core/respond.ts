import type { ServiceResult } from "@server/services/ServiceResult.ts";
import type { ProjectsResult } from "../types/results.ts";

/**
 * Fold a fat-service {@link ServiceResult} into the client {@link ProjectsResult} HTTP BODY.
 *
 * Split out from {@link toProjectsResponse} so the read routes can hand the body shape to
 * `defineReadRoute`, which needs to serialise and HASH the exact bytes before it builds a `Response`
 * — it cannot do that with a `Response` it was handed already assembled. Both functions share this
 * one mapper, so the envelope stays defined in a single place regardless of which verb produced it.
 */
export function toProjectsBody<T>(result: ServiceResult<T>): ProjectsResult<T> {
	return {
		ok: result.ok,
		message: result.message,
		errors: result.errors,
		data: result.data,
	};
}

/**
 * Fold a fat-service {@link ServiceResult} into the client {@link ProjectsResult} HTTP body and echo
 * its suggested status. The mapper every non-read `/api/projects/*` route uses (mirrors the explore
 * feature's `respond.ts`); the read routes go through `defineReadRoute` instead, which adds the
 * validator and the `HEAD`/`OPTIONS` verbs.
 */
export function toProjectsResponse<T>(result: ServiceResult<T>): Response {
	return Response.json(toProjectsBody(result), { status: result.status });
}
