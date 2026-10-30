/**
 * The finance row schemas against the tables that store them (FINANCE_AUDIT Z1/Z2, SV1).
 *
 * Every `finance.*` table in `00000017_tables_finance.sql` either has a row schema here, compared
 * column for key, or is named in {@link PROJECTION_ONLY} with the reason it has none. A new column
 * with no Zod key, a Zod key with no column, and a new table in neither list each fail.
 */
import { assertEquals } from "@std/assert";
import type { z } from "zod";
import { columnDrift, readRepoFile, tableColumns } from "../core/table-contract.ts";
import {
	ChargebackSchema,
	IdempotencyKeySchema,
	InvoiceLineItemSchema,
	InvoiceSchema,
	StatementSchema,
} from "./billing.ts";
import {
	AllowanceLedgerEntrySchema,
	AllowancePeriodSchema,
	EntitlementGrantSchema,
	PlanEntitlementSchema,
} from "./entitlements.ts";
import {
	ContributionAgreementSchema,
	EscrowSchema,
	FxRateSchema,
	PayoutSplitSchema,
	PendingReleaseSchema,
	TransactionSchema,
	WalletSchema,
} from "./ledger.ts";
import {
	DepositRuleSchema,
	IncomeSmoothingSchema,
	PaymentMethodSchema,
	PayoutScheduleSchema,
	WalletPotSchema,
} from "./methods.ts";
import { InboundPaymentSchema, PayoutAccountSchema, PayoutSchema } from "./payments.ts";
import {
	NegotiatedRateSchema,
	PlanSchema,
	StandingCommissionTierSchema,
	SubscriptionEventSchema,
	SubscriptionSchema,
} from "./plans.ts";
import {
	LedgerAuditSchema,
	SpendApprovalSchema,
	SpendingLimitSchema,
	SplitRuleSchema,
	VaultPermissionSchema,
} from "./vault.ts";
import { VerificationCaseSchema } from "./verification.ts";

const SQL = readRepoFile("supabase/migrations/00000017_tables_finance.sql");

interface RowContract {
	schema: z.ZodObject;
	derived?: readonly string[];
	rename?: Readonly<Record<string, string>>;
	omitted?: readonly string[];
}

/** Each finance table with a row schema. Allowlist entries say why the two sides differ. */
const ROWS: Readonly<Record<string, RowContract>> = {
	"finance.wallets": { schema: WalletSchema },
	"finance.transactions": { schema: TransactionSchema },
	"finance.escrows": { schema: EscrowSchema },
	"finance.payout_accounts": { schema: PayoutAccountSchema },
	"finance.invoices": { schema: InvoiceSchema },
	"finance.plans": { schema: PlanSchema },
	"finance.subscriptions": { schema: SubscriptionSchema },
	"finance.spending_limits": { schema: SpendingLimitSchema },
	"finance.invoice_line_items": { schema: InvoiceLineItemSchema },
	"finance.contribution_agreements": { schema: ContributionAgreementSchema },
	"finance.payout_splits": { schema: PayoutSplitSchema },
	"finance.fx_rates": { schema: FxRateSchema },
	"finance.verification_cases": { schema: VerificationCaseSchema },
	// The column is spelled `last4`, not `last_4`.
	"finance.payment_methods": { schema: PaymentMethodSchema, rename: { last4: "last4" } },
	// `created_by` gains its key with the deposit-rule authority work (FINANCE_COMPLETENESS_AUDIT A13),
	// which also adds `archived_at` to the table and the schema together.
	"finance.deposit_rules": { schema: DepositRuleSchema, omitted: ["created_by"] },
	"finance.payout_schedules": { schema: PayoutScheduleSchema },
	"finance.income_smoothing": { schema: IncomeSmoothingSchema },
	"finance.wallet_pots": { schema: WalletPotSchema },
	"finance.vault_permissions": { schema: VaultPermissionSchema },
	"finance.split_rules": { schema: SplitRuleSchema },
	"finance.spend_approvals": { schema: SpendApprovalSchema },
	"finance.ledger_audit": { schema: LedgerAuditSchema },
	"finance.payouts": { schema: PayoutSchema },
	"finance.statements": { schema: StatementSchema },
	"finance.chargebacks": { schema: ChargebackSchema },
	"finance.idempotency_keys": { schema: IdempotencyKeySchema },
	"finance.plan_entitlements": { schema: PlanEntitlementSchema },
	"finance.subscription_events": { schema: SubscriptionEventSchema },
	"finance.entitlement_grants": { schema: EntitlementGrantSchema },
	"finance.standing_commission_tiers": { schema: StandingCommissionTierSchema },
	"finance.negotiated_rates": { schema: NegotiatedRateSchema },
	"finance.allowance_periods": { schema: AllowancePeriodSchema },
	"finance.allowance_ledger": { schema: AllowanceLedgerEntrySchema },
	"finance.pending_releases": { schema: PendingReleaseSchema },
	"finance.inbound_payments": { schema: InboundPaymentSchema },
};

/**
 * The finance tables with no row schema: each is read through a definer RPC whose payload is a
 * projection (`disputes.ts`, `basket.ts`, `buyer.ts`, `order.ts`, `payments.ts`), so there is no
 * row shape crossing the boundary to mirror.
 */
const PROJECTION_ONLY: readonly string[] = [
	"finance.disputes",
	"finance.dispute_messages",
	"finance.dispute_evidence",
	"finance.ratings",
	"finance.promo_codes",
	"finance.baskets",
	"finance.basket_items",
	"finance.saved_cards",
	"finance.orders",
	"finance.order_lines",
	"finance.buyer_details",
	"finance.processor_customers",
];

Deno.test("every finance table has a row schema or is named as projection-only", () => {
	const declared = [...SQL.matchAll(/^CREATE TABLE (finance\.[a-z_]+)/gm)].map((m) => m[1]).sort();
	assertEquals(declared, [...Object.keys(ROWS), ...PROJECTION_ONLY].sort());
});

for (const [table, contract] of Object.entries(ROWS)) {
	Deno.test(`${table} ⇄ its row schema: zero drift`, () => {
		const drift = columnDrift(
			tableColumns(SQL, table),
			Object.keys(contract.schema.shape),
			contract,
		);
		assertEquals(drift, { missingKeys: [], extraKeys: [], staleAllowlist: [] });
	});
}
