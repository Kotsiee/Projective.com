import { useEffect } from "preact/hooks";
import { useSignalEffect } from "@preact/signals";
import type { FxRateTable } from "@projective/types/finance";
import {
	bootstrapCurrencyFromSsr,
	displayCurrency,
	displayLocale,
	fxTable,
	reprojectServerMoney,
} from "@web/features/shell/core/currency-state.ts";

export interface CurrencyBridgeProps {
	/** The SSR-resolved display currency (`ctx.state.currency`). */
	displayCurrency: string;
	/** The SSR-resolved BCP-47 locale. */
	locale: string;
	/** The SSR-resolved FX rate table. */
	table: FxRateTable | null;
}

/**
 * CurrencyBridge — the one always-mounted island that keeps money presentation coherent.
 *
 * It renders **nothing**. Two jobs:
 *
 *  1. **Bootstrap** the shared `@projective/ui/display` currency store from the values SSR already
 *     resolved, so the client's store and the server's rendering agree from the first frame rather
 *     than converging after a fetch.
 *  2. **Sweep** — whenever the display currency (or locale, or rate table) changes, re-project every
 *     server-rendered `[data-money]` figure in the document. Reactive `MoneyView` instances handle
 *     themselves via the signal and are skipped; see `currency-state.ts` for why both mechanisms
 *     exist and why the sweep must not touch a hydrated node.
 *
 * Mounted directly in `_app.tsx`, so it is present on **every** surface — public and
 * authed alike. That matters: a guest browsing Explore has money on screen and a currency cookie, and
 * a bridge that only existed inside the authed shell would leave exactly those figures stale.
 *
 * The sweep is skipped on the first run. SSR already painted every figure in this currency, so
 * rewriting them on mount would be pure work — and, worse, would briefly own nodes the sweep has no
 * business owning if an island had not yet flagged itself live.
 */
export default function CurrencyBridge(props: CurrencyBridgeProps): null {
	// Seed synchronously on mount, before the sweep effect below can observe a default-valued store.
	useEffect(() => {
		bootstrapCurrencyFromSsr({
			displayCurrency: props.displayCurrency,
			locale: props.locale,
			table: props.table,
		});
	}, [props.displayCurrency, props.locale, props.table]);

	useSignalEffect(() => {
		const code = displayCurrency.value;
		const locale = displayLocale.value;
		const table = fxTable.value;

		// `queueMicrotask` defers past the current render pass, so any `MoneyView` island hydrating in
		// the same tick has already stamped `data-money-live` and the sweep correctly skips it.
		// Without it, an island mounting on the very frame the currency changes could be swept AND
		// re-rendered, and the DOM write would land on a node Preact then re-owns.
		queueMicrotask(() => {
			if (code === props.displayCurrency && table === props.table) return;
			reprojectServerMoney(code, locale, table);
		});
	});

	return null;
}
