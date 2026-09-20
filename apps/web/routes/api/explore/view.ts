import { define } from "@web/utils/state.ts";
import { toExploreResponse } from "@features/explore/core/respond.ts";
import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";

/**
 * `GET /api/explore/view?id=…` — thin route: the composed Entity View projection for one listing
 * (the item plus its gallery, deliverables, stage showcase, seller line, intake and reviews) via the
 * fat {@link ExploreBackendService.viewPage}; 404 when unknown.
 *
 * It is the read the profile's service modal opens on: the modal's preview column renders the SAME
 * projection `/view/[id]` SSRs, through the same parts, so what a buyer sees in the modal and what
 * they would see on the full page cannot disagree. Guest-reachable, like the page it mirrors.
 */
export const handler = define.handlers({
	GET(ctx) {
		const id = ctx.url.searchParams.get("id");
		if (!id) {
			return Response.json({ ok: false, message: "Missing item id." }, { status: 400 });
		}
		return toExploreResponse(ExploreBackendService.viewPage(id));
	},
});
