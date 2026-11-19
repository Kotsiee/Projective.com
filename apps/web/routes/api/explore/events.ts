import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { isAutomatedAgent } from "@web/utils/automated-agent.ts";
import { DiscoveryEventBatchSchema } from "@projective/types/explore";
import { InterestBackendService } from "@server/services/search/InterestBackendService.ts";

/**
 * `POST /api/explore/events` — thin route: parse + Zod-validate a discovery-telemetry batch beaconed
 * by the `ImpressionTracker` island or a listing page's `ListingViewBeacon`, resolve the acting reader
 * from the session cookie (a beacon carries same-origin cookies), and delegate to the fat
 * {@link InterestBackendService}. Guest-reachable: most discovery traffic is signed out. A crawler,
 * headless browser or scripted client ({@link isAutomatedAgent}) is answered `202` with nothing
 * stored, so it never counts as an impression or a view.
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (isAutomatedAgent(ctx.req.headers.get("user-agent"))) {
			return Response.json({ ok: true, accepted: 0 }, { status: 202 });
		}
		const body = await ctx.req.json().catch(() => null);
		const parsed = DiscoveryEventBatchSchema.safeParse(body);
		if (!parsed.success) {
			return Response.json({ ok: false }, { status: 422 });
		}
		const result = await InterestBackendService.record(parsed.data, readActor(ctx));
		return Response.json(
			{ ok: result.ok, accepted: result.data?.accepted ?? 0 },
			{ status: result.status },
		);
	},
});
