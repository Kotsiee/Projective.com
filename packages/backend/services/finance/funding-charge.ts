import {
	DEFAULT_LOCALE,
	formatMoney,
	type FundingCharge,
	type MoneyView,
} from "@projective/types/finance";
import type { ReadActor } from "../read-actor.ts";
import { resolveOwner, walletBalances } from "./commerce-owner.ts";
import { checkoutFxQuoteOf, lockQuote } from "./fx-quotes.ts";
import { buyerDetailsFor } from "./live-buyer.ts";

/**
 * funding-charge — what funding a stage or a paid revision round charges its payer (Decision #436):
 * in their billing currency through locked quotes when that differs from the project's, else the
 * escrow's own amount. The payer, their billing currency and their wallets are the checkout's own reads
 * (`resolveOwner`, `buyerDetailsFor`, `walletBalances`), so a funding and a checkout cannot disagree
 * about who pays in what.
 */

// #region Shapes
/** What a funding pays for, and who pays for it. */
export interface FundingRequest {
	/** The project's payer: its client business, else the person who pays for it. */
	payer: { scope: "business" | "personal"; id: string };
	/** The escrow's own amount, in the project's currency. */
	listed: { minor: number; currency: string };
	refTable: "project_stages" | "revisions";
	refId: string;
	/** The currency the payer chose to pay in; absent, their billing currency. */
	payIn?: string | null;
	/** The paying wallet's balance in the project's currency, when the funding read already has it. */
	listedAvailableMinor?: number;
}

/** Every read {@link fundingChargeFor} makes; a test swaps fakes in ({@link setFundingIoForTesting}). */
export interface FundingIo {
	resolveOwner: typeof resolveOwner;
	buyerDetailsFor: typeof buyerDetailsFor;
	walletBalances: typeof walletBalances;
	lockQuote: typeof lockQuote;
}
// #endregion

const LIVE_IO: FundingIo = { resolveOwner, buyerDetailsFor, walletBalances, lockQuote };
let io: FundingIo = LIVE_IO;

/** Swap {@link fundingChargeFor}'s reads for a test; `undefined` restores the live ones. */
export function setFundingIoForTesting(next: Partial<FundingIo> | undefined): void {
	io = next ? { ...LIVE_IO, ...next } : LIVE_IO;
}

function exact(minor: number, currency: string): MoneyView {
	return { minor, currency, display: formatMoney(minor, currency, DEFAULT_LOCALE), origin: null };
}

/**
 * A funding charged in the project's own currency: the escrow's amount, `availableMinor` the paying
 * wallet's balance in it. `billing` is the payer's billing currency where it is known; `conversion`
 * and `reason` say whether paying in it is on offer, as {@link FundingCharge}'s `payIn` does.
 */
export function listedCharge(
	listed: { minor: number; currency: string },
	availableMinor: number,
	billing: string = listed.currency,
	conversion = false,
	reason: string | null = null,
): FundingCharge {
	const order = listed.currency.toUpperCase();
	const amount = exact(listed.minor, order);
	return {
		charge: { ...amount, quote: null },
		listed: amount,
		payIn: { selected: order, billing: billing.toUpperCase(), order, conversion, reason },
		walletAvailableMinor: availableMinor,
		cardQuoteId: null,
	};
}

/**
 * The charge for one funding. Paying in one's own currency is offered only to the payer (a member who
 * may spend from the client business, or the person who pays for the project) when their billing
 * currency differs from the project's and the quote door prices it. The wallet route's `funding` quote
 * is reused while it has time left; the card route's `escrow_lock` quote is new on every read, because
 * a quote binds one card payment, and it is offered only at the wallet quote's figure. Never throws: a
 * failed read answers the escrow's own amount.
 */
export async function fundingChargeFor(
	request: FundingRequest,
	actor: ReadActor,
): Promise<FundingCharge> {
	const order = request.listed.currency.toUpperCase();
	const listed = exact(request.listed.minor, order);
	const inListed = (
		billing: string,
		conversion: boolean,
		reason: string | null,
		available: number,
	): FundingCharge => listedCharge(request.listed, available, billing, conversion, reason);
	const fallback = request.listedAvailableMinor ?? 0;

	try {
		const owner = await io.resolveOwner({
			owner: request.payer.scope === "business" ? `business:${request.payer.id}` : "personal",
			display: order,
		}, actor);
		if (!owner || owner.ownerId !== request.payer.id || !owner.actingIsMember) {
			return inListed(order, false, null, fallback);
		}
		const [details, wallets] = await Promise.all([
			io.buyerDetailsFor(owner, actor, order),
			io.walletBalances(owner, actor),
		]);
		const billing = details.billingCurrency.toUpperCase();
		const inOrder = request.listedAvailableMinor ?? wallets.get(order) ?? 0;
		if (billing === order || request.listed.minor <= 0) {
			return inListed(billing, false, null, inOrder);
		}

		const quoteRequest = {
			ownerType: owner.ownerType,
			ownerId: owner.ownerId,
			fromCurrency: billing,
			toCurrency: order,
			toMinor: request.listed.minor,
			refTable: request.refTable,
			refId: request.refId,
		};
		const funding = await io.lockQuote(actor, { ...quoteRequest, purpose: "funding" });
		if (!funding.ok) return inListed(billing, false, funding.reason, inOrder);
		if ((request.payIn ?? billing).trim().toUpperCase() === order) {
			return inListed(billing, true, null, inOrder);
		}
		const card = await io.lockQuote(actor, { ...quoteRequest, purpose: "escrow_lock" }, {
			reuse: false,
		});
		const sameFigure = card.ok && card.quote.fromMinor === funding.quote.fromMinor &&
			card.quote.fromCurrency === funding.quote.fromCurrency;
		return {
			charge: {
				...exact(funding.quote.fromMinor, billing),
				quote: checkoutFxQuoteOf(funding.quote),
			},
			listed,
			payIn: { selected: billing, billing, order, conversion: true, reason: null },
			walletAvailableMinor: wallets.get(billing) ?? 0,
			cardQuoteId: sameFigure && card.ok ? card.quote.id : null,
		};
	} catch (error) {
		console.error("[funding-charge]", error instanceof Error ? error.message : error);
		return inListed(order, false, null, fallback);
	}
}
