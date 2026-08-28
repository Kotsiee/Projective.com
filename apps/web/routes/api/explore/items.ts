import { define } from "@web/utils/state.ts";
import { toExploreResponse } from "@features/explore/core/respond.ts";
import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";

/**
 * Ceiling on one batch. Generous against the ~12 references the Continue rail actually stores, so a
 * legitimate caller never trips it, while a hand-edited query string cannot turn one request into an
 * unbounded corpus scan.
 */
const MAX_IDS = 24;

/**
 * `GET /api/explore/items?ids=a,b,c` — thin route: resolve a batch of discovery items by id via the
 * fat service, preserving the caller's id order. Backs the Home "Continue where you left off" rail,
 * which holds a list of stored references and would otherwise need one `/api/explore/item` request
 * each.
 *
 * Unlike the single-item route this does not 404 on a miss — a stale reference is expected here and
 * the service omits it — so the only failures are malformed requests.
 */
export const handler = define.handlers({
	GET(ctx) {
		const raw = ctx.url.searchParams.get("ids");
		const ids = (raw ?? "").split(",").map((id) => id.trim()).filter(Boolean);
		if (ids.length === 0) {
			return Response.json({ ok: false, message: "Missing item ids." }, { status: 400 });
		}
		if (ids.length > MAX_IDS) {
			return Response.json(
				{ ok: false, message: `Too many ids — ${MAX_IDS} maximum.` },
				{ status: 400 },
			);
		}
		return toExploreResponse(ExploreBackendService.items(ids));
	},
});
