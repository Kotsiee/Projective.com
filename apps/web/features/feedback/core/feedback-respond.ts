import type { ServiceResult } from "@server/services/ServiceResult.ts";
import { serviceBody } from "@web/utils/service-response.ts";
import { retryAfterSeconds } from "@features/marketing/core/newsletter-respond.ts";

/**
 * feedback-respond — the one mapper the `/api/feedback/*` routes answer through (Decision #272): the
 * flat `serviceBody` envelope at the service's status, never cached (every answer depends on who is
 * asking — their votes, their ideas under review), and on a 429 a `Retry-After` taken from
 * `details.retryAt`.
 */
export function feedbackResponse<T extends object>(result: ServiceResult<T>): Response {
	const headers = new Headers({ "cache-control": "private, no-store" });
	if (result.status === 429) {
		const seconds = retryAfterSeconds(result.details?.retryAt);
		if (seconds !== null) headers.set("retry-after", String(seconds));
	}
	return Response.json(serviceBody(result), { status: result.status, headers });
}

/** The 404 an address that is not an idea's earns — a uuid never routes (Decision #88). */
export function feedbackNotFound(): Response {
	return Response.json(
		{ ok: false, message: "That idea isn't on the board." },
		{ status: 404, headers: { "cache-control": "private, no-store" } },
	);
}
