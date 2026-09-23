import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { readActor } from "@web/utils/api-session.ts";
import { walletQueryFrom } from "@features/wallet/core/wallet-model.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";

/**
 * `GET /api/wallet/export?w=` — the footer rig's Export control: the active wallet's ledger as a CSV
 * download, read as the signed-in viewer. The control is a plain link, so a refusal answers in plain
 * text rather than JSON — it is what the browser shows the person who pressed it.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const res = await WalletBackendService.exportLedger(walletQueryFrom(ctx.url.searchParams, context), readActor(ctx));
		if (!res.ok || !res.data) {
			return new Response(res.message ?? "The ledger couldn't be exported just now.", {
				status: res.status,
				headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
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
