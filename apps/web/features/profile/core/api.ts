import { apiFetch } from "@web/utils/api-client.ts";
import type { ProfileResult } from "../types/results.ts";

/**
 * Profile transport primitives — the two `fetch` helpers the thin {@link ProfileService} and
 * `MediaService` compose over.
 *
 * Any network/parse failure degrades to a soft `{ ok: false, message }` rather than throwing, so
 * islands stay dumb (mirrors the explore/auth features' `api.ts`). Both go through `apiFetch`, so an
 * access token that expired while the page was open is renewed once and the request retried, and an
 * offline write is refused with the app's own envelope instead of being sent into the dark.
 */

async function parse<T>(res: Response): Promise<ProfileResult<T>> {
	const body = await res.json().catch(() => null);
	if (body && typeof body.ok === "boolean") return body as ProfileResult<T>;
	return { ok: false, message: "Unexpected response from the profile service." };
}

/** A GET. */
export async function getProfile<T>(path: string): Promise<ProfileResult<T>> {
	try {
		return await parse<T>(await apiFetch(path, { headers: { accept: "application/json" } }));
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}

/** A write with a JSON body. */
export async function sendProfile<T>(
	path: string,
	method: "POST" | "PUT",
	body: unknown,
): Promise<ProfileResult<T>> {
	try {
		return await parse<T>(
			await apiFetch(path, {
				method,
				headers: { accept: "application/json", "content-type": "application/json" },
				body: JSON.stringify(body),
			}),
		);
	} catch {
		return { ok: false, message: "Network error — your changes weren't saved. Try again." };
	}
}
