import type {
	AccessView,
	ActivityRange,
	ActivityView,
	AddMethodInput,
	DepositRuleInput,
	DistributeInput,
	FundEscrowInput,
	FundingView,
	IncomeSmootherEnrolInput,
	InvoicesView,
	MethodsView,
	PayoutScheduleInput,
	PayoutsView,
	SpendDecisionInput,
	SpendRequestInput,
	TopUpInput,
	TransactionListParams,
	TransactionPage,
	TransferInput,
	WalletActionResult,
	WalletOverview,
	WalletSwitcher,
	WithdrawInput,
} from "@projective/types/finance";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isFinanceBackendLive } from "../../core/supabase.ts";
import * as fx from "./wallet-fixtures.ts";

/**
 * WalletBackendService — the FAT half of the context-scoped Wallet & Finance surface (`/wallet` + its
 * deep pages + action modals). It owns every read projection (overview · transactions · activity ·
 * payouts · funding · methods · invoices · access · the switcher) AND every money mutation (top-up ·
 * withdraw · transfer · distribute · fund-escrow · recurring · method · payout schedule · spend
 * request/decision · Income-Smoother enrol), each returning a transport-agnostic {@link ServiceResult}.
 *
 * ALL money math — balances, the three-state projection, team splits, the 5% platform fee, FX conversion,
 * eligibility gates — lives here (or in {@link fx `wallet-fixtures`}, which it delegates to); the thin
 * `/api/wallet/*` routes parse + Zod-validate + guard + delegate, and islands never reach it (root
 * CLAUDE.md §2). The client only formats the {@link MoneyView}s the service returns.
 *
 * Gated by {@link isFinanceBackendLive} (`FINANCE_BACKEND_LIVE`, default off): until the RLS-scoped
 * `finance.*` tables + money functions are wired, reads answer from deterministic fixtures and mutations
 * mutate an in-module session store (fully exercisable, no persistence). The LIVE branch is a documented
 * placeholder that currently falls back to the same fixtures with zero shape churn — the projections are
 * already the Zod SSOT — exactly like every sibling read/write service.
 */
export class WalletBackendService {
	/** The wallet switcher (active wallet · selectable accounts · the read-only aggregate rollup). */
	static switcher(query: fx.WalletQuery): ServiceResult<{ switcher: WalletSwitcher }> {
		if (isFinanceBackendLive()) {
			// LIVE: enumerate the viewer's wallets/vaults from `finance.wallets` + memberships — not yet
			// implemented; fall back to fixtures.
		}
		return ok({ switcher: fx.switcher(query) });
	}

	/** The Overview hub projection for the query's wallet (or the aggregate). */
	static overview(query: fx.WalletQuery): ServiceResult<{ overview: WalletOverview }> {
		if (isFinanceBackendLive()) {
			// LIVE: project balances (materialised + `pending_releases` + disputed escrows) — not yet wired.
		}
		return ok({ overview: fx.overview(query) });
	}

	/** A filtered, sorted, paged page of the ledger for the Transactions table. */
	static transactions(
		query: fx.WalletQuery,
		params: TransactionListParams,
	): ServiceResult<{ page: TransactionPage }> {
		return ok({ page: fx.transactions(query, params) });
	}

	/** The Activity charts projection (in-vs-out · by-category · by-project · role-specific series). */
	static activity(
		query: fx.WalletQuery,
		range: ActivityRange,
	): ServiceResult<{ activity: ActivityView }> {
		return ok({ activity: fx.activity(query, range) });
	}

	/** The Payouts projection (schedule · destinations · Income Smoother · instant · history). */
	static payouts(query: fx.WalletQuery): ServiceResult<{ payouts: PayoutsView }> {
		return ok({ payouts: fx.payouts(query) });
	}

	/** The Funding projection (sources · recurring rules · balance). */
	static funding(query: fx.WalletQuery): ServiceResult<{ funding: FundingView }> {
		return ok({ funding: fx.funding(query) });
	}

	/** The Methods projection (cards/banks tagged spend/earn/both · defaults). */
	static methods(query: fx.WalletQuery): ServiceResult<{ methods: MethodsView }> {
		return ok({ methods: fx.methods(query) });
	}

	/** The Invoices projection (business — current statement · past statements · bills · caps). */
	static invoices(query: fx.WalletQuery): ServiceResult<{ invoices: InvoicesView }> {
		return ok({ invoices: fx.invoices(query) });
	}

	/** The Access projection (team/business — capability matrix · caps · approvals · audit). */
	static access(query: fx.WalletQuery): ServiceResult<{ access: AccessView }> {
		return ok({ access: fx.access(query) });
	}

	// #region Mutations
	static topUp(
		input: TopUpInput,
		sim?: fx.WalletSim,
	): ServiceResult<{ result: WalletActionResult }> {
		return fromOutcome(fx.topUp({ ...input, sim }));
	}

	static withdraw(
		input: WithdrawInput,
		sim?: fx.WalletSim,
	): ServiceResult<{ result: WalletActionResult }> {
		return fromOutcome(fx.withdraw({ ...input, sim }));
	}

	static transfer(
		input: TransferInput,
		sim?: fx.WalletSim,
	): ServiceResult<{ result: WalletActionResult }> {
		return fromOutcome(fx.transfer({ ...input, sim }));
	}

	static distribute(
		input: DistributeInput,
		sim?: fx.WalletSim,
	): ServiceResult<{ result: WalletActionResult }> {
		return fromOutcome(fx.distribute({ ...input, sim }));
	}

	static fundEscrow(
		input: FundEscrowInput,
		sim?: fx.WalletSim,
	): ServiceResult<{ result: WalletActionResult }> {
		return fromOutcome(fx.fundEscrow({ ...input, sim }));
	}

	static addRecurring(
		input: DepositRuleInput,
		sim?: fx.WalletSim,
	): ServiceResult<{ result: WalletActionResult }> {
		return fromOutcome(fx.addRecurring({ ...input, sim }));
	}

	static addMethod(
		input: AddMethodInput,
		sim?: fx.WalletSim,
	): ServiceResult<{ result: WalletActionResult }> {
		return fromOutcome(fx.addMethod({ ...input, sim }));
	}

	static setPayout(
		input: PayoutScheduleInput,
		sim?: fx.WalletSim,
	): ServiceResult<{ result: WalletActionResult }> {
		return fromOutcome(fx.setPayout({ ...input, sim }));
	}

	static requestSpend(
		input: SpendRequestInput,
		sim?: fx.WalletSim,
	): ServiceResult<{ result: WalletActionResult }> {
		return fromOutcome(fx.requestSpend({ ...input, sim }));
	}

	static decideSpend(
		input: SpendDecisionInput,
		sim?: fx.WalletSim,
	): ServiceResult<{ result: WalletActionResult }> {
		return fromOutcome(fx.decideSpend({ ...input, sim }));
	}

	static enrolSmoother(
		input: IncomeSmootherEnrolInput,
		sim?: fx.WalletSim,
	): ServiceResult<{ result: WalletActionResult }> {
		return fromOutcome(fx.enrolSmoother({ ...input, sim }));
	}
	// #endregion
}

/** Fold a fixtures {@link fx.MutationOutcome} into a {@link ServiceResult}. */
function fromOutcome(out: fx.MutationOutcome): ServiceResult<{ result: WalletActionResult }> {
	if (!out.ok || !out.overview) return fail(out.status ?? 422, { message: out.message });
	return ok({ result: { overview: out.overview, message: out.message } }, { message: out.message });
}
