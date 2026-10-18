import type { ServiceResult } from "@server/services/ServiceResult.ts";
import { retryAfterSeconds } from "@features/marketing/core/newsletter-respond.ts";

/**
 * contact-respond — the one mapper `/api/contact/*` uses to turn a fat-service result into the JSON
 * envelope the island reads: `{ ok, message, errors, details, data }` at the service's status, with
 * `Retry-After` on a 429 (from `details.retryAt`) and `no-store` always — a receipt or a ticket is
 * never cacheable.
 */

/** The JSON body every contact route answers. */
export interface ContactEnvelope<T> {
	ok: boolean;
	message?: string;
	errors?: Record<string, string>;
	details?: Record<string, string | number | boolean | null>;
	data?: T;
}

/** Fold a {@link ServiceResult} into the route's `Response`. */
export function toContactResponse<T>(result: ServiceResult<T>): Response {
	const body: ContactEnvelope<T> = {
		ok: result.ok,
		message: result.message,
		errors: result.errors,
		details: result.details,
		data: result.data,
	};
	const headers = new Headers({ "cache-control": "no-store" });
	if (result.status === 429) {
		const seconds = retryAfterSeconds(result.details?.retryAt);
		if (seconds !== null) headers.set("retry-after", String(seconds));
	}
	return Response.json(body, { status: result.status, headers });
}

/** A 422 for a body that is not JSON at all. */
export function unreadableBody(): Response {
	return Response.json(
		{ ok: false, message: "That request couldn't be read." } satisfies ContactEnvelope<never>,
		{ status: 422, headers: { "cache-control": "no-store" } },
	);
}

/** The caller's transport address — the per-IP rate-limit key (the platform's own convention). */
export function clientKey(remote: Deno.Addr): string {
	return "hostname" in remote ? remote.hostname : remote.transport;
}
