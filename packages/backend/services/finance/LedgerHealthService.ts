import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getUserClient, isFinanceBackendLive } from "../../core/supabase.ts";
import type {
	ConservationCurrency,
	ConservationNight,
	ConversionDrift,
	EscrowAge,
	LedgerConservation,
	LedgerDrift,
	LedgerHealth,
	WalletDrift,
} from "@projective/types/finance";
import type { AlertsRead } from "@projective/types/ops";
import type { ReadActor } from "../read-actor.ts";
import { readEscrowAge } from "./escrow-age.ts";
import { readAlerts } from "../ops/OpsAlertService.ts";

/**
 * LedgerHealthService — the reads behind `/admin/ledger`, one per section (FBP DB16; Decision #337,
 * ruling M2 (A)). Conservation and Wallet drift come from the operator door `finance.get_ledger_health()`
 * (00001200), Escrow age from `finance.read_escrow_age()` (MR7, Decision #473), Alerts from
 * `ops.read_alert_deliveries()` (MR4, Decision #461). Each door is the gate: it
 * refuses anyone but a platform operator (`security.is_admin()`) with 42501, which maps to 403 and the
 * page answers with a 404, as `/admin/disputes` does (Decision #212). Nothing here decides or moves
 * money; the database computes every figure. MR3, MR5 and MR8b each add one read for their section.
 */

// #region Raw rows (the SQL jsonb, as written by the function)
/** One currency of `finance.v_conservation_identity`, as `to_jsonb` writes it. */
interface RawCurrency {
	currency: string;
	in_cash_minor: number;
	in_on_account_minor: number;
	in_fx_minor: number;
	out_payouts_minor: number;
	out_card_refunds_minor: number;
	out_chargebacks_minor: number;
	out_invoices_minor: number;
	out_fx_minor: number;
	held_wallets_minor: number;
	held_escrows_minor: number;
	held_pending_minor: number;
	fees_escrows_minor: number;
	fees_orders_minor: number;
	fees_fx_minor: number;
	losses_chargebacks_minor: number;
	losses_card_refunds_minor: number;
	external_minor: number;
	accounted_minor: number;
	imbalance_minor: number;
}

interface RawNight {
	run_id: string | null;
	checked_at: string;
	currency: string | null;
	balanced: boolean;
	external_minor: number | null;
	accounted_minor: number | null;
	imbalance_minor: number | null;
}

interface RawWalletDrift {
	wallet_id: string;
	owner_type: string;
	currency: string;
	balance_minor: number;
	ledger_sum_minor: number;
	latest_balance_after_minor: number | null;
	earmarked_minor: number;
	pot_drift_minor: number;
}

interface RawConversionDrift {
	conversion_id: string | null;
	escrow_id: string | null;
	kind: string;
	problem: string;
	expected_minor: number;
	ledger_minor: number;
}

/** `finance.get_ledger_health()`'s answer. */
export interface RawLedgerHealth {
	as_of: string;
	currencies: RawCurrency[] | null;
	nights: RawNight[] | null;
	drift: {
		wallets: RawWalletDrift[] | null;
		conversions: RawConversionDrift[] | null;
		logged_30d: number | null;
		last_logged_at: string | null;
	} | null;
}
// #endregion

// #region Mapping
function toCurrency(raw: RawCurrency): ConservationCurrency {
	return {
		currency: raw.currency,
		inCashMinor: raw.in_cash_minor,
		inOnAccountMinor: raw.in_on_account_minor,
		inFxMinor: raw.in_fx_minor,
		outPayoutsMinor: raw.out_payouts_minor,
		outCardRefundsMinor: raw.out_card_refunds_minor,
		outChargebacksMinor: raw.out_chargebacks_minor,
		outInvoicesMinor: raw.out_invoices_minor,
		outFxMinor: raw.out_fx_minor,
		heldWalletsMinor: raw.held_wallets_minor,
		heldEscrowsMinor: raw.held_escrows_minor,
		heldPendingMinor: raw.held_pending_minor,
		feesEscrowsMinor: raw.fees_escrows_minor,
		feesOrdersMinor: raw.fees_orders_minor,
		feesFxMinor: raw.fees_fx_minor,
		lossesChargebacksMinor: raw.losses_chargebacks_minor,
		lossesCardRefundsMinor: raw.losses_card_refunds_minor,
		externalMinor: raw.external_minor,
		accountedMinor: raw.accounted_minor,
		imbalanceMinor: raw.imbalance_minor,
	};
}

