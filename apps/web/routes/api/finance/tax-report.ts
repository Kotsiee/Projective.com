import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { TaxReportYearSchema } from "@projective/types/finance";
import {
	sellerTaxReportCsv,
	TaxReportingService,
} from "@server/services/finance/TaxReportingService.ts";

/** A refusal, no session or no live database: there is no report here for this caller. */
const NO_REPORT = new Set([401, 403, 404, 503]);

/**
 * `GET /api/finance/tax-report?year=YYYY` — the operator's seller tax-reporting export as CSV (LEGAL
 * LG6, Decision #527): per seller, currency and calendar quarter, what the ledger credited them, the
 * fees attributed and the activities paid. `finance.read_seller_tax_report` is the gate: it refuses
 * anyone but `security.is_admin()`, and that refusal is a 404 here, as on `/admin/ledger`
 * (Decision #212), so a member never learns the export exists. Filing is a person's job.
 */
export const handler = define.handlers({
	async GET(ctx) {
		// A year that is not one still goes to the door, which refuses a non-operator before it reads the
		// year: a member gets the same 404 whatever they send.
		const parsed = TaxReportYearSchema.safeParse(ctx.url.searchParams.get("year") ?? undefined);
		const res = await TaxReportingService.sellerTaxReport(readActor(ctx), parsed.success ? parsed.data : null);
		if (!res.ok || !res.data) {
			if (NO_REPORT.has(res.status)) {
				return Response.json({ ok: false, message: "Not found." }, { status: 404 });
			}
			return Response.json({ ok: false, message: res.message ?? "The report couldn't be read." }, {
				status: res.status,
			});
		}
		return new Response(sellerTaxReportCsv(res.data), {
			headers: {
				"content-type": "text/csv; charset=utf-8",
				"content-disposition": `attachment; filename="seller-tax-report-${res.data.year}.csv"`,
				"cache-control": "no-store",
			},
		});
	},
});
