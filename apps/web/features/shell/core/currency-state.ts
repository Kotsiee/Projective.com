import {
	bootstrapCurrency,
	type CurrencyRateTable,
	displayCurrency,
	displayLocale,
	formatMoney,
	fxTable,
	type MoneyValue,
	projectMoney,
	resolveRate,
	setDisplayCurrency,
	setRateTable,
} from "@projective/ui/display/money";
import { toDisplayCurrency } from "@projective/types/finance";
import { LocalKeys, writeStored } from "@web/utils/storage-keys.ts";
import { CurrencyService } from "@web/features/shell/core/CurrencyService.ts";

/**
 * currency-state — the app-side half of the money-presentation layer.
 *
 * The store itself lives in `@projective/ui/display` (portable, signals only). This module owns the
 * three things the store deliberately does not: **persistence**, **the server round-trip**, and the
 * **DOM sweep** that keeps server-rendered figures in step with reactive ones.
 *
 * ## Why a DOM sweep exists at all
 *
 * A signal re-renders every figure inside a hydrated island for free. But a great many money figures
 * on this platform are rendered by *server components* — an Explore card, a catalogue row, a summary
 * plate — which have no island of their own and therefore no way to re-render. Making each of them an
 * island to solve this would mean hundreds of hydration roots on a feed page, which is a real cost
 * paid on every page load to serve an interaction most viewers use once.
 *
 * So: reactive instances re-render themselves (and flag `data-money-live` on mount to say so), and
 * this sweep rewrites the rest from their own `data-money-*` attributes. Both paths call the SAME
 * `projectMoney`, so a swept figure and a re-rendered one beside it cannot disagree.
 *
 * The sweep never touches a Preact-owned node. That is not a nicety: mutating the DOM under a
 * hydrated component desynchronises it from the VDOM, and the next unrelated re-render would silently
 * restore the old currency.
 */

// #region Persistence
/** The cookie the SERVER reads to paint the first byte in the right currency (see currency-context). */
const CURRENCY_COOKIE = "pj.currency";

/** One year, in seconds — a display preference should outlive a browsing session comfortably. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Persist the choice where the SERVER can see it.
 *
 * `localStorage` alone is not enough and never was: SSR cannot read it, so a page load would paint
 * every price in the platform base and only correct itself after hydration. The cookie is what makes
 * the first byte right. It is deliberately NOT HttpOnly — it carries no authority, only a formatting
 * preference, and the client half needs to write it. `SameSite=Lax` keeps it off cross-site requests.
 */
