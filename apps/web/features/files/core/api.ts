import type { FilesResult } from "../types/results.ts";
import { apiFetch } from "@web/utils/api-client.ts";

/**
 * Files transport primitives — the `fetch` helpers the thin {@link FilesService} composes over. Reads
 * are GETs; mutations (upload handshake / link / rename / move / delete / visibility / folder / share)
 * are JSON POSTs. Any network or parse failure degrades to a soft `{ ok: false, message }` rather
 * than throwing, so islands stay dumb (mirrors `catalogue/core/api.ts`).
 *
 * Requests go through {@link apiFetch}, so an expired access token on a `/api/files/*` call is
 * silently refreshed and retried — or routed to `/login` with the current path preserved — instead of
 * surfacing as a bare failure or a surprise logout (Decision #46). That matters more here than on a
 * read surface: an upload handshake spans three requests over however long the bytes take, so the
 * access token can plausibly expire BETWEEN init and complete, and a dropped mutation there would
 * strand a `pending_upload` row whose object had already landed.
 *
 * Neither helper re-implements the 401 dance; {@link apiFetch} already shares a single in-flight
 * refresh across concurrent calls, which is exactly the case a multi-file drop produces.
 */

/** GET a files endpoint, folding the response into a soft {@link FilesResult}. */
export async function getFiles<T>(path: string): Promise<FilesResult<T>> {
	try {
		const res = await apiFetch(path, { headers: { accept: "application/json" } });
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as FilesResult<T>;
		return { ok: false, message: "Unexpected response from the files service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}

/** POST JSON to a files endpoint, folding the response into a soft {@link FilesResult}. */
export async function postFiles<T>(
	path: string,
	payload: unknown,
): Promise<FilesResult<T>> {
	try {
		const res = await apiFetch(path, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify(payload),
		});
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as FilesResult<T>;
		return { ok: false, message: "Unexpected response from the files service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}
