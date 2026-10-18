import type {
	BillingContext,
	BuyerDetails,
	CheckoutBusinessAccount,
	CheckoutSpendRequest,
	MoneyView,
	MonthlyInvoicing,
	PostalAddress,
	ProcessingContributionOffer,
	SaveBuyerDetails,
	SpendGateReason,
	SpendLimitBlock,
} from "@projective/types/finance";
import {
	buyerDetailsComplete,
	DEFAULT_LOCALE,
	destinationEmail,
	EMPTY_ADDRESS,
	formatMoney,
} from "@projective/types/finance";
import { evaluateSpend } from "@projective/types/workspace";
import { isPlanGateRefusal, planGateHeaders, planGateRefusal } from "../../core/plan-gate.ts";
import { getUserClient } from "../../core/supabase.ts";
import { fetchPartyCards } from "../profile/party-cards.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import type { MoneyProjector } from "./commerce-money.ts";
import type { ResolvedOwner } from "./commerce-owner.ts";

/**
 * live-buyer — the checkout's Details step and account gates, read and written as the signed-in
 * caller: the buyer's saved delivery + billing record (`finance.buyer_details`), the identities they
 * may bill through, the account's invoicing terms, and how the acting member's spending limit bears on
 * a basket.
 *
 * **One record per paying account.** `finance.buyer_details` is keyed `(owner_type, owner_id,
 * context_id)`; the checkout keeps ONE record for the account whose money is spent, under that
 * account's own scope key, holding both a personal and a business billing block. Which identity an
 * invoice is finally made out to is chosen when the order is placed.
 *
 * **Nothing is invented.** A record the buyer has never saved is pre-filled from what the platform
 * already knows about them — their name and primary email, their company's registered details — and
 * carries `savedAt: null`, which `buyerDetailsComplete` refuses: a pre-fill can only ever send a buyer
 * TO the form, never past it.
 */

// #region Record
const BUYER_COLS =
	"owner_type, owner_id, context_id, context_kind, delivery_first_name, delivery_last_name, " +
	"delivery_email, personal_name, personal_phone, personal_email, personal_address_line_1, " +
	"personal_address_line_2, personal_address_city, personal_address_state, " +
	"personal_address_postcode, personal_address_country, business_company_name, " +
	"business_registration_number, business_tax_id, business_corporate_email, business_phone, " +
	"business_address_line_1, business_address_line_2, business_address_city, " +
	"business_address_state, business_address_postcode, business_address_country, department_id, " +
	"updated_at";

interface BuyerRow {
	owner_type: string;
	owner_id: string;
	context_id: string;
	context_kind: "personal" | "business";
	delivery_first_name: string;
	delivery_last_name: string;
	delivery_email: string | null;
	personal_name: string;
	personal_phone: string;
	personal_email: string | null;
	personal_address_line_1: string | null;
	personal_address_line_2: string | null;
	personal_address_city: string | null;
	personal_address_state: string | null;
	personal_address_postcode: string | null;
	personal_address_country: string | null;
	business_company_name: string | null;
	business_registration_number: string | null;
	business_tax_id: string | null;
	business_corporate_email: string | null;
	business_phone: string | null;
	business_address_line_1: string | null;
	business_address_line_2: string | null;
	business_address_city: string | null;
	business_address_state: string | null;
	business_address_postcode: string | null;
	business_address_country: string | null;
	department_id: string | null;
	updated_at: string;
}

/** Bound a free-text value to the SSOT's field length; `null` → `""`. */
function text(value: string | null | undefined, max: number): string {
	return (value ?? "").trim().slice(0, max);
}

/** An email the SSOT will parse back out, or `""` — a malformed stored value must not break the read. */
function email(value: string | null | undefined): string {
	const v = (value ?? "").trim();
	return v && destinationEmail.safeParse(v).success ? v.slice(0, 320) : "";
}

function address(
	line1: string | null | undefined,
	line2: string | null | undefined,
	city: string | null | undefined,
	state: string | null | undefined,
	postcode: string | null | undefined,
	country: string | null | undefined,
): PostalAddress {
	return {
		line1: text(line1, 160),
		line2: text(line2, 160),
		city: text(city, 80),
		state: text(state, 80),
		postcode: text(postcode, 20),
		country: text(country, 60),
	};
}

