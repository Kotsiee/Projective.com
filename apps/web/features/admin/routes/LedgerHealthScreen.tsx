import { HttpError, page } from "fresh";
import type { LedgerSectionId } from "@projective/types/finance";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import type { ReadActor } from "@server/services/read-actor.ts";
import type { ServiceResult } from "@server/services/ServiceResult.ts";
import { LedgerHealthService } from "@server/services/finance/LedgerHealthService.ts";
import type { LedgerSectionResult } from "../core/ledger-health.ts";
import LedgerHealth from "../islands/LedgerHealth.island.tsx";

/**
 * The page's sections, in order, each one `LedgerHealthService` read (FBP DB16). MR3, MR4, MR5 and
 * MR8b each add their section here and its read to the service.
 */
const SECTIONS: ReadonlyArray<
	{ id: LedgerSectionId; read: (actor: ReadActor) => Promise<ServiceResult<unknown>> }
> = [
	{ id: "conservation", read: LedgerHealthService.conservation },
	{ id: "drift", read: LedgerHealthService.drift },
	{ id: "escrow_age", read: LedgerHealthService.escrowAge },
];

/** A refusal or a missing database: there is no ledger page here for this caller. */
const NO_PAGE = new Set([401, 403, 404, 503]);

/**
 * `/admin/ledger` — the operator's read-only ledger health page (FBP DB16; Decision #337, ruling M2
 * (A)), re-exported by `routes/(dashboard)/admin/ledger.tsx`. Thin controller: every section's read
 * IS the gate — `finance.get_ledger_health()` and `finance.read_escrow_age()` refuse anyone but a
 * platform operator (`security.is_admin()`, `ops.admin_users`), and that refusal is a 404 here, as on
 * `/admin/disputes` (Decision #212), so a non-operator never learns the page exists. The page renders
 * only once a read has answered, which proves the caller an operator; a section whose read failed
 * for any other reason then says so in place, and when none answered the page is a 502.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = readActor(ctx);
		const results = await Promise.all(SECTIONS.map((section) => section.read(actor)));
		if (results.some((res) => !res.ok && NO_PAGE.has(res.status))) throw new HttpError(404);
		// Only a read that answered proves the caller an operator: with none, there is nothing to show.
		if (!results.some((res) => res.ok)) throw new HttpError(502);
		const sections = SECTIONS.map((section, i): LedgerSectionResult => {
			const res = results[i];
			return res.ok && res.data !== undefined
				? { id: section.id, ok: true, data: res.data } as LedgerSectionResult
				: {
					id: section.id,
					ok: false,
					message: res.message ?? "This section couldn't be read just now.",
				};
		});
		ctx.state.title = "Ledger · Projective";
		return page({ sections });
	},
});

export default define.page<typeof handler>(function LedgerHealthScreen({ data }) {
	return <LedgerHealth sections={data.sections} />;
});
