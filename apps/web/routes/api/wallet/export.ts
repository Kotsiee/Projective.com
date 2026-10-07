import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { readActor } from "@web/utils/api-session.ts";
import { TransactionListParamsSchema } from "@projective/types/finance";
import { toFieldErrors, toWalletResponse } from "@features/wallet/core/respond.ts";
import { ledgerApiParamsFrom, walletQueryFrom } from "@features/wallet/core/wallet-model.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";

/**
 * `GET /api/wallet/export?w=&…filters…` — the Transactions page's Download CSV: the ledger the page is
 * showing (its search, direction, line families and window), read as the signed-in viewer.
 *
 * Only a success is a file. A refusal answers in the wallet's JSON shape with its status — the page
 * fetches the export and shows that message in an alert, rather than handing the browser an error
 * sentence to save as `export.csv`.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const sp = ctx.url.searchParams;
		const parsed = TransactionListParamsSchema.safeParse({
			...ledgerApiParamsFrom(sp),
			cursor: null,
		});
		if (!parsed.success) {
			return Response.json({
				ok: false,
				message: "Those filters couldn't be read.",
				errors: toFieldErrors(parsed.error),
			}, { status: 400 });
		}
		const res = await WalletBackendService.exportLedger(
			walletQueryFrom(sp, context),
			parsed.data,
			readActor(ctx),
		);
		if (!res.ok || !res.data) {
			return toWalletResponse({
				...res,
				message: res.message ?? "The ledger couldn't be exported just now.",
			});
		}
		return new Response(res.data.csv, {
			headers: {
				"content-type": "text/csv; charset=utf-8",
				"content-disposition": `attachment; filename="${res.data.filename}"`,
				"cache-control": "no-store",
			},
		});
	},
});
