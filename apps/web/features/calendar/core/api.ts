import type { CalendarResult } from "../types/results.ts";

/**
 * Calendar transport primitive — the `fetch` helper the thin {@link ScheduleService} composes over.
 * Any network/parse failure degrades to a soft `{ ok: false, message }` rather than throwing, so islands
 * stay dumb (mirrors `projects/core/api.ts`).
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
