import {
	type CheckoutFxQuote,
	DEFAULT_LOCALE,
	formatMoney,
	FX_CHECKOUT_OVERRIDE_HEADER,
	type FxConversionQuote,
	FxConversionQuoteSchema,
	type FxQuotePurpose,
	type MoneyView,
} from "@projective/types/finance";
import { getUserClient } from "../../core/supabase.ts";
import type { ReadActor } from "../read-actor.ts";
import { utcStamp } from "./commerce-money.ts";

/**
 * fx-quotes — the service half of paying in one's own currency (Decision #435): locking a conversion
 * quote through `finance.quote_fx_conversion` (or reusing one still comfortably inside its window),
 * reading one back for `create`, and stating it for the checkout. Every call runs as the caller, so
 * RLS (`fn_owner_visible`) decides which quotes are theirs; the database prices and refuses, this
 * module only maps its answers.
 */

// #region Shapes
/** What a quote is for: the account that pays, and the purchase it prices. */
export interface QuoteRequest {
	ownerType: string;
	ownerId: string;
	/** The currency the account pays in. */
	fromCurrency: string;
	/** The currency the order, stage, ticket or round is priced in. */
	toCurrency: string;
	/** Exactly what the conversion must deliver, in {@link toCurrency}'s minor units. */
	toMinor: number;
	purpose: FxQuotePurpose;
	refTable: "baskets" | "project_stages" | "tickets" | "revisions";
	refId: string;
}

/**
 * A locked quote, or why paying in the account's own currency is not possible now — `reason: null`
 * when it is simply not offered (switched off, or the door is not deployed), which is not news to a buyer.
 */
export type QuoteLock =
	| { ok: true; quote: FxConversionQuote }
	| { ok: false; reason: string | null };

/** A quote read back for a payment, and whether money has already arrived on it. */
export interface HeldQuote {
	quote: FxConversionQuote;
	/**
	 * A card payment started on it has succeeded (`succeeded` / `settled_unapplied`): that money arrived
	 * at this quote's rate, so the database honours the quote past its window (`fn_execute_fx_quote`).
	 */
	paid: boolean;
}
// #endregion

// #region Refusals
const FX_STALE =
	"Today's exchange rate isn't in yet. You can pay in the listing's currency, or try again later.";
const FX_NOT_SETTLED =
	"Projective can't convert between these two currencies yet. You can pay in the listing's currency.";
const FX_NOT_YOURS = "You can't pay in your own currency for this account.";

/** The buyer-facing sentence for a refusal of `finance.quote_fx_conversion`; `null` when it is not offered. */
function refusalOf(error: { code?: string; message?: string }): string | null {
	const message = error.message ?? "";
	if (error.code === "PX503" && message.startsWith("fx_rate_stale")) return FX_STALE;
	if (error.code === "PX422") return FX_NOT_SETTLED;
	if (error.code === "42501" || error.code === "PK403") return FX_NOT_YOURS;
	return null;
}
// #endregion

// #region Reads
/** Map a `finance.fx_quotes` row (snake_case, as PostgREST returns it) onto the SSOT shape. */
export function quoteOf(row: Record<string, unknown>): FxConversionQuote {
	return FxConversionQuoteSchema.parse({
		id: row.id,
		ownerType: row.owner_type,
		ownerId: row.owner_id,
		purpose: row.purpose,
		refTable: row.ref_table ?? null,
		refId: row.ref_id ?? null,
		fromCurrency: String(row.from_currency).trim(),
		toCurrency: String(row.to_currency).trim(),
		toMinor: Number(row.to_minor),
		principalMinor: Number(row.principal_minor),
		spreadBp: Number(row.spread_bp),
		spreadMinor: Number(row.spread_minor),
		fromMinor: Number(row.from_minor),
		fromRate: Number(row.from_rate),
		toRate: Number(row.to_rate),
		midRate: Number(row.mid_rate),
		rateAsOf: row.rate_as_of,
		rateProvider: row.rate_provider,
		createdBy: row.created_by,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		consumedAt: row.consumed_at ?? null,
	});
}

