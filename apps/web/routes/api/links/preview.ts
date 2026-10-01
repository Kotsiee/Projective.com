import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { LinkPreviewRequestSchema } from "@projective/types/links";
import { LinkPreviewBackendService } from "@server/services/links/LinkPreviewBackendService.ts";

/**
 * `POST /api/links/preview` `{ urls }` — thin route: the previews for the links a rendered page of
 * messages carries, delegated to the fat {@link LinkPreviewBackendService}. The serving origin's host
 * is taken from the request, never from the body. Private and uncached: a card can carry a reader's
 * own escrow position.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to see link previews." }, {
				status: 401,
			});
		}
		const parsed = LinkPreviewRequestSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json({ ok: false, message: "Send between 1 and 20 links." }, { status: 422 });
		}
		const result = await LinkPreviewBackendService.previews(parsed.data.urls, actor, ctx.url.host);
		return Response.json(
			{ ok: result.ok, message: result.message, data: result.data, details: result.details },
			{ status: result.status, headers: { "cache-control": "private, no-store" } },
		);
	},
});
