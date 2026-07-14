import type { ServiceResult } from "@server/services/ServiceResult.ts";
import type { NewsletterResult } from "../types/newsletter.ts";
import type { NewsletterSubscribeResult } from "@projective/types/newsletter";

/**
 * Fold a fat-service {@link ServiceResult} into the client {@link NewsletterResult} HTTP body and echo
 * its suggested status. The single mapper the `/api/newsletter/*` route uses (mirrors the auth and
 * explore features' `respond.ts`), so the transport shape stays consistent and defined in one place.
 */
export function toNewsletterResponse(
	result: ServiceResult<NewsletterSubscribeResult>,
): Response {
	const body: NewsletterResult = {
		ok: result.ok,
		message: result.message,
		errors: result.errors,
		data: result.data,
	};
	return Response.json(body, { status: result.status });
}
