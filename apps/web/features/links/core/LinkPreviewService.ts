import { apiFetch } from "@web/utils/api-client.ts";
import type { LinkPreviewResult } from "@projective/types/links";

/** The soft envelope every link endpoint answers with. */
export interface LinksResult<T> {
	ok: boolean;
	message?: string;
	data?: T;
}

/**
 * LinkPreviewService — the THIN client for `POST /api/links/preview`. A network or parse failure
 * comes back as a soft `{ ok: false, message }` rather than a throw, so a feed renders its links
 * plainly (and routes them through the interstitial) when previews are unavailable.
 */
export const LinkPreviewService = {
	/** The previews for up to 20 links, keyed by the URL asked about. */
	async previews(urls: string[]): Promise<LinksResult<LinkPreviewResult>> {
		try {
			const res = await apiFetch("/api/links/preview", {
				method: "POST",
				headers: { "content-type": "application/json", accept: "application/json" },
				body: JSON.stringify({ urls }),
			});
			const body = await res.json().catch(() => null);
			if (body && typeof body.ok === "boolean") return body as LinksResult<LinkPreviewResult>;
			return { ok: false, message: "Unexpected response from the link preview service." };
		} catch {
			return { ok: false, message: "Network error — link previews are unavailable." };
		}
	},
};
