import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { LibraryListParamsSchema } from "@projective/types/files";
import { toProfileResponse } from "@features/profile/core/respond.ts";
import { MediaBackendService } from "@server/services/media/MediaBackendService.ts";

/**
 * `GET /api/media/library?kind=image|video|all&cursor=&limit=` — one page of the caller's media
 * library, newest first, with short-lived signed thumbnail URLs. Never cached: the URLs expire.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to use your media library." }, { status: 401 });
		}
		const q = ctx.url.searchParams;
		const parsed = LibraryListParamsSchema.safeParse({
			kind: q.get("kind") ?? undefined,
			cursor: q.get("cursor") || null,
			limit: q.has("limit") ? Number(q.get("limit")) : undefined,
		});
		if (!parsed.success) {
			return Response.json({ ok: false, message: "Unknown library filter." }, { status: 400 });
		}
		const res = toProfileResponse(await MediaBackendService.library(actor, parsed.data));
		res.headers.set("Cache-Control", "private, no-store");
		return res;
	},
});