/** `1` → `1st`. */
function ordinal(day: number): string {
	const rem100 = day % 100;
	if (rem100 >= 11 && rem100 <= 13) return `${day}th`;
	switch (day % 10) {
		case 1:
			return `${day}st`;
		case 2:
			return `${day}nd`;
		case 3:
			return `${day}rd`;
		default:
			return `${day}th`;
	}
}

/**
 * The account's invoicing terms and whether it may change them.
 *
 * Eligibility is the SAME rule the SSOT gates the `invoice` provider on — a KYB-verified (Level 3)
 * business — because they are one decision asked in two places. An enterprise has no invoicing
 * columns yet, so it is honestly not offered rather than offered and then refused.
 */
export function invoicingOf(owner: ResolvedOwner): MonthlyInvoicing {
	const verified = owner.kybStatus === "verified" && (owner.verificationTier ?? 0) >= 3;
	const eligible = owner.ownerType === "business" && verified;
	const mode = owner.invoicingMode ?? "per_transaction";
	const billingDay = Math.min(Math.max(owner.billingDay ?? 1, 1), 28);
	return {
		mode,
		billingDay,
		eligible,
		ineligibleReason: eligible
			? null
			: owner.ownerType === "business"
			? "Complete business verification (KYB) to consolidate purchases onto a monthly invoice."
			: "Monthly invoicing is available to verified business accounts.",
		nextStatementLabel: mode === "intervaled_monthly" ? `Billed ${ordinal(billingDay)} of each month` : null,
	};
}

/**
 * The record for an account: the saved row when there is one, otherwise a pre-fill from what the
 * platform already knows, never saved.
 */
function recordOf(
	owner: ResolvedOwner,
	row: BuyerRow | null,
	display: string,
	self: ResolvedOwner | null = null,
): BuyerDetails {
	// The DELIVERY contact is the person buying — on an entity's account that is the acting member, not
	// the entity, which has no first name to pre-fill.
	const person = owner.person ?? self?.person ?? null;
	const billing = owner.billing;
	const personName = [person?.firstName, person?.lastName].filter(Boolean).join(" ");
	if (row) {
		return {
			contextId: owner.key,
			contextKind: row.context_kind === "business" ? "business" : "personal",
			delivery: {
				firstName: text(row.delivery_first_name, 80),
				lastName: text(row.delivery_last_name, 80),
				email: email(row.delivery_email),
			},
			personal: {
				name: text(row.personal_name, 120),
				phone: text(row.personal_phone, 32),
				email: email(row.personal_email),
				address: address(
					row.personal_address_line_1,
					row.personal_address_line_2,
					row.personal_address_city,
					row.personal_address_state,
					row.personal_address_postcode,
					row.personal_address_country,
				),
			},
			business: {
				companyName: text(row.business_company_name, 160),
				registrationNumber: text(row.business_registration_number, 60),
				taxId: text(row.business_tax_id, 60),
				corporateEmail: email(row.business_corporate_email),
				phone: text(row.business_phone, 32),
				address: address(
					row.business_address_line_1,
					row.business_address_line_2,
					row.business_address_city,
					row.business_address_state,
					row.business_address_postcode,
					row.business_address_country,
				),
				departmentId: row.department_id ? text(row.department_id, 120) : null,
			},
			invoicing: invoicingOf(owner),
			billingCurrency: display,
			savedAt: new Date(row.updated_at).toISOString(),
		};
	}
	return {
		contextId: owner.key,
		// An entity pays as a business: that is the identity whose money is being spent.
		contextKind: owner.isEntity ? "business" : "personal",
		delivery: {
			firstName: text(person?.firstName, 80),
			lastName: text(person?.lastName, 80),
			email: email(person?.email),
		},
		personal: {
			name: text(personName, 120),
			phone: "",
			email: email(person?.email),
			address: address(null, null, person?.city, null, null, person?.country),
		},
		business: {
			companyName: text(billing?.legalName ?? (owner.isEntity ? owner.name : ""), 160),
			registrationNumber: text(billing?.registrationNumber, 60),
			taxId: text(billing?.taxId, 60),
			corporateEmail: email(billing?.email),
			phone: text(billing?.phone, 32),
			address: billing
				? address(
					billing.addressLine1,
					null,
					billing.addressCity,
					null,
					billing.addressPostcode,
					billing.addressCountry,
				)
				: { ...EMPTY_ADDRESS },
			departmentId: null,
		},
		invoicing: invoicingOf(owner),
		billingCurrency: display,
		savedAt: null,
	};
}

