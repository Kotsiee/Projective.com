import { HttpError, page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { DisputeBackendService } from "@server/services/finance/DisputeBackendService.ts";
import { operatorDeskOverride } from "../core/operator-preview.ts";
import { previewQueue } from "../core/dispute-desk.ts";
import DisputeDesk from "../islands/DisputeDesk.island.tsx";

/**
 * `/admin/disputes` — the operator dispute desk (Decision #212), re-exported by
 * `routes/(dashboard)/admin/disputes.tsx`. Thin controller: the queue read IS the gate —
 * `finance.list_disputes_for_review` refuses anyone but a platform operator (`security.is_admin()`,
 * `ops.admin_users`), and that refusal is a 404 here, so a non-operator never learns the desk exists
 * and never receives a ruling control. A case opens in a dialog over the queue — no case is ever
 * addressed by a URL (Decision #88: a uuid does not route). In development the Dev Context Switcher's
 * `operatorDesk` axis (`pj.dev.operator`) renders sample cases instead; it grants nothing.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const preview = operatorDeskOverride(ctx.req);
		if (preview) {
			ctx.state.title = "Disputes (preview) · Projective";
			return page({ queue: previewQueue(preview, Date.now()), preview: true });
		}
		const res = await DisputeBackendService.queue({}, readActor(ctx));
		if (res.ok && res.data) {
			ctx.state.title = "Disputes · Projective";
			return page({ queue: res.data, preview: false });
		}
		// Not an operator (403), no session (401), or no live database (503): there is no desk here.
		if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 503) {
			throw new HttpError(404);
		}
		throw new HttpError(502);
	},
});

export default define.page<typeof handler>(function DisputeDeskScreen({ data }) {
	return <DisputeDesk initial={data.queue} preview={data.preview} />;
});