/** The card payment statuses whose money has arrived. */
const PAID_STATUSES = ["succeeded", "settled_unapplied"];

/** Errors that mean the FX tables or their link are not deployed here, which is not news. */
const NOT_DEPLOYED = ["42P01", "PGRST200", "PGRST205"];

/** Whether a quote row's embedded `inbound_payments` holds one whose money arrived. */
function paidOf(row: Record<string, unknown>): boolean {
	const embedded = row.inbound_payments;
	const payments = Array.isArray(embedded) ? embedded : embedded ? [embedded] : [];
	return payments.some((p) => PAID_STATUSES.includes(String((p as { status?: unknown }).status)));
}

/**
 * One of the caller's quotes with whether a card payment has paid on it, or `null` when it does not
 * exist, is not theirs, or cannot be read.
 */
export async function readQuote(
	actor: ReadActor,
	quoteId: string,
): Promise<HeldQuote | null> {
	if (!actor.accessToken) return null;
	const { data, error } = await getUserClient(actor.accessToken).schema("finance")
		.from("fx_quotes").select("*, inbound_payments(status)").eq("id", quoteId).maybeSingle();
	if (error) {
		console.error("[fx-quotes:read]", error.message);
		return null;
	}
	if (!data) return null;
	const row = data as Record<string, unknown>;
	return { quote: quoteOf(row), paid: paidOf(row) };
}
// #endregion

// #region Locking
/** A quote is reused only while it has this long left, so a buyer reading it has time to pay on it. */
const REUSE_MARGIN_MS = 5 * 60 * 1000;

/** How {@link lockQuote} may answer. */
export interface LockOptions {
	/**
	 * The paying wallet's Available in the request's `fromCurrency`. A quote a card payment has already
	 * paid on is offered again only while this still covers it; without it, never.
	 */
	availableMinor?: number;
	/** `false` always locks a new quote: one a card will be charged on, since a quote binds one payment. */
	reuse?: boolean;
	nowMs?: number;
}

/** The PostgREST headers that carry a development FX override to `finance.fn_dev_fx_checkout`, or none. */
function fxCheckoutHeaders(actor: ReadActor): Record<string, string> {
	return actor.fxCheckoutOverride
		? { [FX_CHECKOUT_OVERRIDE_HEADER]: actor.fxCheckoutOverride }
		: {};
}

/**
 * Lock a quote for this purchase. First, the account's unused quote for exactly the same request that a
 * card payment has already paid on, whatever its window, while the paying wallet still holds that
 * money: it arrived at that rate, so a retry of a purchase whose order or lock failed pays the figure
 * that was charged. Otherwise the caller's newest unused one while it has {@link REUSE_MARGIN_MS} left,
 * else a new one from `finance.quote_fx_conversion`. Never throws: a door that refuses, or is not
 * deployed, answers `{ ok: false, reason }`, and the checkout then offers the order's own currency only.
 * A development `off` override (Decision #436) answers that at once, so a quote locked before the switch
 * moved is not reused.
 */