/** The saved rows for a set of accounts, keyed by scope key. */
async function readRows(
	owners: readonly ResolvedOwner[],
	actor: ReadActor,
): Promise<Map<string, BuyerRow>> {
	const out = new Map<string, BuyerRow>();
	if (!canReadLive(actor) || owners.length === 0) return out;
	const { data, error } = await getUserClient(actor.accessToken).schema("finance")
		.from("buyer_details")
		.select(BUYER_COLS)
		.in("owner_id", [...new Set(owners.map((o) => o.ownerId))])
		.in("context_id", [...new Set(owners.map((o) => o.key))]);
	if (error) throw new Error(`finance.buyer_details read failed: ${error.message}`);
	for (const row of (data ?? []) as unknown as BuyerRow[]) {
		const owner = owners.find((o) =>
			o.ownerId === row.owner_id && o.key === row.context_id &&
			(o.isEntity ? o.ownerType === row.owner_type : row.owner_type === "user" || row.owner_type === "freelancer")
		);
		if (owner) out.set(owner.key, row);
	}
	return out;
}

/** The buyer's details for the account a checkout spends from. */
export async function buyerDetailsFor(
	owner: ResolvedOwner,
	actor: ReadActor,
	display: string,
	self: ResolvedOwner | null = null,
): Promise<BuyerDetails> {
	const rows = await readRows([owner], actor);
	return recordOf(owner, rows.get(owner.key) ?? null, display, self);
}

/**
 * Every identity the viewer may bill through — themselves, then each account they belong to — with
 * whether each already has complete saved details (the same predicate the auto-skip uses).
 */
export async function billingContextsFor(
	owners: readonly ResolvedOwner[],
	actor: ReadActor,
	display: string,
): Promise<BillingContext[]> {
	const visible = owners.filter((o) => o.isMember);
	const self = owners.find((o) => !o.isEntity) ?? null;
	const rows = await readRows(visible, actor);
	return visible.map((owner) => ({
		id: owner.key,
		kind: owner.isEntity ? "business" : "personal",
		label: owner.isEntity ? owner.name.slice(0, 120) || "Business" : "Personal",
		handle: owner.isEntity && owner.handle ? owner.handle.slice(0, 40) : null,
		avatar: owner.avatar,
		ownerType: owner.ownerType,
		ownerId: owner.ownerId,
		hasSavedDetails: buyerDetailsComplete(recordOf(owner, rows.get(owner.key) ?? null, display, self)),
		isKybVerified: owner.kybStatus === "verified" && (owner.verificationTier ?? 0) >= 3,
	}));
}

/** The spend departments an account declares — an enterprise's, today. */
export function departmentsOf(owner: ResolvedOwner): { id: string; label: string }[] {
	return owner.departments.map((name) => ({ id: name.slice(0, 120), label: name.slice(0, 120) }));
}
// #endregion

// #region Save
/** The outcome of a details save. */
export type SaveOutcome = { ok: true } | { ok: false; status: number; message: string };

/**
 * Save the buyer's details for the paying account, and apply a change to the account's invoicing
 * terms when the form asked for one.
 *
 * The record is upserted as the caller (RLS: `fn_can_manage_basket` — the same member who may spend
 * from the account may say where its purchases are billed). An invoicing change goes through
 * `finance.set_invoicing_terms`, which asks the stricter `manage_billing` question; a change the
 * account is not eligible for is refused rather than silently dropped.
 */
