import type { ServiceResult } from "@server/services/ServiceResult.ts";
import type { ProjectsResult } from "../types/results.ts";

/**
 * Fold a fat-service {@link ServiceResult} into the client {@link ProjectsResult} HTTP body and echo
 * its suggested status. The single mapper every `/api/projects/*` route uses (mirrors the explore
 * feature's `respond.ts`), so the transport shape stays consistent and defined in one place.
 */
export function toProjectsResponse<T>(result: ServiceResult<T>): Response {
	const body: ProjectsResult<T> = {
		ok: result.ok,
		message: result.message,
		errors: result.errors,
		data: result.data,
	};
	return Response.json(body, { status: result.status });
}
