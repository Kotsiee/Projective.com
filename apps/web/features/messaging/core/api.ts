import type { MessagingResult } from "../types/results.ts";
import { apiFetch } from "@web/utils/api-client.ts";
import { BACKGROUND_HEADER } from "@web/utils/offline.ts";

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

/**
 * POST a bodiless write the page makes on the person's behalf rather than at their click: the read
 * mark. It is background work, so it is sent `keepalive` (it survives the person leaving the page
 * mid-flight) with the background marker (an expired session never sends them to `/login`, Decision
 * #374, and an offline refusal raises no notice). No body and no `Content-Type`, which is what the
 * `/api` origin guard expects of a bodiless write. Resolves to whether the server accepted it.
 */
export async function signalMessaging(path: string): Promise<MessagingResult<null>> {
	try {
		const res = await apiFetch(path, {
			method: "POST",
			headers: { accept: "application/json", [BACKGROUND_HEADER]: "1" },
			keepalive: true,
		});
		if (res.ok) return { ok: true, data: null };
		const body = await res.json().catch(() => null);
		return {
			ok: false,
			message: typeof body?.message === "string"
				? body.message
				: "The messaging service refused it.",
		};
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}