export async function saveBuyerDetails(
	owner: ResolvedOwner,
	input: SaveBuyerDetails,
	actor: ReadActor,
): Promise<SaveOutcome> {
	if (!canReadLive(actor)) return { ok: false, status: 401, message: "Sign in to save your details." };
	if (!owner.actingIsMember) {
		return {
			ok: false,
			status: 403,
			message:
				"Only a member who can spend from this account can change its billing details. Switch to your personal account to buy this yourself.",
		};
	}
	const headers = planGateHeaders(actor.planGatesOverride);
	const db = getUserClient(actor.accessToken, headers).schema("finance");

	const current = invoicingOf(owner);
	const wantsMode = input.invoicingMode ?? current.mode;
	const wantsDay = input.billingDay ?? current.billingDay;
	if (wantsMode !== current.mode || (wantsMode === "intervaled_monthly" && wantsDay !== current.billingDay)) {
		if (!current.eligible && wantsMode === "intervaled_monthly") {
			return { ok: false, status: 422, message: current.ineligibleReason ?? "Monthly invoicing isn't available." };
		}
		const terms = await db.rpc("set_invoicing_terms", {
			p_owner_type: owner.ownerType,
			p_owner_id: owner.ownerId,
			p_mode: wantsMode,
			p_billing_day: wantsDay,
		});
		if (terms.error) {
			if (terms.error.code === "42501" || terms.error.code === "22023") {
				return { ok: false, status: 403, message: terms.error.message.slice(0, 200) };
			}
			// Monthly terms are Business Pro's (`intervaled_invoicing`): the upgrade, not a failure.
			if (isPlanGateRefusal(terms.error)) {
				const gate = planGateRefusal(terms.error);
				return { ok: false, status: gate.status, message: gate.message };
			}
			throw new Error(`finance.set_invoicing_terms failed: ${terms.error.message}`);
		}
	}

	const nullIfBlank = (value: string) => (value.trim() === "" ? null : value.trim());
	const { error } = await db.from("buyer_details").upsert({
		context_id: owner.key,
		context_kind: input.contextKind,
		owner_type: owner.isEntity ? owner.ownerType : "user",
		owner_id: owner.ownerId,
		delivery_first_name: input.delivery.firstName.trim(),
		delivery_last_name: input.delivery.lastName.trim(),
		delivery_email: nullIfBlank(input.delivery.email),
		personal_name: input.personal.name.trim(),
		personal_phone: input.personal.phone.trim(),
		personal_email: nullIfBlank(input.personal.email),
		personal_address_line_1: nullIfBlank(input.personal.address.line1),
		personal_address_line_2: nullIfBlank(input.personal.address.line2),
		personal_address_city: nullIfBlank(input.personal.address.city),
		personal_address_state: nullIfBlank(input.personal.address.state),
		personal_address_postcode: nullIfBlank(input.personal.address.postcode),
		personal_address_country: nullIfBlank(input.personal.address.country),
		business_company_name: nullIfBlank(input.business.companyName),
		business_registration_number: nullIfBlank(input.business.registrationNumber),
		business_tax_id: nullIfBlank(input.business.taxId),
		business_corporate_email: nullIfBlank(input.business.corporateEmail),
		business_phone: nullIfBlank(input.business.phone),
		business_address_line_1: nullIfBlank(input.business.address.line1),
		business_address_line_2: nullIfBlank(input.business.address.line2),
		business_address_city: nullIfBlank(input.business.address.city),
		business_address_state: nullIfBlank(input.business.address.state),
		business_address_postcode: nullIfBlank(input.business.address.postcode),
		business_address_country: nullIfBlank(input.business.address.country),
		department_id: input.business.departmentId &&
				owner.departments.includes(input.business.departmentId)
			? input.business.departmentId
			: null,
		updated_at: new Date().toISOString(),
	}, { onConflict: "owner_type,owner_id,context_id" });
	if (error) {
		if (error.code === "42501") {
			return { ok: false, status: 403, message: "You can't change this account's billing details." };
		}
		throw new Error(`finance.buyer_details save failed: ${error.message}`);
	}
	return { ok: true };
}
// #endregion

// #region Gates
/**
 * The voluntary gateway-contribution offer.
 *
 * Offered only when a gateway is actually involved AND its cost is known. No payment gateway is
 * connected, so there is no real fee to offset — and asking a buyer to cover a cost nobody can quote
 * would be asking for an invented number. Not offered until the gateway can report one.
 */
