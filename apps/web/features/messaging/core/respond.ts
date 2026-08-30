import type { ServiceResult } from "@server/services/ServiceResult.ts";
import type { MessagingResult } from "../types/results.ts";

/**
 * Fold a fat-service {@link ServiceResult} into the client {@link MessagingResult} HTTP BODY.
 *
 * Split out from {@link toMessagingResponse} so the read routes can hand the body shape to
 * `defineReadRoute`, which serialises and HASHES the exact bytes before building a `Response` — it
 * cannot do that with a `Response` handed to it already assembled. Both functions share this mapper,
 * so the envelope is defined once.
 */
export function toMessagingBody<T>(result: ServiceResult<T>): MessagingResult<T> {
	return {
		ok: result.ok,
		message: result.message,
		errors: result.errors,
		data: result.data,
	};
}

/**
 * Fold a fat-service {@link ServiceResult} into the client {@link MessagingResult} HTTP body and echo
 * its suggested status. The mapper every non-read `/api/messaging/*` route uses; the read routes go
 * through `defineReadRoute` instead, which adds the validator and the `HEAD`/`OPTIONS` verbs.
 */
export function toMessagingResponse<T>(result: ServiceResult<T>): Response {
	return Response.json(toMessagingBody(result), { status: result.status });
}
