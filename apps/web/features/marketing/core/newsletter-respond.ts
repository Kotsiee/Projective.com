import type { ServiceResult } from "@server/services/ServiceResult.ts";
import type { NewsletterResult } from "../types/newsletter.ts";
import type { NewsletterSubscribeResult } from "@projective/types/community";

/**
 * Seconds until `retryAt` (an ISO instant), rounded up and at least 1 — the `Retry-After` value a
 * rate-limited answer carries. `null` when `retryAt` is not a parseable instant.
 */
export function retryAfterSeconds(retryAt: unknown, now: number = Date.now()): number | null {
	if (typeof retryAt !== "string") return null;
	const at = Date.parse(retryAt);
	if (!Number.isFinite(at)) return null;
	return Math.max(1, Math.ceil((at - now) / 1000));
}

/**
 * Fold a fat-service {@link ServiceResult} into the client {@link NewsletterResult} HTTP body and echo
 * its suggested status. The single mapper the `/api/newsletter/*` route uses (mirrors the auth and
 * explore features' `respond.ts`), so the transport shape stays consistent and defined in one place.
 * A refusal's `details` travel in the body (`retryAt` on a 429, `code` on a 503), and a 429 also
 * sets `Retry-After` from `details.retryAt`.
 */
export function toNewsletterResponse(
	result: ServiceResult<NewsletterSubscribeResult>,
): Response {
	const body: NewsletterResult = {
		ok: result.ok,
		message: result.message,
		errors: result.errors,
		details: result.details,
		data: result.data,
	};
	const headers = new Headers();
	if (result.status === 429) {
		const seconds = retryAfterSeconds(result.details?.retryAt);
		if (seconds !== null) headers.set("retry-after", String(seconds));
	}
	return Response.json(body, { status: result.status, headers });
}
