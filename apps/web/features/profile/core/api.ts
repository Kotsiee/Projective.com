import type { ProfileResult } from "../types/results.ts";

/**
 * Profile transport primitive — a single `fetch` helper the thin {@link ProfileService} composes over.
 *
 * All profile reads are GETs. Any network/parse failure degrades to a soft `{ ok: false, message }`
 * rather than throwing, so islands stay dumb (mirrors the explore/auth features' `api.ts`).
 */
export async function getProfile<T>(path: string): Promise<ProfileResult<T>> {
	try {
		const res = await fetch(path, { headers: { accept: "application/json" } });
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as ProfileResult<T>;
		return { ok: false, message: "Unexpected response from the profile service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}
