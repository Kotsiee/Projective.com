import { define } from "@web/utils/state.ts";
import { FILE_OBJECT_TIERS, type FileObjectTier } from "@projective/types/files";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `GET /api/files/object/[id]?tier=&download=1&share=` — the stable address of an asset's bytes.
 *
 * A private object has no public URL, and a signed one expires — storing or server-rendering it would
 * ship a link that stops working while the page is open. So every private asset URL the platform emits
 * points HERE, and this route redirects each request to a fresh short-lived one after the fat service
 * has decided the caller may read the file: under their own session (RLS), as a visitor (public files
 * only), or through a live share link that reaches it.
 *
 * `tier` asks for a WebP rendition (the original when none was written); `download` asks for an
 * attachment. Every refusal — no such file, not yours, a dead share link — is the same bodiless 404, so
 * the route cannot be used to learn that a file exists.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const sp = ctx.url.searchParams;
		const tierRaw = sp.get("tier");
		const tier = tierRaw && (FILE_OBJECT_TIERS as readonly string[]).includes(tierRaw)
			? tierRaw as FileObjectTier
			: null;
		const result = await FilesBackendService.objectUrl(ctx.params.id, {
			tier,
			share: sp.get("share"),
			download: sp.get("download") === "1",
		}, readActor(ctx));
		if (!result.ok || !result.data) {
			return new Response(null, {
				status: result.status === 503 ? 503 : 404,
				headers: { "cache-control": "no-store" },
			});
		}
		return new Response(null, {
			status: 302,
			headers: {
				location: result.data.url,
				// A signed URL lives five minutes; the redirect to it may be reused for a little less, by
				// this browser only. A public object's address is stable.
				"cache-control": result.data.private ? "private, max-age=240" : "public, max-age=3600",
				vary: "cookie",
			},
		});
	},
});
