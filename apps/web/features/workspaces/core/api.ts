import { apiFetch } from "@web/utils/api-client.ts";
import type { WorkspaceResult } from "../types/results.ts";

/**
 * Workspace transport primitives — the `fetch` helpers the thin {@link WorkspaceService} composes over.
 * Reads are GETs; every mutation is a JSON POST. Any network or parse failure degrades to a soft
 * `{ ok: false, message }` rather than throwing, so islands stay dumb (mirrors `catalogue/core/api.ts`
 * and `projects/core/api.ts`).
 *
 * Requests go through {@link apiFetch}, so an expired access token on a `/api/workspace/*` call is
 * silently refreshed and retried — or routed to `/login` with the current path preserved — instead of
 * surfacing as a bare failure or a surprise logout (Decision #46). That matters more here than on a
 * read-only surface: this feature writes roster membership, role matrices and money policy, and a
 * session that lapses mid-edit must not drop the mutation on the floor while the editor still shows
 * the pending state as if it had saved.
 */

// #region Transport
/** GET a workspace endpoint, folding the response into a soft {@link WorkspaceResult}. */
export async function getWorkspace<T>(path: string): Promise<WorkspaceResult<T>> {
	try {
		const res = await apiFetch(path, { headers: { accept: "application/json" } });
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as WorkspaceResult<T>;
		return { ok: false, message: "Unexpected response from the workspace service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}

/** POST JSON to a workspace endpoint, folding the response into a soft {@link WorkspaceResult}. */
export async function postWorkspace<T>(
	path: string,
	payload: unknown,
): Promise<WorkspaceResult<T>> {
	try {
		const res = await apiFetch(path, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify(payload),
		});
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as WorkspaceResult<T>;
		return { ok: false, message: "Unexpected response from the workspace service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}
// #endregion

// #region Query building
/**
 * Build a query string from a sparse record, dropping `undefined`/`null`/`""` so an absent filter never
 * ships as an empty param the route then has to defend against.
 */
export function queryOf(
	params: Record<string, string | number | boolean | null | undefined>,
): string {
	const qs = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null || value === "") continue;
		qs.set(key, String(value));
	}
	const out = qs.toString();
	return out ? `?${out}` : "";
}
// #endregion