export function processingOfferFor(money: MoneyProjector): ProcessingContributionOffer {
	return {
		offered: false,
		optedIn: false,
		amount: money.derived(0),
		note: "An optional processing contribution will be offered once card payments are connected.",
	};
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PERIOD_LABEL: Record<string, string | null> = {
	weekly: "this week",
	monthly: "this month",
	total: null,
};

/**
 * How the acting member's spending limit bears on this basket.
 *
 * **The verdict is `evaluateSpend`'s — this function computes none of it.** That rule lives in
 * `@projective/types/workspace` and is the one the workspace console and the approval queue run on.
 * The inputs are read here: the member's `finance.spending_limits` row on the paying account's
 * wallets, the wallet's approval threshold, and the account's verification. A personal wallet has no
 * cap: `applies: false`, and the surface renders no control at all.
 *
 * A member with the `spend` capability and no limit row is uncapped — the capability is what grants
 * spending, and a limit only narrows it. KYB gates a BUSINESS or enterprise wallet; a team is not
 * subject to it.
 *
 * The inputs are the ones the database's gate reads: the envelope rolled at `resets_at` as
 * `finance.fn_check_spending_limit` rolls it, and a business wallet's threshold with the platform's
 * `vault_approval_threshold_cents` behind a NULL column (`finance.fn_business_threshold`), so the
 * pre-flight refuses exactly what the gate would and offers a request the database will file.
 *
 * A business `needs_approval` verdict is bound to the basket (`requestRef`) and names the business
 * gate's sub-code (`gate`, Decision #240). The member's latest unspent request for the basket is read
 * with it (`request`), and bears on the verdict only while the order needs approval: an approved one —
 * unexpired, filed by this member, covering the charge — turns the verdict `allowed` with
 * `approved: true`, because the charge will spend that approval (`finance.fn_redeem_spend_approval`
 * decides; this read only stops Pay refusing what the database would accept); a pending one keeps
 * `needs_approval` with "waiting" as its reason. An order that no longer needs approval is not held
 * by a request left pending for it, and is not told it spends an approval it will not touch. A team
 * has nobody holding `approve_spend` (BUSINESSES_AUDIT BF44), so its `needs_approval` is `blocked`:
 * there is no request to offer.
 *
 * For a business member it also reads what the checkout needs to offer the way past a refusal
 * (`businessAccount`, Decision #243): who can approve, and whether the member may add money or start
 * KYB — one read of the vault's permissions, which any active member may see.
 */
export async function spendPositionFor(
	owner: ResolvedOwner,
	totalMinor: number,
	money: MoneyProjector,
	actor: ReadActor,
	binding: SpendBinding = { basketId: null, charge: null },
): Promise<SpendPosition> {
	const zero = money.derived(0);
	const none: SpendLimitBlock = {
		applies: false,
		verdict: "allowed",
		reason: null,
		cap: zero,
		spent: zero,
		remaining: zero,
		periodLabel: null,
		gate: null,
		request: null,
		requestRef: null,
		approved: false,
	};
	if (!owner.isEntity || !canReadLive(actor)) return { spendLimit: none, businessAccount: null };

	const db = getUserClient(actor.accessToken).schema("finance");
	const wallets = await db.from("wallets")
		.select("id, currency, approval_threshold_cents")
		.eq("owner_type", owner.ownerType)
		.eq("owner_id", owner.ownerId);
	if (wallets.error) throw new Error(`finance.wallets read failed: ${wallets.error.message}`);
	const walletRows = (wallets.data ?? []) as {
		id: string;
		currency: string;
		approval_threshold_cents: number | string | null;
	}[];

	// The wallet the order is paid from is the account's wallet in the CHARGE currency
	// (`place_wallet_order`), so its limit and threshold are the ones the database will apply.
	const chargeCurrency = binding.charge?.currency.toUpperCase() ?? null;
	const paying = chargeCurrency
		? walletRows.find((w) => w.currency.toUpperCase() === chargeCurrency) ?? null
		: null;

	interface LimitRow {
		wallet_id: string;
		cap_cents: number | string | null;
		per_transaction_cents: number | string | null;
		spent_cents: number | string;
		period_interval: string;
		resets_at: string | null;
	}
	let limit: LimitRow | null = null;
	if (walletRows.length > 0) {
		const limits = await db.from("spending_limits")
			.select(
				"wallet_id, cap_cents, per_transaction_cents, spent_cents, period_interval, resets_at",
			)
			.eq("member_user_id", actor.userId)
			.in("wallet_id", paying ? [paying.id] : walletRows.map((w) => w.id))
			.limit(1);
		if (limits.error) throw new Error(`finance.spending_limits read failed: ${limits.error.message}`);
		limit = ((limits.data ?? []) as LimitRow[])[0] ?? null;
	}

	const wallet = paying ?? walletRows.find((w) => w.id === limit?.wallet_id) ?? walletRows[0] ??
		null;
	const currency = wallet?.currency ?? money.display;
	const convert = (minor: number | string | null) =>
		minor === null ? null : money.canConvert(currency) ? money.convertMinor(Number(minor) || 0, currency) : null;

	// A NULL cap is "no ceiling" (finance.fn_check_spending_limit), not a cap of zero: reading it as 0
	// refused every purchase from an uncapped member's envelope (#125(e)).
	const capped = limit !== null && limit.cap_cents !== null;
	const capMinor = capped ? convert(limit!.cap_cents) ?? 0 : 0;
	const spentMinor = limit && !periodLapsed(limit, Date.now())
		? convert(limit.spent_cents) ?? 0
		: 0;
	const remainingMinor = Math.max(capMinor - spentMinor, 0);
	const business = owner.ownerType === "business";
	const ownThreshold = wallet?.approval_threshold_cents ?? null;
	const thresholdCents = ownThreshold !== null
		? ownThreshold
		: business && wallet !== null
		? await platformThresholdCents(actor.accessToken)
		: null;
	const threshold = thresholdCents !== null ? convert(thresholdCents) : null;

	const verdict = evaluateSpend(
		totalMinor,
		{
			canSpend: owner.actingIsMember,
			limitMinor: capped ? remainingMinor : null,
			perTransactionMinor: limit?.per_transaction_cents != null ? convert(limit.per_transaction_cents) : null,
		},
		{
			approvalThresholdMinor: threshold && threshold > 0 ? threshold : null,
			verification: owner.ownerType === "team" || owner.kybStatus === "verified" ? "verified" : "unverified",
		},
	);

	// Only a stored basket binds a request: an owner with none yet reads the synthetic default basket,
	// whose id is no row's (`DEFAULT_BASKET_ID`) and nothing could be filed against.
	const basketId = business && binding.basketId && UUID.test(binding.basketId)
		? binding.basketId
		: null;
	const [requestRows, vaultRows] = wallet !== null
		? await Promise.all([
			basketId ? readRequests(db, wallet.id, basketId, actor.userId) : Promise.resolve([]),
			business && owner.actingIsMember && binding.account !== false
				? readVault(db, wallet.id)
				: Promise.resolve(null),
		])
		: [[], null];

	// What an approval's amount is compared with: the charge itself when the two share a currency (no
	// conversion to round), else the display total, projected like every other figure here.
	const covers = (row: ApprovalRow): boolean =>
		binding.charge && row.currency.toUpperCase() === binding.charge.currency.toUpperCase()
			? Number(row.amount_cents) >= binding.charge.minor
			: (convert(row.amount_cents) ?? -1) >= totalMinor;
	const latest = latestRequest(requestRows, Date.now(), covers);

	const approverIds = vaultRows ? approversIn(vaultRows, actor.userId) : [];
	const names = binding.account !== false && (vaultRows || latest?.row.approver_user_id)
		? await fetchPartyCards(getUserClient(actor.accessToken), [
			...approverIds.map((a) => a.userId),
			latest?.row.approver_user_id,
		])
		: new Map<string, { name: string }>();
	const request = latest ? requestView(latest, names) : null;

	// A request bears on the verdict only while the order needs one (`fn_assert_business_spend` redeems
	// on its over-cap and threshold paths alone).
	const needs = business && verdict.outcome === "needs_approval";
	const approved = needs && request?.state === "approved" && request.covers;
	const pending = needs && request?.state === "pending";
	const outcome = approved
		? "allowed"
		: verdict.outcome === "needs_approval" && owner.ownerType === "team"
		? "blocked"
		: verdict.outcome;
	const gate: SpendGateReason | null =
		!business || outcome === "allowed" || verdict.outcome === "allowed" ||
			verdict.code === "no_spend"
			? null
			: verdict.code;

	const spendLimit: SpendLimitBlock = {
		applies: true,
		verdict: outcome,
		reason: outcome === "allowed" || verdict.outcome === "allowed"
			? null
			: pending
			? "Waiting for an approver's decision."
			: verdict.reason,
		cap: capped ? money.derived(capMinor) : null,
		spent: money.derived(spentMinor),
		remaining: capped ? money.derived(remainingMinor) : null,
		periodLabel: limit ? PERIOD_LABEL[limit.period_interval] ?? null : null,
		gate,
		request,
		requestRef: outcome === "needs_approval" && basketId !== null
			? { refTable: "baskets", refId: basketId }
			: null,
		approved,
	};
	const businessAccount: CheckoutBusinessAccount | null = vaultRows
		? accountOf(vaultRows, approverIds, names, actor.userId, owner)
		: null;
	return { spendLimit, businessAccount };
}

/**
 * How the acting member's spending limit bears on this basket — {@link spendPositionFor}'s verdict
 * alone, for a caller that renders nothing of the business account (the charge's own pre-flight).
 */
export async function spendLimitFor(
	owner: ResolvedOwner,
	totalMinor: number,
	money: MoneyProjector,
	actor: ReadActor,
	binding: SpendBinding = { basketId: null, charge: null },
): Promise<SpendLimitBlock> {
	return (await spendPositionFor(owner, totalMinor, money, actor, { ...binding, account: false }))
		.spendLimit;
}
// #endregion

// #region Spend requests & the vault
/** What a checkout's spend read binds to, beyond the total. */
export interface SpendBinding {
	/** The basket a business `needs_approval` request binds to; `null` when there is none. */
	basketId: string | null;
	/**
	 * The charge in the listings' own currency (the session's `charge`): it picks the paying wallet —
	 * the one `place_wallet_order` debits — and is what an approval's amount is compared with when the
	 * two share a currency, so a covering approval is never read as short by a conversion's rounding.
	 */
	charge: MoneyView | null;
	/** Read the business account (who approves, add money, KYB) — default `true`. */
	account?: boolean;
}

/** A checkout's spend position: the verdict, and for a business member the way past its refusals. */
export interface SpendPosition {
	spendLimit: SpendLimitBlock;
	businessAccount: CheckoutBusinessAccount | null;
}

type FinanceDb = ReturnType<ReturnType<typeof getUserClient>["schema"]>;

interface ApprovalRow {
	id: string;
	amount_cents: number | string;
	currency: string;
	status: "pending" | "approved" | "rejected" | "expired" | "withdrawn";
	approver_user_id: string | null;
	expires_at: string | null;
	created_at: string;
}

interface VaultRow {
	member_user_id: string;
	capabilities: string[] | null;
}

const EXPIRY = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
	day: "numeric",
	month: "short",
	timeZone: "UTC",
});

