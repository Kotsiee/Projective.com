import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { attentionFactsFor } from "@features/settings/core/settings-ssr.ts";

/**
 * `GET /api/settings/attention` — the attention FACTS (`{ ok, facts }`) for the contextual modal's
 * section marks. The console reads the same facts server-side for its lane; the modal opens over any
 * page, so it asks here. Facts, never items: the pure rule (`attentionItems`) runs where they land.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to see your settings." }, {
				status: 401,
			});
		}
		const facts = await attentionFactsFor(ctx.state, actor);
		return Response.json({ ok: true, facts }, { headers: { "cache-control": "no-store" } });
	},
});
