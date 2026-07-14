import type { ExploreResult } from "../types/results.ts";

/**
 * Explore transport primitive — a single `fetch` helper the thin {@link ExploreService} composes over.
 *
 * All discovery reads are GETs. Any network/parse failure degrades to a soft `{ ok: false, message }`
 * rather than throwing, so islands stay dumb (mirrors the auth feature's `api.ts`).
 */
export async function getExplore<T>(path: string): Promise<ExploreResult<T>> {
	try {
		const res = await fetch(path, { headers: { accept: "application/json" } });
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as ExploreResult<T>;
		return { ok: false, message: "Unexpected response from the discovery service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}
