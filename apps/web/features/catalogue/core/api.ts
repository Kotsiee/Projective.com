import type { CatalogueResult } from "../types/results.ts";
import { apiFetch } from "@web/utils/api-client.ts";

/**
 * Catalogue transport primitives — the `fetch` helpers the thin {@link CatalogueService} composes over.
 * Reads are GETs; mutations (create / update / setStatus) are JSON POSTs. Any network/parse failure
 * degrades to a soft `{ ok: false, message }` rather than throwing, so islands stay dumb (mirrors
 * `projects/core/api.ts`).
 *
 * Requests go through {@link apiFetch}, so an expired access token on a `/api/catalogue/*` call is
 * silently refreshed and retried (or routed to `/login` with the current path preserved) instead of
 * surfacing as a bare failure or a surprise logout (Decision #46) — important on a write surface where
 * a lost session mid-edit must not silently drop a mutation.
 */

/** GET a catalogue endpoint, folding the response into a soft {@link CatalogueResult}. */
export async function getCatalogue<T>(path: string): Promise<CatalogueResult<T>> {
	try {
		const res = await apiFetch(path, { headers: { accept: "application/json" } });
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as CatalogueResult<T>;
		return { ok: false, message: "Unexpected response from the catalogue service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}

/** POST JSON to a catalogue endpoint, folding the response into a soft {@link CatalogueResult}. */
export async function postCatalogue<T>(
	path: string,
	payload: unknown,
): Promise<CatalogueResult<T>> {
	try {
		const res = await apiFetch(path, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify(payload),
		});
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as CatalogueResult<T>;
		return { ok: false, message: "Unexpected response from the catalogue service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}
