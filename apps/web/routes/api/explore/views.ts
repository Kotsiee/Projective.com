import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { toExploreResponse } from "@features/explore/core/respond.ts";
import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";
import { RecordViewRequestSchema } from "@projective/types/explore";

/**
 * `POST /api/explore/views` `{ id }` — a signed-in viewer opened a discovery item. Thin route: auth
 * guard + Zod, then {@link ExploreBackendService.recordView}, which resolves the id against the
 * published catalogue and records the view under the viewer's own token. `ViewHistory` sends it in
 * page mode — the item page a reader actually opened — and never for a guest.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to keep a viewing history." }, {
				status: 401,
			});
		}
		const raw: unknown = await ctx.req.json().catch(() => null);
		const body = RecordViewRequestSchema.safeParse(raw);
		if (!body.success) {
			return Response.json({ ok: false, message: "Name the item that was opened." }, {
				status: 422,
			});
		}
		return toExploreResponse(await ExploreBackendService.recordView({ id: body.data.id, actor }));
	},
});
