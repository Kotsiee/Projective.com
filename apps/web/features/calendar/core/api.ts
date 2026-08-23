import { apiFetch } from "@web/utils/api-client.ts";
import type { CalendarResult } from "../types/results.ts";

/**
 * Calendar transport primitives — the `fetch` helpers the thin {@link ScheduleService} composes over.
 * Any network/parse failure degrades to a soft `{ ok: false, message }` rather than throwing, so islands
 * stay dumb (mirrors `projects/core/api.ts`).
 */

/**
 * A calendar READ. Deliberately plain `fetch`: `/api/scheduling/{availability,schedule}` are public
 * surfaces a signed-out visitor legitimately reads, and `apiFetch`'s unrecoverable-401 path navigates
 * to `/login` — which would throw a guest off a page they are entitled to be on.
 */
export async function getScheduling<T>(path: string): Promise<CalendarResult<T>> {
	try {
		const res = await fetch(path, { headers: { accept: "application/json" } });
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as CalendarResult<T>;
		return { ok: false, message: "Unexpected response from the scheduling service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}

/**
 * A calendar WRITE. Uses {@link apiFetch}, so an access token that expired while somebody had a
 * calendar open is silently renewed and the request retried rather than surfacing as a lost RSVP
 * (Decision #46). Here the sign-in redirect is the CORRECT outcome: the route already requires a
 * session, so a genuinely gone one has nowhere else to go.
 */
export async function postScheduling<T>(path: string, body: unknown): Promise<CalendarResult<T>> {
	try {
		const res = await apiFetch(path, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify(body),
		});
		const parsed = await res.json().catch(() => null);
		if (parsed && typeof parsed.ok === "boolean") return parsed as CalendarResult<T>;
		return { ok: false, message: "Unexpected response from the scheduling service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}
