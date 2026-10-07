import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { attentionFactsFor } from "../core/settings-ssr.ts";
import SettingsHome from "../islands/SettingsHome.island.tsx";

/**
 * `/settings` — the console root (Decision #150), re-exported by `routes/(dashboard)/settings/index.tsx`:
 * the attention dashboard, and the drill-down menu on a phone.
 *
 * Thin controller: read the attention FACTS (memoised on the request, so the lane's marks reuse the
 * same read) and hand them to the island. A connector consent that returns here with `?connect=`
 * (the integrations callback's fallback target) is forwarded to the Integrations console, which is
 * the page that reads it.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const connect = ctx.url.searchParams.get("connect");
		if (connect) {
			const next = new URLSearchParams({ connect });
			return new Response(null, {
				status: 303,
				headers: { location: `/settings/integrations?${next}` },
			});
		}
		const facts = await attentionFactsFor(ctx.state, readActor(ctx));
		ctx.state.title = "Settings · Projective";
		return page({ facts, context: asAuthenticatedContext(ctx.state.userContext) });
	},
});

export default define.page<typeof handler>(function SettingsHomePage({ data }) {
	return <SettingsHome context={data.context} facts={data.facts} />;
});
