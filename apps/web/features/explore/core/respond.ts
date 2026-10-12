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

/** The 422 a query that failed its Zod parse answers with, in the same {@link ExploreResult} shape. */
export function invalidQuery(
	error: { issues: ReadonlyArray<{ path: ReadonlyArray<string | number | symbol>; message: string }> },
): Response {
	const errors: Record<string, string> = {};
	for (const issue of error.issues) {
		const key = issue.path.map(String).join(".") || "query";
		if (!errors[key]) errors[key] = issue.message;
	}
	const body: ExploreResult<never> = { ok: false, message: "Check the search query.", errors };
	return Response.json(body, { status: 422 });
}
