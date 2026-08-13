import type {
	BillingContext,
	BuyerDetails,
	MonthlyInvoicing,
	PostalAddress,
	ProcessingContributionOffer,
	SaveBuyerDetails,
	SpendLimitBlock,
} from "@projective/types/finance";
import { evaluateSpend } from "@projective/types/workspace";
import { buyerDetailsComplete, EMPTY_ADDRESS, formatMoney } from "@projective/types/finance";
import type { BasketQuery } from "./basket-query.ts";
import * as fx from "./basket-fixtures.ts";

/**
 * buyer-fixtures — the deterministic buyer delivery + billing corpus behind `/checkout/details`, and
 * the mutable session store that makes saving them exercisable with `FINANCE_BACKEND_LIVE` off.
 *
 * **Seeded so both branches of the auto-skip are reachable without a dev override.** The personal
 * identity ships with its delivery block pre-filled from the account and its billing block empty and
 * **never saved** — a genuine first-time buyer, so `/checkout/details` renders. Every entity identity
 * ships complete and saved, so switching to a business is the shortest path to seeing the skip. The
 * `simDetails` axis then flips either one, because a developer must be able to reach the branch that
 * silently sends a buyer past a form.
 *
 * **Pre-fill is not completeness.** A record seeded from the account has `savedAt: null`, and
 * `buyerDetailsComplete` refuses it on that ground alone — which is the rule that stops the checkout
 * delivering to an address the buyer has never actually looked at.
 *
 * Deterministic: no RNG, no `Date.now()`. Every stamp derives from the shared reference clock in
 * `basket-fixtures`, so a reset reproduces the same corpus.
 */

// #region Reference clock
/** The corpus reference instant, kept in step with `basket-fixtures`' own `NOW`. */
const NOW = Date.parse("2026-07-17T16:20:00Z");
const DAY = 86_400_000;

/** An ISO stamp, so a saved record carries a real `savedAt` without reading a clock. */
function iso(ms: number): string {
	return new Date(ms).toISOString();
}
// #endregion

// #region Seeds
/** One seeded buyer-details record, keyed by the owner scope it belongs to. */
interface BuyerSeed {
	/** The owner scope key (`personal` · `business:monarch-labs` · …). */
	key: string;
	/** Whether this identity bills as a natural person or as a company. */
	kind: "personal" | "business";
	firstName: string;
	lastName: string;
	email: string;
	phone: string;
	address: PostalAddress;
	/** Company facts; omitted for a personal identity. */
	company?: {
		name: string;
		registrationNumber: string;
		taxId: string;
		corporateEmail: string;
		/** `org.organisations.departments` — the allocation options. */
		departments: readonly { id: string; label: string }[];
		defaultDepartmentId: string | null;
	};
	/** `org.business_profiles.invoicing_mode` + `billing_day`. */
	invoicingMode: "per_transaction" | "intervaled_monthly";
	billingDay: number;
	/** Days before the reference clock the buyer last saved. `null` = never saved. */
	savedDaysAgo: number | null;
}

const ADDRESS_LONDON: PostalAddress = {
	line1: "42 Rivington Street",
	line2: "Studio 3",
	city: "London",
	state: "",
	postcode: "EC2A 3BN",
	country: "GB",
};

const ADDRESS_MANCHESTER: PostalAddress = {
	line1: "1 Whitworth Street West",
	line2: "",
	city: "Manchester",
	state: "",
	postcode: "M1 5WG",
	country: "GB",
};

const ADDRESS_EDINBURGH: PostalAddress = {
	line1: "18 Melville Street",
	line2: "Floor 4",
	city: "Edinburgh",
	state: "",
	postcode: "EH3 7NS",
	country: "GB",
};

/**
 * The seeded records, one per owner scope in `basket-fixtures`' cast.
 *
 * The personal identity is deliberately the INCOMPLETE one: it is the scope a developer lands in by
 * default, so the Details step is on the default path rather than behind a switcher.
 */
