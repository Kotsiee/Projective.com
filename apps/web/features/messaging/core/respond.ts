import type { ServiceResult } from "@server/services/ServiceResult.ts";
import type { MessagingResult } from "../types/results.ts";

/**
 * Fold a fat-service {@link ServiceResult} into the client {@link MessagingResult} HTTP body and echo
 * its suggested status. The single mapper every `/api/messaging/*` route uses (mirrors the projects
 * feature's `respond.ts`), so the transport shape stays consistent and defined in one place.
 */
export function toMessagingResponse<T>(result: ServiceResult<T>): Response {
	const body: MessagingResult<T> = {
		ok: result.ok,
		message: result.message,
		errors: result.errors,
		data: result.data,
	};
	return Response.json(body, { status: result.status });
}
