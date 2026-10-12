import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { toExploreResponse } from "@features/explore/core/respond.ts";
import { ExploreBookmarkService } from "@server/services/explore/ExploreBookmarkService.ts";
import { BookmarkWriteSchema } from "@projective/types/explore";

/**
 * `/api/explore/bookmark` — a discovery card's Star. Thin route: auth guard + Zod, then
 * {@link ExploreBookmarkService}.
 *
 * - `GET` — the caller's saved items, as discovery ids.
 * - `POST` `{ itemId, saved }` — save or unsave one item; idempotent both ways.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to see what you've saved." }, {
				status: 401,
			});
		}
		return toExploreResponse(await ExploreBookmarkService.list(actor));
	},

	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to save." }, { status: 401 });
		}
		const raw: unknown = await ctx.req.json().catch(() => null);
		const body = BookmarkWriteSchema.safeParse(raw);
		if (!body.success) {
			return Response.json({ ok: false, message: "Choose an item to save." }, { status: 422 });
		}
		return toExploreResponse(
			await ExploreBookmarkService.set(body.data.itemId, body.data.saved, actor),
		);
	},
});