function persistCurrency(code: string): void {
	writeStored("local", LocalKeys.DISPLAY_CURRENCY, code);
	if (typeof document === "undefined") return;
	document.cookie = `${CURRENCY_COOKIE}=${
		encodeURIComponent(code)
	}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}
// #endregion

// #region Bootstrap
/** Seed the shared store from the values SSR resolved. Idempotent; safe from more than one island. */
export function bootstrapCurrencyFromSsr(
	init: { displayCurrency: string; locale: string; table: CurrencyRateTable | null },
): void {
	bootstrapCurrency(init);
}
// #endregion

// #region The DOM sweep
/** The spoken form — kept identical to `MoneyView`'s, so swept and rendered nodes read the same. */
function spokenLabel(
	display: string,
	origin: { display: string; currency: string } | null,
	rate: number,
): string {
	if (!origin) return display;
	const formatted = rate.toLocaleString("en-GB", { maximumFractionDigits: 6 });
	return `approximately ${display}, converted from ${origin.display} ${origin.currency} at a rate of ${formatted}`;
}

/**
 * Re-project every server-rendered money figure in the document into `code`.
 *
 * Reads each node's IMMUTABLE origin off its own `data-money-*` attributes rather than parsing the
 * text it currently shows. That is the difference between converting the original amount every time
 * and converting a conversion — the latter compounds a rounding error on each switch, so a viewer who
 * flipped GBP → EUR → GBP would land somewhere near, but not on, the price they started at.
 */
export function reprojectServerMoney(
	code: string,
	locale: string,
	table: CurrencyRateTable | null,
): void {
	if (typeof document === "undefined") return;
	const nodes = document.querySelectorAll<HTMLElement>("[data-money]:not([data-money-live])");

	for (const node of nodes) {
		const minor = Number.parseInt(node.dataset.moneyMinor ?? "", 10);
		const currency = (node.dataset.moneyCurrency ?? "").toUpperCase();
		if (!Number.isFinite(minor) || currency.length !== 3) continue;

		const amountEl = node.querySelector<HTMLElement>(".ui-money__amount");
		if (!amountEl) continue;

		// The sign is presentational and belongs to the caller, not to the amount — preserve it across
		// the rewrite rather than re-deriving it (a converted figure has no sign of its own).
		const signEl = amountEl.querySelector<HTMLElement>(".ui-money__sign");
		const sign = signEl?.textContent ?? "";

		// `display` must be a REAL formatted string, not a placeholder. `projectMoney`'s first branch —
		// "the target is already the currency this figure is in" — returns `display` verbatim, by
		// design, so that a server-converted figure is never silently re-derived from a client table.
		// Seeding `""` here therefore blanked every figure the moment a viewer switched TO the origin
		// currency (measured: USD went empty). The node's own truth in its own currency is exactly
		// `formatMoney(minor, currency, locale)`, so that is what gets passed.
		const value: MoneyValue = {
			minor,
			currency,
			display: formatMoney(minor, currency, locale),
			origin: null,
		};
		const projected = projectMoney(value, code, locale, table);

		amountEl.textContent = "";
		if (sign) {
			const span = document.createElement("span");
			span.className = "ui-money__sign";
			span.textContent = sign;
			amountEl.append(span);
		}
		amountEl.append(document.createTextNode(projected.display));

		const wantOrigin = projected.origin !== null && node.dataset.moneyHideOrigin !== "1";
		let originEl = node.querySelector<HTMLElement>(".ui-money__origin");
		if (wantOrigin) {
			if (!originEl) {
				originEl = document.createElement("span");
				originEl.className = "ui-money__origin ui-money__num";
				originEl.setAttribute("aria-hidden", "true");
				amountEl.after(originEl);
			}
			originEl.textContent = `(~${projected.origin!.display} ${projected.origin!.currency})`;
		} else {
			originEl?.remove();
		}

		const label = spokenLabel(
			projected.display,
			wantOrigin ? projected.origin : null,
			projected.rate,
		);
		const srEl = node.querySelector<HTMLElement>(".ui-visually-hidden");
		if (srEl) srEl.textContent = label;
		if (wantOrigin) node.title = label;
		else node.removeAttribute("title");
	}
}
// #endregion

// #region Commit
/**
 * Apply a display-currency change end to end.
 *
 * Order matters and is chosen so the viewer never waits on the network for a preference:
 *  1. **Optimistically** move the store + sweep the DOM — every figure on screen updates immediately;
 *  2. persist locally + to the cookie, so a navigation keeps the choice even if step 4 fails;
 *  3. fetch a rate table for the new currency IF the current one cannot price it (rare — the seeded
 *     table covers every offerable currency — but a table narrowed by a provider outage would not);
 *  4. PATCH the durable preference and **reconcile against what the server actually stored**.
 *
 * Step 4 is what makes this honest rather than merely fast: if the write failed, the returned
 * preferences will disagree, and the surface corrects itself rather than showing a currency that will
 * be gone on the next page load. `null` (an unreachable server) leaves the optimistic choice in place
 * — it is still persisted locally and in the cookie, so it is genuinely the viewer's currency for
 * this browser; only the cross-device copy is missing.
 *
 * Returns `true` when the server confirmed the change.
 */
export async function commitDisplayCurrency(requested: string): Promise<boolean> {
	const code = toDisplayCurrency(requested);
	const locale = displayLocale.value;

	setDisplayCurrency(code);
	persistCurrency(code);
	reprojectServerMoney(code, locale, fxTable.value);

	// A pair the current table cannot resolve renders in its origin currency — correct, but not what
	// was asked for. Re-base the table once and re-sweep rather than leaving the figure behind.
	const table = fxTable.value;
	if (table && resolveRate(table, table.base, code) === null) {
		const fresh = await CurrencyService.rates(code);
		if (fresh) {
			setRateTable(fresh);
			reprojectServerMoney(code, locale, fresh);
		}
	}

	const stored = await CurrencyService.setDisplayCurrency(code);
	if (!stored) return false;

	if (stored.displayCurrency.toUpperCase() !== code) {
		// The server stored something else. It wins — it is what the next page load will paint.
		const actual = stored.displayCurrency.toUpperCase();
		setDisplayCurrency(actual);
		persistCurrency(actual);
		reprojectServerMoney(actual, stored.locale || locale, fxTable.value);
		return false;
	}
	return true;
}

/** The store's live currency signal, re-exported so an island imports one module rather than two. */
export { displayCurrency, displayLocale, fxTable };
// #endregion
