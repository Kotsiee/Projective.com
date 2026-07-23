import type { MessagingResult } from "../types/results.ts";
import { apiFetch } from "@web/utils/api-client.ts";

/**
 * Messaging transport primitives — the `fetch` helpers the thin {@link MessagingService} composes over.
 * Reads are GETs; mutations (create conversation, save settings) are JSON POSTs. Any network/parse
 * failure degrades to a soft `{ ok: false, message }` rather than throwing, so islands stay dumb
 * (mirrors `projects/core/api.ts`).
 *
 * Requests go through {@link apiFetch}, so an expired access token on a live `/api/messaging/*` read is
 * silently refreshed and retried (or routed to `/login` with the current path preserved) instead of
 * surfacing as a bare failure or a surprise logout.
 */

/** GET a messaging endpoint, folding the response into a soft {@link MessagingResult}. */
export async function getMessaging<T>(path: string): Promise<MessagingResult<T>> {
	try {
		const res = await apiFetch(path, { headers: { accept: "application/json" } });
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as MessagingResult<T>;
		return { ok: false, message: "Unexpected response from the messaging service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}

/** POST JSON to a messaging endpoint, folding the response into a soft {@link MessagingResult}. */
export async function postMessaging<T>(
	path: string,
	payload: unknown,
): Promise<MessagingResult<T>> {
	try {
		const res = await apiFetch(path, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify(payload),
		});
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as MessagingResult<T>;
		return { ok: false, message: "Unexpected response from the messaging service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}
