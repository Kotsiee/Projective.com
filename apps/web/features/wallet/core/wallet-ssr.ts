import type { UserContext } from "@projective/types/auth";
import { toDisplayCurrency } from "@projective/types/finance";
import type { ReadActor } from "@server/services/read-actor.ts";
import type { ServiceResult } from "@server/services/ServiceResult.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";
import {
	type FlowPeriod,
	periodRange,
	toFlowPeriod,
	walletParam,
	walletQueryFrom,
} from "./wallet-model.ts";
import type {
	ActivityView,
	FundingView,
	MethodsView,
	PayoutsView,
	SpendApprovalView,
	TransactionPage,
	WalletOverview,
	WalletSwitcher,
} from "../types/wallet-types.ts";

/** A read's projection, or the reason it could not be produced. */
export type WalletRead<T> = { ok: true; data: T } | { ok: false; message: string };

/** Ledger lines fetched per page. */
export const LEDGER_PAGE = 20;

/**
 * Everything the command centre paints in its first byte. The overview is required; each other part
 * is its own read that can fail alone, and is `null` where it does not apply (the read-only rollup
 * has no methods, payouts or funding; only a vault has spend approvals).
 */
export interface WalletHomeData {
	overview: WalletOverview;
	switcher: WalletSwitcher;
	ledger: WalletRead<TransactionPage>;
	activity: WalletRead<ActivityView>;
	period: FlowPeriod;
	funding: WalletRead<FundingView> | null;
	payouts: WalletRead<PayoutsView> | null;
	methods: WalletRead<MethodsView> | null;
	approvals: WalletRead<SpendApprovalView[]> | null;
	/** The `?w=` param of the wallet the server resolved. */
	wallet: string;
	/** The currency the figures were drawn in. */
	display: string;
}

const FALLBACK = "We couldn't reach your wallet just now. Try again in a moment.";

function toRead<T, U>(res: ServiceResult<T>, pick: (data: T) => U): WalletRead<U> {
	if (res.ok && res.data) return { ok: true, data: pick(res.data) };
	return { ok: false, message: res.message ?? FALLBACK };
}

function vaultScope(param: string | null | undefined): boolean {
	return !!param && /^(team|business|organisation):/.test(param);
}

/**
 * Resolves the command centre's first paint as the signed-in viewer, running every read in parallel.
 * Fails as a whole only when the overview itself cannot be read.
 */
export async function resolveWalletHome(
	context: UserContext,
	url: URL,
	actor: ReadActor,
): Promise<WalletRead<WalletHomeData>> {
	const query = walletQueryFrom(url.searchParams, context);
	const period = toFlowPeriod(url.searchParams.get("flow"));
	const aggregate = query.wallet === "aggregate";
	const vault = vaultScope(query.wallet);

	const [main, ledger, activity, funding, payouts, methods, access] = await Promise.all([
		WalletBackendService.overviewWithSwitcher(query, actor),
		WalletBackendService.transactions(query, { limit: LEDGER_PAGE }, actor),
		WalletBackendService.activity(query, periodRange(period), actor),
		aggregate ? null : WalletBackendService.funding(query, actor),
		aggregate ? null : WalletBackendService.payouts(query, actor),
		aggregate ? null : WalletBackendService.methods(query, actor),
		vault ? WalletBackendService.access(query, actor) : null,
	]);

	if (!main.ok || !main.data) return { ok: false, message: main.message ?? FALLBACK };
	const { overview, switcher } = main.data;
	const active = switcher.active;

	return {
		ok: true,
		data: {
			overview,
			switcher,
			ledger: toRead(ledger, (d) => d.page),
			activity: toRead(activity, (d) => d.activity),
			period,
			funding: funding ? toRead(funding, (d) => d.funding) : null,
			payouts: payouts ? toRead(payouts, (d) => d.payouts) : null,
			methods: methods ? toRead(methods, (d) => d.methods) : null,
			approvals: access && active.scope !== "personal"
				? toRead(access, (d) => d.access.approvals)
				: null,
			wallet: walletParam(active.scope, active.id),
			display: active.available.currency ||
				toDisplayCurrency(query.display ?? context.displayCurrency),
		},
	};
}