/**
 * The member's own unspent requests for this basket on this wallet, newest first, read through RLS
 * ("View wallet spend approvals" — a member sees their own). A spent request is history: the next
 * order on the basket needs a fresh approval, so `consumed_at IS NULL` is part of the question.
 * Withdrawn requests are read too: {@link latestRequest} needs to know the newest one was taken back.
 */
async function readRequests(
	db: FinanceDb,
	walletId: string,
	basketId: string,
	userId: string,
): Promise<ApprovalRow[]> {
	const { data, error } = await db.from("spend_approvals")
		.select("id, amount_cents, currency, status, approver_user_id, expires_at, created_at")
		.eq("wallet_id", walletId)
		.eq("ref_table", "baskets")
		.eq("ref_id", basketId)
		.eq("requested_by", userId)
		.is("consumed_at", null)
		.order("created_at", { ascending: false })
		.limit(5);
	if (error) throw new Error(`finance.spend_approvals read failed: ${error.message}`);
	return (data ?? []) as ApprovalRow[];
}

/**
 * Whether a limit row's window has lapsed, so its `spent_cents` no longer counts — the roll
 * `finance.fn_check_spending_limit` and `request_spend_approval` make: a weekly or monthly window whose
 * `resets_at` has passed; a lifetime `total` never rolls.
 */
