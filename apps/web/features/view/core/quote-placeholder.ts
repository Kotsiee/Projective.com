import type { LedgerPrice } from "./conversion-ledger.ts";

/** The placeholder a budget field shows when the listing states no figure in its currency. */
export const BUDGET_PLACEHOLDER = "Your figure";

/**
 * The "Rough budget" field's placeholder: the listing's current price as a bare figure in the field's
 * own currency (the field draws the symbol), `From …` when that price is only a range's floor. A
 * listing priced on request, or in another currency, falls back to {@link BUDGET_PLACEHOLDER}.
 */
export function quotePlaceholder(price: LedgerPrice, currency: string, locale?: string): string {
	const amount = price.amount;
	if (!amount || amount.currency.toUpperCase() !== currency.toUpperCase()) return BUDGET_PLACEHOLDER;
	const digits = new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions()
		.maximumFractionDigits ?? 2;
	const figure = new Intl.NumberFormat(locale, {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
	}).format(amount.minor / 10 ** digits);
	return price.isFloor ? `From ${figure}` : figure;
}
