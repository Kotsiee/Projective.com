import type { ServiceResult } from "@server/services/ServiceResult.ts";
import type { ProfileResult } from "../types/results.ts";

/**
 * Fold a fat-service {@link ServiceResult} into the client {@link ProfileResult} HTTP body and echo its
 * suggested status. The single mapper every `/api/profile/*` route uses (mirrors the projects/explore
 * features' `respond.ts`), so the transport shape stays consistent and defined in one place.
 */
export function toProfileResponse<T>(result: ServiceResult<T>): Response {
	const body: ProfileResult<T> = {
		ok: result.ok,
		message: result.message,
		errors: result.errors,
		data: result.data,
	};
	return Response.json(body, { status: result.status });
}