function periodLapsed(
	row: { period_interval: string; resets_at: string | null },
	now: number,
): boolean {
	return row.period_interval !== "total" && row.resets_at !== null &&
		Date.parse(row.resets_at) <= now;
}

/**
 * The platform's approval threshold (`security.platform_params` `vault_approval_threshold_cents`), the
 * one a business wallet with no threshold of its own answers to (`finance.fn_business_threshold`), in
 * the wallet's minor units. `null` when it is unset or zero — no threshold. Read as the caller ("Read
 * platform params" — any signed-in member).
 */
async function platformThresholdCents(accessToken: string): Promise<number | null> {
	const { data, error } = await getUserClient(accessToken).schema("security")
		.from("platform_params")
		.select("value")
		.eq("key", "vault_approval_threshold_cents")
		.maybeSingle();
	if (error) throw new Error(`security.platform_params read failed: ${error.message}`);
	const cents = Number((data as { value: unknown } | null)?.value ?? 0);
	return Number.isFinite(cents) && cents > 0 ? cents : null;
}

/** The wallet's vault permissions, read through RLS ("View vault permissions" — any member). */
async function readVault(db: FinanceDb, walletId: string): Promise<VaultRow[]> {
	const { data, error } = await db.from("vault_permissions")
		.select("member_user_id, capabilities")
		.eq("wallet_id", walletId);
	if (error) throw new Error(`finance.vault_permissions read failed: ${error.message}`);
	return (data ?? []) as VaultRow[];
}