const SEEDS: BuyerSeed[] = [
	{
		key: "personal",
		kind: "personal",
		firstName: "Ahmed",
		lastName: "Kotwal",
		email: "ahmed@projective.test",
		phone: "",
		// Empty on purpose — a first-time buyer has an account, not a billing address.
		address: EMPTY_ADDRESS,
		invoicingMode: "per_transaction",
		billingDay: 1,
		savedDaysAgo: null,
	},
	{
		key: "team:northwind",
		kind: "personal",
		firstName: "Ahmed",
		lastName: "Kotwal",
		email: "billing@northwind.test",
		phone: "+44 7700 900142",
		address: ADDRESS_MANCHESTER,
		invoicingMode: "per_transaction",
		billingDay: 1,
		savedDaysAgo: 34,
	},
	{
		key: "business:monarch-labs",
		kind: "business",
		firstName: "Ahmed",
		lastName: "Kotwal",
		email: "ahmed@monarchlabs.test",
		phone: "+44 7700 900188",
		address: ADDRESS_LONDON,
		company: {
			name: "Monarch Labs Ltd",
			registrationNumber: "09876543",
			taxId: "GB 342 1198 76",
			corporateEmail: "accounts@monarchlabs.test",
			departments: [
				{ id: "dept-design", label: "Design" },
				{ id: "dept-product", label: "Product" },
				{ id: "dept-marketing", label: "Marketing" },
				{ id: "dept-ops", label: "Operations" },
			],
			defaultDepartmentId: "dept-design",
		},
		invoicingMode: "intervaled_monthly",
		billingDay: 1,
		savedDaysAgo: 12,
	},
	{
		key: "organisation:meridian",
		kind: "business",
		firstName: "Ahmed",
		lastName: "Kotwal",
		email: "ahmed@meridian.test",
		phone: "+44 7700 900211",
		address: ADDRESS_EDINBURGH,
		company: {
			name: "Meridian Group plc",
			registrationNumber: "SC451209",
			taxId: "GB 771 4402 19",
			corporateEmail: "finance@meridian.test",
			departments: [
				{ id: "dept-technology", label: "Technology" },
				{ id: "dept-brand", label: "Brand & Comms" },
				{ id: "dept-people", label: "People" },
				{ id: "dept-finance", label: "Finance" },
				{ id: "dept-legal", label: "Legal" },
			],
			defaultDepartmentId: "dept-technology",
		},
		invoicingMode: "per_transaction",
		billingDay: 1,
		savedDaysAgo: 61,
	},
];

const SEED_BY_KEY = new Map(SEEDS.map((seed) => [seed.key, seed]));
// #endregion

// #region Mutable session store
/**
 * Saved records, by owner key. Per-process and NOT persisted — the same shape the basket's own store
 * takes, so a save round-trips within a session and the whole flow is exercisable with the gate off.
 */
const STATE = new Map<string, BuyerDetails>();

/** The departments an owner scope offers, so the allocation control has real options. */
export function departmentsFor(ownerKey: string): readonly { id: string; label: string }[] {
	return SEED_BY_KEY.get(ownerKey)?.company?.departments ?? [];
}

/** Project a seed into the SSOT record. */
function fromSeed(seed: BuyerSeed, display: string): BuyerDetails {
	const company = seed.company;
	return {
		contextId: seed.key,
		contextKind: seed.kind,
		delivery: {
			firstName: seed.firstName,
			lastName: seed.lastName,
			email: seed.email,
		},
		personal: {
			name: `${seed.firstName} ${seed.lastName}`,
			phone: seed.phone,
			email: seed.email,
			address: seed.address,
		},
		business: {
			companyName: company?.name ?? "",
			registrationNumber: company?.registrationNumber ?? "",
			taxId: company?.taxId ?? "",
			corporateEmail: company?.corporateEmail ?? "",
			phone: seed.phone,
			address: company ? seed.address : EMPTY_ADDRESS,
			departmentId: company?.defaultDepartmentId ?? null,
		},
		invoicing: invoicingFor(seed, null),
		billingCurrency: display,
		savedAt: seed.savedDaysAgo === null ? null : iso(NOW - seed.savedDaysAgo * DAY),
	};
}

