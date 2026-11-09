import { define } from "@web/utils/state.ts";
import { DriveThumbnailParamsSchema } from "@projective/types/integrations";
import { readActor } from "@web/utils/api-session.ts";
import { IntegrationsBackendService } from "@server/services/integrations/IntegrationsBackendService.ts";

/**
 * `GET /api/files/drive-thumbnail?connectionId=&id=&v=` — a connected drive object's preview picture,
 * the address a `/files` card draws for it.
 *
 * Validates the query through {@link DriveThumbnailParamsSchema} and delegates to the fat
 * {@link IntegrationsBackendService.thumbnail}, which reads the picture under the caller's own
 * connection and fetches it server-side, so no provider address, token or header reaches the page. The
 * answer carries only this route's own headers. Every refusal is bodiless, and the card then keeps its
 * file tile; `v` is a cache key and is never read.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const sp = ctx.url.searchParams;
		const parsed = DriveThumbnailParamsSchema.safeParse({
			connectionId: sp.get("connectionId") ?? "",
			id: sp.get("id") ?? "",
			v: sp.get("v"),
		});
		if (!parsed.success) return refused(400);

		const result = await IntegrationsBackendService.thumbnail(parsed.data, readActor(ctx));
		if (!result.ok || !result.data) return refused(result.status);

		const { bytes, contentType } = result.data;
		return new Response(bytes, {
			status: 200,
			headers: {
				"content-type": contentType,
				"content-length": String(bytes.byteLength),
				"cache-control": "private, max-age=3600",
				vary: "cookie",
				"x-content-type-options": "nosniff",
				"cross-origin-resource-policy": "same-origin",
				"content-security-policy": "default-src 'none'; sandbox",
				"referrer-policy": "no-referrer",
				"x-robots-tag": "noindex, nofollow",
			},
		});
	},
});

const PASSED_THROUGH = new Set([400, 401, 403, 404, 409, 429, 502, 503]);

function refused(status: number): Response {
	return new Response(null, {
		status: PASSED_THROUGH.has(status) ? status : 404,
		headers: { "cache-control": "no-store" },
	});
}
