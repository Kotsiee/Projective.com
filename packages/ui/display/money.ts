/**
 * `@projective/ui/display/money` — the money-presentation slice of `display`, as its own sub-path.
 *
 * It exists so a consumer can reach `MoneyView` and the currency store **without** importing the
 * `display` barrel. That barrel re-exports Table, Tree, TreeTable, OrgChart, Galleria, Carousel and
 * GMap; the app's currency bridge is mounted on every single page, so importing the barrel there
 * would drag all of them into the client bundle of every route on the platform to render a price.
 *
 * Same modules, same exports — a narrower door. `./display` still re-exports everything here, so a
 * surface already importing the barrel needs no change.
 */

export { MoneyView } from "./components/MoneyView.tsx";
export type { MoneySize, MoneyTone, MoneyViewProps } from "./components/MoneyView.tsx";
export {
	BASE_CURRENCY,
	BASE_LOCALE,
	bootstrapCurrency,
	convertMinorUnits,
	CurrencyContext,
	currencyExponent,
	displayCurrency,
	displayLocale,
	formatMoney,
	fxTable,
	hydrateFromDom,
	projectMoney,
	resolveRate,
	setAmbientCurrencyResolver,
	setDisplayCurrency,
	setDisplayLocale,
	setRateTable,
	useCurrencyView,
} from "./core/currency-store.ts";
export type {
	CurrencyBootstrap,
	CurrencyRateTable,
	CurrencyView,
	MoneyOriginValue,
	MoneyValue,
	ProjectedMoney,
} from "./core/currency-store.ts";