/**
 * The monthly-invoicing offer for a seed.
 *
 * Eligibility is the SAME rule `availableProviders` gates the `invoice` provider on — KYB Level 3 —
 * because they are one decision ("may this account defer settlement?") asked in two places. Deriving
 * it twice is how a checkout comes to offer monthly billing to an account whose invoice provider it
 * then refuses.
 */
function invoicingFor(
	seed: BuyerSeed,
	owner: fx.ResolvedOwner | null,
): MonthlyInvoicing {
	const isEntity = owner ? owner.isEntity : seed.key !== "personal";
	const verified = owner
		? owner.kybStatus === "verified" && (owner.verificationTier ?? 0) >= 3
		: seed.key.startsWith("business:") || seed.key.startsWith("organisation:");

	const eligible = isEntity && verified;
	return {
		mode: seed.invoicingMode,
		billingDay: seed.billingDay,
		eligible,
		ineligibleReason: eligible
			? null
			: isEntity
			? "Complete business verification (KYB) to consolidate purchases onto a monthly invoice."
			: "Monthly invoicing is available to verified business accounts.",
		nextStatementLabel: seed.invoicingMode === "intervaled_monthly"
			? `Billed ${ordinal(seed.billingDay)} of each month`
			: null,
	};
}

/** `1` → `1st`. English-only, which is what every other display label in this corpus already is. */
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
// #endregion

// #region Reads
/**
 * The buyer's details for the account a read is scoped to.
 *
 * The `simDetails` axis is applied to the RESOLVED record rather than by selecting a different seed:
 * `missing` clears the billing block and the save stamp on whatever identity is active, and `saved`
 * completes it. Selecting a different seed instead would change which ACCOUNT the buyer is looking
 * at as a side effect of asking about their details, which is a different question.
 */
export function buyerDetailsFor(owner: fx.ResolvedOwner, query: BasketQuery): BuyerDetails {
	const seed = SEED_BY_KEY.get(owner.key) ?? SEEDS[0];
	const stored = STATE.get(owner.key);
	const base = stored ?? fromSeed(seed, owner.display);

	// The billing identity the form opens on. An entity scope defaults to `business` because that is
	// the identity whose money is being spent; a dev override wins over both.
	const kind = query.sim?.billing ?? (owner.isEntity ? "business" : base.contextKind);

	const record: BuyerDetails = {
		...base,
		contextId: owner.key,
		contextKind: kind,
		billingCurrency: owner.display,
		invoicing: {
			...invoicingFor(seed, owner),
			mode: query.sim?.invoicing ?? (stored?.invoicing.mode ?? seed.invoicingMode),
		},
	};

	const axis = query.sim?.details;
	if (axis === "missing") {
		return {
			...record,
			personal: { ...record.personal, address: EMPTY_ADDRESS, phone: "" },
			business: { ...record.business, address: EMPTY_ADDRESS, taxId: "", registrationNumber: "" },
			savedAt: null,
		};
	}
	if (axis === "saved") {
		const complete = fromSeed(
			seed.company ? seed : { ...seed, kind: "personal" },
			owner.display,
		);
		return {
			...record,
			personal: completePersonal(complete.personal, seed),
			business: completeBusiness(complete.business, seed),
			savedAt: iso(NOW - DAY),
		};
	}
	return record;
}

