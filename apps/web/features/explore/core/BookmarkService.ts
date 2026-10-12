import { apiFetch } from "@web/utils/api-client.ts";
import type { SavedItems } from "@projective/types/explore";
import type { ExploreResult } from "../types/results.ts";

async function send<T>(init?: RequestInit): Promise<ExploreResult<T>> {
	try {
		const res = await apiFetch("/api/explore/bookmark", {
			...init,
			headers: {
				accept: "application/json",
				...(init?.body ? { "content-type": "application/json" } : {}),
			},
		});
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as ExploreResult<T>;
		return { ok: false, message: "Unexpected response from the discovery service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}

/**
 * BookmarkService — the THIN client controller for `/api/explore/bookmark` (a card's Star). Signed-in
 * callers only: the route answers a guest with a 401, which {@link apiFetch} turns into a sign-in
 * redirect, so a guest's Star is a sign-in link and never reaches here.
 */
export const BookmarkService = {
	/** The caller's saved items, as discovery ids. */
	list(): Promise<ExploreResult<SavedItems>> {
		return send<SavedItems>();
	},

	/** Save or unsave one item; the body states the wanted state, so a retry is idempotent. */
	set(itemId: string, saved: boolean): Promise<ExploreResult<{ itemId: string; saved: boolean }>> {
		return send({ method: "POST", body: JSON.stringify({ itemId, saved }) });
	},
};