/** A request its member has not withdrawn — one the checkout can show. */
type ShownApprovalRow = ApprovalRow & { status: Exclude<ApprovalRow["status"], "withdrawn"> };

function notWithdrawn(row: ApprovalRow): row is ShownApprovalRow {
	return row.status !== "withdrawn";
}

/** A request's state as the checkout shows it: `rejected` reads `declined`, a lapsed one `expired`. */
function stateOf(row: ShownApprovalRow, now: number): CheckoutSpendRequest["state"] {
	const lapsed = row.expires_at !== null && Date.parse(row.expires_at) <= now;
	if (row.status === "rejected") return "declined";
	if (row.status === "expired" || lapsed) return "expired";
	return row.status;
}

/**
 * The request the checkout shows: an approved, unexpired one covering the charge first — the one the
 * redeemer would spend — else the newest, whatever its state. When the newest was WITHDRAWN by its
 * member (Decision #246) there is nothing to show: an older declined or expired request is history
 * they had already moved past, so the checkout offers Request approval afresh rather than reading it
 * back as the answer.
 */
export function latestRequest(
	rows: readonly ApprovalRow[],
	now: number,
	covers: (row: ApprovalRow) => boolean,
): { row: ApprovalRow; state: CheckoutSpendRequest["state"]; covers: boolean } | null {
	const read = rows.filter(notWithdrawn)
		.map((row) => ({ row, state: stateOf(row, now), covers: covers(row) }));
	const usable = read.find((r) => r.state === "approved" && r.covers);
	if (usable) return usable;
	return rows[0]?.status === "withdrawn" ? null : read[0] ?? null;
}

function requestView(
	latest: { row: ApprovalRow; state: CheckoutSpendRequest["state"]; covers: boolean },
	names: ReadonlyMap<string, { name: string }>,
): CheckoutSpendRequest {
	const { row } = latest;
	const minor = Number(row.amount_cents) || 0;
	const currency = row.currency.toUpperCase();
	return {
		id: row.id,
		state: latest.state,
		amount: {
			minor,
			currency,
			display: formatMoney(minor, currency, DEFAULT_LOCALE),
			origin: null,
		},
		covers: latest.covers,
		expiresLabel: row.expires_at ? `Expires ${EXPIRY.format(new Date(row.expires_at))}` : null,
		decidedBy: row.approver_user_id
			? names.get(row.approver_user_id)?.name.slice(0, 120) ?? null
			: null,
	};
}

const DECIDES = ["approve_spend", "manage_members"];

/**
 * Who can decide this member's request: the vault's OTHER members holding `approve_spend` or
 * `manage_members` — the same set `finance.request_spend_approval` notifies — owner (`manage_members`)
 * first.
 */
function approversIn(
	rows: readonly VaultRow[],
	self: string,
): { userId: string; owner: boolean }[] {
	return rows
		.filter((row) =>
			row.member_user_id !== self && (row.capabilities ?? []).some((c) => DECIDES.includes(c))
		)
		.map((row) => ({
			userId: row.member_user_id,
			owner: (row.capabilities ?? []).includes("manage_members"),
		}));
}

function accountOf(
	rows: readonly VaultRow[],
	approvers: readonly { userId: string; owner: boolean }[],
	names: ReadonlyMap<string, { name: string }>,
	self: string,
	owner: ResolvedOwner,
): CheckoutBusinessAccount {
	const mine = new Set(rows.find((row) => row.member_user_id === self)?.capabilities ?? []);
	return {
		approvers: approvers
			.map((a) => ({ owner: a.owner, name: names.get(a.userId)?.name.slice(0, 120) ?? "" }))
			.filter((a) => a.name !== "")
			.sort((a, b) => Number(b.owner) - Number(a.owner) || a.name.localeCompare(b.name))
			.slice(0, 12)
			.map((a) => a.name),
		canAddFunds: mine.has("add_funds") || mine.has("manage_members"),
		canStartKyb: mine.has("manage_billing") || mine.has("manage_members"),
		canManageMembers: mine.has("manage_members"),
		kybStatus: owner.kybStatus,
	};
}
// #endregion