/** Fill a personal block that a seed left partial, so the `saved` axis is genuinely complete. */
function completePersonal(
	block: BuyerDetails["personal"],
	seed: BuyerSeed,
): BuyerDetails["personal"] {
	return {
		...block,
		name: block.name || `${seed.firstName} ${seed.lastName}`,
		email: block.email || seed.email,
		phone: block.phone || "+44 7700 900142",
		address: block.address.line1 ? block.address : ADDRESS_LONDON,
	};
}

/** Fill a business block that a seed left partial, so the `saved` axis is genuinely complete. */
function completeBusiness(
	block: BuyerDetails["business"],
	seed: BuyerSeed,
): BuyerDetails["business"] {
	return {
		...block,
		companyName: block.companyName || `${seed.firstName} ${seed.lastName} Ltd`,
		registrationNumber: block.registrationNumber || "12345678",
		taxId: block.taxId || "GB 123 4567 89",
		corporateEmail: block.corporateEmail || seed.email,
		phone: block.phone || "+44 7700 900142",
		address: block.address.line1 ? block.address : ADDRESS_LONDON,
	};
}

/**
 * Every identity the acting viewer may bill through: their personal one, then each entity in the
 * cast. `hasSavedDetails` is resolved through the same predicate the auto-skip uses.
 */
export function billingContextsFor(owner: fx.ResolvedOwner, query: BasketQuery): BillingContext[] {
	return SEEDS.map((seed) => {
		const isEntity = seed.key !== "personal";
		const resolved = seed.key === owner.key
			? buyerDetailsFor(owner, query)
			: STATE.get(seed.key) ?? fromSeed(seed, owner.display);
		const scope = seed.key.split(":");
		return {
			id: seed.key,
			kind: seed.kind,
			label: labelFor(seed),
			handle: isEntity ? scope[1] ?? null : null,
			avatar: null,
			ownerType: isEntity
				? (scope[0] as BillingContext["ownerType"])
				: (owner.ownerType === "freelancer" ? "freelancer" : "user"),
			ownerId: isEntity ? scope[1] ?? "" : owner.ownerId,
			hasSavedDetails: buyerDetailsComplete(resolved),
			isKybVerified: seed.key === owner.key
				? owner.kybStatus === "verified" && (owner.verificationTier ?? 0) >= 3
				: seed.key.startsWith("business:") || seed.key.startsWith("organisation:"),
		};
	});
}

/** The switcher's display name for a seed. */
function labelFor(seed: BuyerSeed): string {
	if (seed.key === "personal") return "Personal";
	return seed.company?.name ?? seed.key.split(":")[1] ?? seed.key;
}

/**
 * The voluntary gateway-contribution offer.
 *
 * **Offered only when a gateway is actually involved.** A wallet payment moves money that is already
 * on the platform and incurs no card-scheme cost, so asking the buyer to help cover one would be
 * asking for money against a cost that does not exist. The amount is a rounded 1.4% + 20p of the
 * charge, which is a plausible UK card cost — flagged below as an ESTIMATE, because this corpus has
 * no gateway to ask.
 */
export function processingOfferFor(
	totalMinor: number,
	display: string,
	provider: string | null,
	optedIn: boolean,
): ProcessingContributionOffer {
	const gatewayless = provider === "wallet" || provider === "invoice";
	if (gatewayless || totalMinor <= 0) {
		return {
			offered: false,
			optedIn: false,
			amount: fx.money(0, display),
			note: "No third-party gateway fee applies to this payment method.",
		};
	}
	// FLAGGED: a fixtures estimate, not a quoted cost. The live path must read the real figure back
	// from the gateway — this number is here so the control has something honest-shaped to render,
	// and the surface never presents it as the exact cost of this particular charge.
	const amount = Math.round(totalMinor * 0.014) + 20;
	return {
		offered: true,
		optedIn,
		amount: fx.money(amount, display),
		note:
			"Optional contribution to offset third-party gateway transaction costs. It goes to the payment processor, never to Projective, and it never changes what the seller receives.",
	};
}
// #endregion

