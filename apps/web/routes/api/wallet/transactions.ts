import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import {
	FundState,
	TransactionDirection,
	TransactionListParamsSchema,
	TxnCategory,
	TxnSort,
} from "@projective/types/finance";
import { toWalletResponse } from "@features/wallet/core/respond.ts";
import { walletQueryFrom } from "@features/wallet/core/wallet-model.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";
import type { TransactionListParams } from "@projective/types/finance";

/**
 * `GET /api/wallet/transactions?…filters…` — thin route: parse the ledger filters (search · direction ·
 * fund state · category · project · date range · sort · paging), Zod-coerce them, then delegate to the
 * fat {@link WalletBackendService.transactions}. Islands never reach the backend — they fetch this via
 * the dumb `WalletService`.
 */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const sp = ctx.url.searchParams;
		const limitRaw = sp.get("limit");
		const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

		const candidate: TransactionListParams = {
			search: sp.get("search") || undefined,
			direction: TransactionDirection.safeParse(sp.get("direction")).success
				? (sp.get("direction") as TransactionListParams["direction"])
				: undefined,
			fundState: FundState.safeParse(sp.get("fundState")).success
				? (sp.get("fundState") as TransactionListParams["fundState"])
				: undefined,
			category: TxnCategory.safeParse(sp.get("category")).success
				? (sp.get("category") as TransactionListParams["category"])
				: undefined,
			project: sp.get("project") || undefined,
			from: sp.get("from") || undefined,
			to: sp.get("to") || undefined,
			sort: TxnSort.safeParse(sp.get("sort")).success
				? (sp.get("sort") as TransactionListParams["sort"])
				: undefined,
			dir: sp.get("dir") === "asc" || sp.get("dir") === "desc"
				? (sp.get("dir") as "asc" | "desc")
				: undefined,
			cursor: sp.get("cursor") || null,
			limit: Number.isFinite(limit) ? limit : undefined,
		};
		const parsed = TransactionListParamsSchema.safeParse(candidate);
		const params = parsed.success ? parsed.data : { limit: 40 };

		return toWalletResponse(
			WalletBackendService.transactions(walletQueryFrom(sp, context), params),
		);
	},
});