/** A logged night missing its figures (a hand-written row) is dropped rather than shown as zero. */
function toNight(raw: RawNight): ConservationNight | null {
	if (
		raw.run_id === null || raw.currency === null || raw.external_minor === null ||
		raw.accounted_minor === null || raw.imbalance_minor === null
	) return null;
	return {
		runId: raw.run_id,
		checkedAt: raw.checked_at,
		currency: raw.currency,
		balanced: raw.balanced,
		externalMinor: raw.external_minor,
		accountedMinor: raw.accounted_minor,
		imbalanceMinor: raw.imbalance_minor,
	};
}

function toWalletDrift(raw: RawWalletDrift): WalletDrift {
	return {
		walletId: raw.wallet_id,
		ownerType: raw.owner_type,
		currency: raw.currency,
		balanceMinor: raw.balance_minor,
		ledgerSumMinor: raw.ledger_sum_minor,
		latestBalanceAfterMinor: raw.latest_balance_after_minor,
		earmarkedMinor: raw.earmarked_minor,
		potDriftMinor: raw.pot_drift_minor,
	};
}

function toConversionDrift(raw: RawConversionDrift): ConversionDrift {
	return {
		conversionId: raw.conversion_id,
		escrowId: raw.escrow_id,
		kind: raw.kind,
		problem: raw.problem,
		expectedMinor: raw.expected_minor,
		ledgerMinor: raw.ledger_minor,
	};
}

/**
 * The jsonb onto {@link LedgerHealth}, order kept (currencies A–Z, nights newest first, drift by
 * currency). Pure; pinned by `LedgerHealthService.test.ts`.
 */
export function toLedgerHealth(raw: RawLedgerHealth | null): LedgerHealth {
	const asOf = raw?.as_of ?? new Date(0).toISOString();
	return {
		conservation: {
			asOf,
			currencies: (raw?.currencies ?? []).map(toCurrency),
			nights: (raw?.nights ?? []).map(toNight).filter((night): night is ConservationNight =>
				night !== null
			),
		},
		drift: {
			asOf,
			wallets: (raw?.drift?.wallets ?? []).map(toWalletDrift),
			conversions: (raw?.drift?.conversions ?? []).map(toConversionDrift),
			logged30d: raw?.drift?.logged_30d ?? 0,
			lastLoggedAt: raw?.drift?.last_logged_at ?? null,
		},
	};
}
// #endregion

// #region The reads
/**
 * `finance.get_ledger_health()` for an operator. 403 for anyone else (the definer's 42501), 401 with no
 * session, 503 without the live database or when it cannot be reached. Never throws into the route.
 */
async function readLedgerHealth(actor: ReadActor): Promise<ServiceResult<LedgerHealth>> {
	if (!isFinanceBackendLive()) {
		return fail(503, { message: "Ledger health needs the live database." });
	}
	if (!actor.accessToken) return fail(401, { message: "Sign in to continue." });
	try {
		const { data, error } = await getUserClient(actor.accessToken).schema("finance").rpc(
			"get_ledger_health",
		);
		if (error) {
			if (error.code === "42501") return fail(403, { message: error.message });
			return fail(502, { message: "That couldn't be read just now. Please try again." });
		}
		return ok(toLedgerHealth(data as RawLedgerHealth | null));
	} catch (error) {
		console.error("[ledger:health]", error instanceof Error ? error.message : error);
		return fail(503, { message: "We couldn't reach the ledger just now. Try again in a moment." });
	}
}

/** Narrow a whole-health result to one of its sections, keeping a refusal as it is. */
async function sectionOf<K extends keyof LedgerHealth>(
	actor: ReadActor,
	key: K,
): Promise<ServiceResult<LedgerHealth[K]>> {
	const res = await readLedgerHealth(actor);
	if (!res.ok || !res.data) return res as unknown as ServiceResult<LedgerHealth[K]>;
	return ok(res.data[key]);
}

/** The `/admin/ledger` reads, one per section. */
export const LedgerHealthService = {
	/** Conservation: the identity per currency now, and the last 30 nights' checks. */
	conservation(actor: ReadActor): Promise<ServiceResult<LedgerConservation>> {
		return sectionOf(actor, "conservation");
	},
	/** Wallet drift: the wallets and conversions out of step with their ledger now. */
	drift(actor: ReadActor): Promise<ServiceResult<LedgerDrift>> {
		return sectionOf(actor, "drift");
	},
	/** Escrow age: how long held money has sat in the platform balance (MR7, Decision #473). */
	escrowAge(actor: ReadActor): Promise<ServiceResult<EscrowAge>> {
		return readEscrowAge(actor);
	},
	/** Alerts: what the alert sweep raised and sent, and when each dead-man scope last wrote (MR4). */
	alerts(actor: ReadActor): Promise<ServiceResult<AlertsRead>> {
		return readAlerts(actor);
	},
};
// #endregion