// #region Spending limit
/**
 * How the acting member's spending limit bears on this basket.
 *
 * **The verdict is `evaluateSpend`'s — this function computes none of it.** That rule lives in
 * `@projective/types/workspace` and is the one the workspace console, the approval queue and the
 * pooled wallet already run on. The SSOT's `SpendLimitBlockSchema` cannot call it (importing
 * `workspace` into `finance` would close a cycle: `workspace/policy.ts` already imports
 * `finance/wallet.ts`), so the fat service is the layer that reaches both — which is exactly what a
 * fat service is for. Re-deriving the ceiling arithmetic here would make a fourth view of a rule that
 * already has three.
 *
 * A personal wallet has no cap: `applies: false`, and the surface renders no control at all rather
 * than an unlimited one, which would be a control that never does anything.
 */
export function spendLimitFor(
	owner: fx.ResolvedOwner,
	totalMinor: number,
	query: BasketQuery,
): SpendLimitBlock {
	const zero = fx.money(0, owner.display);
	if (!owner.isEntity) {
		return {
			applies: false,
			verdict: "allowed",
			reason: null,
			cap: zero,
			spent: zero,
			remaining: zero,
			periodLabel: null,
			requestHref: null,
		};
	}

	// A deterministic monthly envelope for the acting member. The `simSpendLimit` axis moves the CAP
	// relative to this basket rather than overriding the verdict — the same discipline the provider
	// preset follows, so the real rule is what decides in every case.
	const over = query.sim?.spendLimit === "over";
	const spentMinor = 120_00;
	const capMinor = over ? Math.max(totalMinor - 1, spentMinor) : spentMinor + totalMinor + 500_00;
	const remainingMinor = Math.max(capMinor - spentMinor, 0);

	const verdict = evaluateSpend(
		totalMinor,
		{
			canSpend: query.sim?.workspaceRole !== "non_member",
			limitMinor: remainingMinor,
			perTransactionMinor: null,
		},
		{
			approvalThresholdMinor: null,
			verification: owner.kybStatus === "verified" ? "verified" : "unverified",
		},
	);

	return {
		applies: true,
		verdict: verdict.outcome,
		reason: verdict.outcome === "allowed" ? null : verdict.reason,
		cap: fx.money(capMinor, owner.display),
		spent: fx.money(spentMinor, owner.display),
		remaining: fx.money(remainingMinor, owner.display),
		periodLabel: "this month",
		requestHref: verdict.outcome === "needs_approval"
			? `/businesses/${owner.ownerId}/policy`
			: null,
	};
}
// #endregion

// #region Writes
/** Persist a details record for the session. Returns the stored record, re-read through the projection. */
export function saveBuyerDetails(
	owner: fx.ResolvedOwner,
	input: SaveBuyerDetails,
	query: BasketQuery,
): BuyerDetails {
	const seed = SEED_BY_KEY.get(owner.key) ?? SEEDS[0];
	const current = STATE.get(owner.key) ?? fromSeed(seed, owner.display);
	const next: BuyerDetails = {
		...current,
		contextId: owner.key,
		contextKind: input.contextKind,
		delivery: input.delivery,
		personal: input.personal,
		business: input.business,
		invoicing: {
			...invoicingFor(seed, owner),
			mode: input.invoicingMode ?? current.invoicing.mode,
			billingDay: input.billingDay ?? current.invoicing.billingDay,
		},
		billingCurrency: owner.display,
		// The save stamp is what `buyerDetailsComplete` requires beyond the fields themselves, so a
		// save is the ONLY thing that can make a record skippable.
		savedAt: iso(NOW),
	};
	STATE.set(owner.key, next);
	return buyerDetailsFor(owner, query);
}

/** Test seam: forget every saved record, so a fixture reset is reproducible. */
export function resetBuyerDetails(): void {
	STATE.clear();
}

/** Re-exported so a caller formatting a contribution never reaches for a second formatter. */
export { formatMoney };
// #endregion
