import { assertEquals } from "@std/assert";
import type { CheckoutOrderLink, InboundPayment } from "@projective/types/finance";
import { supersedes } from "./PaymentBackendService.ts";

/**
 * A checkout attempt for lines that already have a live card payment (Decision #435): the same figure
 * resumes it; a new currency, amount or quote supersedes it, so an unpaid intent is cancelled rather
 * than paid at a price the buyer was no longer shown.
 */

const QUOTE = "7b4e2f10-9c3d-4a5b-8e6f-1a2b3c4d5e6f";
const NEWER = "0f0e0d0c-0b0a-4908-8706-050403020100";
const LINE = "8a1d2c3b-4e5f-4a6b-9c7d-0e1f2a3b4c5d";

const LINK: CheckoutOrderLink = {
	basketId: "55ed9bd6-ec5d-4937-a473-6140d634d1e9",
	itemIds: [LINE],
	currency: "USD",
	units: { [LINE]: 5_000 },
	promoCode: null,
	orderKey: "co_test_attempt_1",
	fxQuoteId: QUOTE,
};

const LIVE: InboundPayment = {
	id: "b5121fc8-ee24-48ac-ab0f-9d07f0a6748a",
	purpose: "wallet_topup",
	walletId: "9bc97e73-5ac6-487a-a2a7-1d156c8ac784",
	projectStageId: null,
	amountCents: 4_060,
	currency: "GBP",
	amountReceivedCents: null,
	status: "requires_payment",
	lockStatus: "not_applicable",
	lockError: null,
	lockedEscrowIds: [],
	provider: "stripe",
	providerRef: "pi_live",
	idempotencyKey: "card-co_test_attempt_1",
	transactionId: null,
	failureReason: null,
	livemode: null,
	createdBy: "de29f2ce-0f36-4db5-a417-4edc88cedf83",
	checkout: LINK,
	fxQuoteId: QUOTE,
	refundedCents: 0,
	refundUnrecoveredCents: 0,
	createdAt: "2026-11-16T10:00:00Z",
	updatedAt: "2026-11-16T10:00:00Z",
	succeededAt: null,
};

const UNQUOTED: CheckoutOrderLink = { ...LINK, fxQuoteId: undefined };

Deno.test("#435: the same charge on the same quote resumes the live payment", () => {
	assertEquals(supersedes({ ...LIVE }, LINK, LIVE), false);
});

Deno.test("#435: a new currency, amount or quote supersedes the live payment", () => {
	assertEquals(supersedes({ ...LIVE, currency: "USD", amountCents: 5_000 }, UNQUOTED, LIVE), true);
	assertEquals(supersedes({ ...LIVE, amountCents: 4_061 }, LINK, LIVE), true);
	assertEquals(supersedes({ ...LIVE }, { ...LINK, fxQuoteId: NEWER }, LIVE), true);
});

Deno.test("#435: a live payment with no quote is superseded by one that converts, and resumed by one that does not", () => {
	const plain: InboundPayment = { ...LIVE, checkout: UNQUOTED, fxQuoteId: null };
	assertEquals(supersedes({ ...plain }, LINK, plain), true);
	assertEquals(supersedes({ ...plain }, UNQUOTED, plain), false);
});