export async function lockQuote(
	actor: ReadActor,
	request: QuoteRequest,
	options: LockOptions = {},
): Promise<QuoteLock> {
	if (!actor.accessToken || !actor.userId || actor.fxCheckoutOverride === "off") {
		return { ok: false, reason: null };
	}
	const db = getUserClient(actor.accessToken, fxCheckoutHeaders(actor)).schema("finance");
	const from = request.fromCurrency.toUpperCase();
	const to = request.toCurrency.toUpperCase();
	const nowMs = options.nowMs ?? Date.now();

	if (options.availableMinor !== undefined) {
		const paid = await db.from("fx_quotes").select("*, inbound_payments!inner(status)")
			.eq("owner_type", request.ownerType).eq("owner_id", request.ownerId)
			.eq("purpose", request.purpose).eq("ref_table", request.refTable).eq("ref_id", request.refId)
			.eq("from_currency", from).eq("to_currency", to).eq("to_minor", request.toMinor)
			.is("consumed_at", null).in("inbound_payments.status", PAID_STATUSES)
			.order("created_at", { ascending: false }).limit(1).maybeSingle();
		if (paid.error && !NOT_DEPLOYED.includes(paid.error.code ?? "")) {
			console.error("[fx-quotes:paid]", paid.error.message);
		}
		const quote = paid.data ? quoteOf(paid.data as Record<string, unknown>) : null;
		if (quote && quote.fromMinor <= options.availableMinor) return { ok: true, quote };
	}

	if (options.reuse !== false) {
		const reuse = await db.from("fx_quotes").select("*")
			.eq("owner_type", request.ownerType).eq("owner_id", request.ownerId)
			.eq("purpose", request.purpose).eq("ref_table", request.refTable).eq("ref_id", request.refId)
			.eq("from_currency", from).eq("to_currency", to).eq("to_minor", request.toMinor)
			.eq("created_by", actor.userId).is("consumed_at", null)
			.gt("expires_at", new Date(nowMs + REUSE_MARGIN_MS).toISOString())
			.order("created_at", { ascending: false }).limit(1).maybeSingle();
		if (reuse.error && !NOT_DEPLOYED.includes(reuse.error.code ?? "")) {
			console.error("[fx-quotes:reuse]", reuse.error.message);
		}
		if (reuse.data) return { ok: true, quote: quoteOf(reuse.data as Record<string, unknown>) };
	}

	const { data, error } = await db.rpc("quote_fx_conversion", {
		p_owner_type: request.ownerType,
		p_owner_id: request.ownerId,
		p_from_currency: from,
		p_to_currency: to,
		p_to_minor: request.toMinor,
		p_purpose: request.purpose,
		p_ref_table: request.refTable,
		p_ref_id: request.refId,
	});
	if (error) {
		const known = ["PX503", "PX500", "PX422", "42501", "PK403", "PGRST202"].includes(
			error.code ?? "",
		);
		if (!known) console.error("[fx-quotes:lock]", error.code, error.message);
		return { ok: false, reason: refusalOf(error) };
	}
	return { ok: true, quote: quoteOf(data as Record<string, unknown>) };
}
// #endregion

// #region Presentation
/** A figure stated in its own currency, never converted. */
function exact(minor: number, currency: string): MoneyView {
	return { minor, currency, display: formatMoney(minor, currency, DEFAULT_LOCALE), origin: null };
}

/** `1 GBP = 1.17 EUR` — the mid-market rate to four places, the platform's one rate grammar. */
export function rateLabelOf(
	quote: Pick<FxConversionQuote, "fromCurrency" | "toCurrency" | "midRate">,
): string {
	const rate = Math.round(quote.midRate * 10_000) / 10_000;
	return `1 ${quote.fromCurrency} = ${rate} ${quote.toCurrency}`.slice(0, 80);
}

/** `1.5% conversion margin` — the disclosed margin, stated before the buyer confirms (ruling M5 (d)). */
export function marginLabelOf(spreadBp: number): string {
	return spreadBp > 0 ? `${spreadBp / 100}% conversion margin` : "No conversion margin";
}

/** The quote as the checkout states it: exact figures in the buyer's currency and every label. */
export function checkoutFxQuoteOf(quote: FxConversionQuote): CheckoutFxQuote {
	return {
		quoteId: quote.id,
		fromCurrency: quote.fromCurrency,
		toCurrency: quote.toCurrency,
		principal: exact(quote.principalMinor, quote.fromCurrency),
		margin: exact(quote.spreadMinor, quote.fromCurrency),
		marginBp: quote.spreadBp,
		midRate: quote.midRate,
		rateLabel: rateLabelOf(quote),
		marginLabel: marginLabelOf(quote.spreadBp),
		asOf: quote.rateAsOf,
		asOfLabel: utcStamp(quote.rateAsOf),
		expiresAt: quote.expiresAt,
	};
}
// #endregion
