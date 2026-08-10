import { computed, type ReadonlySignal, signal } from "@preact/signals";
import { createContext } from "preact";
import { useContext } from "preact/hooks";

/**
 * currency-store — the portable, signal-first presentation layer for money.
 *
 * One global store holds the viewer's display currency, their locale, and the FX rate table; every
 * {@link MoneyView} on the page reads it, so flipping the currency re-renders every figure at once
 * with no page load and no per-component wiring. This is the same shape as `@projective/ui/system`'s
 * `dsConfig` (a package-owned global signal the app writes to), for the same reason: a preference
 * that affects every surface cannot be threaded through props.
 *
 * ## Portability (the `packages/ui` contract)
 *
 * This module imports **only** `@preact/signals`. It deliberately does NOT import
 * `@projective/types/finance`, even though that package owns the same vocabulary — the UI package is
 * copy-paste-portable by contract (root CLAUDE.md §3). So the money shape here is STRUCTURAL
 * ({@link MoneyValue}), assignable from the Zod `MoneyView` without an adapter, exactly as
 * `PaymentCardData` is assignable from `SavedCard` (Decision #68). The duplication is one small,
 * well-tested arithmetic function and one exponent table; it is the price of the boundary, and both
 * sides are deterministic so a divergence would show up as a failing conversion test, not as drift
 * nobody notices.
 *
 * ## What this does NOT do
 *
 * It never decides what anyone is charged. A conversion here is a **read-time projection over an
 * immutable origin**: the origin `(minor, currency)` travels with every figure and is what gets
 * rendered when no rate is available. Settlement uses the FX snapshot committed on the row, server-
 * side, and nothing in this file can influence it.
 */

// #region Shapes
/** The origin `(amount, currency)` a figure was actually priced in. */
export interface MoneyOriginValue {
	minor: number;
	currency: string;
	/** Server-formatted origin label ("€1,200.00"). */
	display: string;
	/** The rate applied to reach the display amount (`display = origin × fxRate`). */
	fxRate: number;
}

/**
 * A money figure as the server resolved it. Structurally identical to the Zod
 * `@projective/types/finance` `MoneyView`, so a caller passes one straight in.
 */
export interface MoneyValue {
	minor: number;
	currency: string;
	display: string;
	origin: MoneyOriginValue | null;
}

/** `quote code → multiplier from base`. */
export interface CurrencyRateTable {
	base: string;
	rates: Record<string, number>;
	/** The newest observation instant in this table (ISO-8601). */
	asOf: string;
	/** Rate source — `seed` marks reference data rather than a live observation. */
	provider: string;
	/** Whether the table is old enough that derived figures should be disclosed as approximate. */
	stale: boolean;
}

/** The SSR-resolved values the app hands the store on boot. */
export interface CurrencyBootstrap {
	displayCurrency: string;
	locale: string;
	table: CurrencyRateTable | null;
}

/** A figure resolved for the current viewer — what {@link MoneyView} actually paints. */
export interface ProjectedMoney {
	/** The primary text: the amount in the viewer's display currency. */
	display: string;
	/** The currency {@link display} is expressed in. */
	currency: string;
	/** Integer minor units behind {@link display}. */
	minor: number;
	/** The origin label + code, when the figure was priced in another currency; else `null`. */
	origin: { display: string; currency: string; minor: number } | null;
	/** Whether a currency conversion was applied to reach {@link display}. */
	converted: boolean;
	/** The rate applied (`1` when not converted). */
	rate: number;
	/** The observation instant the rate came from, when known. */
	asOf: string | null;
}
// #endregion

// #region Exponents + formatting
/**
 * Minor-unit exponents that are NOT 2. Kept as an explicit list rather than asked of `Intl`: the
 * exponent decides where the decimal point goes, so it must be identical on the server and in the
 * browser, and ICU data can differ between runtimes. The default of 2 covers everything else.
 */
const EXPONENTS: Readonly<Record<string, number>> = Object.freeze({
	BIF: 0,
	CLP: 0,
	DJF: 0,
	GNF: 0,
	ISK: 0,
	JPY: 0,
	KMF: 0,
	KRW: 0,
	PYG: 0,
	RWF: 0,
	UGX: 0,
	UYI: 0,
	VND: 0,
	VUV: 0,
	XAF: 0,
	XOF: 0,
	XPF: 0,
	BHD: 3,
	IQD: 3,
	JOD: 3,
	KWD: 3,
	LYD: 3,
	OMR: 3,
	TND: 3,
});

/** The minor-unit exponent for a currency (default 2). */
export function currencyExponent(code: string): number {
	return EXPONENTS[(code ?? "").toUpperCase()] ?? 2;
}

/**
 * Format an integer minor-unit amount as a currency string via `Intl.NumberFormat`.
 *
 * Deterministic given `(minor, currency, locale)`, which is what lets SSR and a hydrated island paint
 * the same bytes. An unknown code falls back to a plain grouped number with the code appended, rather
 * than throwing — a figure that renders as "1,234.00 XYZ" is readable; one that throws takes the page
 * down.
 */
export function formatMoney(minor: number, code: string, locale: string): string {
	const exp = currencyExponent(code);
	const major = minor / 10 ** exp;
	try {
		return new Intl.NumberFormat(locale, {
			style: "currency",
			currency: code.toUpperCase(),
			minimumFractionDigits: exp,
			maximumFractionDigits: exp,
		}).format(major);
	} catch {
		return `${major.toFixed(exp)} ${(code ?? "").toUpperCase()}`;
	}
}
// #endregion

// #region Conversion
/**
 * The multiplier from `from` into `to`, or `null` when the table cannot answer.
 *
 * Identity → `1`; one side is the table's base → a single hop; otherwise triangulate through the
 * base. `null` means "do not convert" and must never be read as "assume 1" — see the module doc.
 */
export function resolveRate(
	table: Pick<CurrencyRateTable, "base" | "rates"> | null,
	from: string,
	to: string,
): number | null {
	const src = (from ?? "").toUpperCase();
	const dst = (to ?? "").toUpperCase();
	if (!src || !dst) return null;
	if (src === dst) return 1;
	if (!table) return null;

	const base = table.base.toUpperCase();
	if (src === base) {
		const direct = table.rates[dst];
		return typeof direct === "number" && direct > 0 ? direct : null;
	}
	if (dst === base) {
		const inverse = table.rates[src];
		return typeof inverse === "number" && inverse > 0 ? 1 / inverse : null;
	}

	const toBase = table.rates[src];
	const fromBase = table.rates[dst];
	if (typeof toBase !== "number" || toBase <= 0) return null;
	if (typeof fromBase !== "number" || fromBase <= 0) return null;
	return fromBase / toBase;
}

/**
 * Convert minor units across currencies whose exponents may differ.
 *
 * The exponent shift is the part that is easy to lose: 1000 JPY minor units is ¥1000, while 1000 GBP
 * minor units is £10.00, so a straight minor→minor multiply would inflate a yen figure a hundredfold.
 * Rounds exactly once, at the end — rounding twice accumulates a bias that surfaces as penny drift.
 */
export function convertMinorUnits(
	minor: number,
	rate: number,
	fromExponent: number,
	toExponent: number,
): number {
	const major = minor / 10 ** fromExponent;
	return Math.round(major * rate * 10 ** toExponent);
}
// #endregion

// #region The store
/** The DOM contract the app uses to pre-paint the store before hydration (see `bootstrapCurrency`). */
const ROOT_CURRENCY_ATTR = "currency";
const ROOT_LOCALE_ATTR = "currencyLocale";
const RATES_SCRIPT_ID = "pj-fx-rates";

/**
 * The narrowest possible view of the document this module touches.
 *
 * Declared structurally and read off `globalThis` rather than relying on the ambient DOM lib: this
 * file is otherwise runtime-agnostic (signals and arithmetic), and pulling `lib.dom` in for two
 * property reads would make it un-typecheckable in a non-DOM context — which is exactly where its
 * unit tests run.
 */
interface MinimalDocument {
	documentElement: { dataset: Record<string, string | undefined> };
	getElementById(id: string): { textContent: string | null } | null;
}

/** The document, when there is one. `null` on the server and in a test runner. */
function doc(): MinimalDocument | null {
	return (globalThis as { document?: MinimalDocument }).document ?? null;
}

/** The platform base — the fallback whenever nothing has been bootstrapped. */
export const BASE_CURRENCY = "GBP";
/** The fallback locale. */
export const BASE_LOCALE = "en-GB";

const currencySignal = signal<string>(BASE_CURRENCY);
const localeSignal = signal<string>(BASE_LOCALE);
const tableSignal = signal<CurrencyRateTable | null>(null);

/** The viewer's active display currency. Read by every {@link MoneyView}. */
export const displayCurrency: ReadonlySignal<string> = computed(() => currencySignal.value);
/** The viewer's active BCP-47 locale. */
export const displayLocale: ReadonlySignal<string> = computed(() => localeSignal.value);
/** The active FX rate table, or `null` before bootstrap. */
export const fxTable: ReadonlySignal<CurrencyRateTable | null> = computed(() => tableSignal.value);

/**
 * Seed the store from server-resolved values. Idempotent, so calling it from more than one island on
 * the same page is safe.
 *
 * The app calls this explicitly with its SSR values. As a fallback — for a page whose only money is
 * inside a component that hydrates before the app's bootstrap island does — {@link hydrateFromDom}
 * reads the same values off the document. Both paths write the same signals, so whichever lands first
 * wins and the second is a no-op.
 */
export function bootstrapCurrency(init: Partial<CurrencyBootstrap>): void {
	if (init.displayCurrency) currencySignal.value = init.displayCurrency.toUpperCase();
	if (init.locale) localeSignal.value = init.locale;
	if (init.table) tableSignal.value = init.table;
}

/** Set the active display currency. Every mounted figure re-renders; nothing is persisted here. */
export function setDisplayCurrency(code: string): void {
	const next = (code ?? "").trim().toUpperCase();
	if (next.length === 3 && next !== currencySignal.value) currencySignal.value = next;
}

/** Replace the active rate table (e.g. after fetching a base the SSR table did not carry). */
export function setRateTable(table: CurrencyRateTable | null): void {
	tableSignal.value = table;
}

/** Set the active locale. */
export function setDisplayLocale(locale: string): void {
	if (locale) localeSignal.value = locale;
}

/**
 * Read the pre-paint DOM contract the app writes in `_app.tsx`: `:root[data-currency]`,
 * `:root[data-currency-locale]`, and a `<script type="application/json" id="pj-fx-rates">` holding
 * the rate table. Mirrors how `data-theme` is pre-painted — the same first-paint discipline, for the
 * same reason: a figure that flashes the wrong currency is worse than one that takes a moment.
 *
 * SSR-safe (no-ops without a `document`) and never throws on malformed JSON.
 */
export function hydrateFromDom(): void {
	const document = doc();
	if (!document) return;

	const dataset = document.documentElement.dataset;
	const code = dataset[ROOT_CURRENCY_ATTR];
	const locale = dataset[ROOT_LOCALE_ATTR];
	if (code) currencySignal.value = code.toUpperCase();
	if (locale) localeSignal.value = locale;

	if (tableSignal.value) return;
	try {
		const el = document.getElementById(RATES_SCRIPT_ID);
		if (el?.textContent) tableSignal.value = JSON.parse(el.textContent) as CurrencyRateTable;
	} catch {
		// A malformed table means figures render in their origin currency — degraded, never wrong.
	}
}
// #endregion

// #region Request-scoped context (SSR)
/** The resolved presentation triple a subtree formats money with. */
export interface CurrencyView {
	displayCurrency: string;
	locale: string;
	table: CurrencyRateTable | null;
}

/**
 * The per-request currency, for **server rendering**.
 *
 * The signal store above cannot serve SSR: it is module-level, and a server process renders many
 * viewers' requests concurrently, so one request writing "EUR" into a shared signal would change what
 * another request is midway through rendering. That is a data race over money, and the fact that it
 * would only fire under concurrency is precisely what makes it unacceptable — it would pass every
 * manual test and mis-price a page in production.
 *
 * Preact context is request-scoped by construction (it lives in the render tree, not in a module), so
 * the app wraps each request's tree in a provider and every server-rendered figure below reads the
 * right currency with no prop threading.
 *
 * On the CLIENT, context does not cross an island boundary — each island is its own hydration root.
 * That is fine and intended: an island reads the signal store instead, which is what makes a currency
 * switch instant. So the resolution order in {@link useCurrencyView} is props → context → signals →
 * the figure's own currency, and each link covers exactly the case the one before it cannot.
 */
export const CurrencyContext = createContext<CurrencyView | null>(null);

/**
 * The **ambient** currency resolver — the host application's escape hatch for server rendering.
 *
 * Context alone is not sufficient here, and this was established by measurement, not assumption: in
 * this app a provider mounted at the document root is NOT visible to a server component rendered
 * deeper in the page, because an island boundary sits between them and the framework renders island
 * subtrees in a pass that does not carry the outer context. An app-side `useContext` probe placed
 * beside a money figure returned `null` while the same probe directly under the provider returned the
 * real value.
 *
 * So the host may install a resolver that answers "what is the current request's currency" by
 * whatever mechanism is actually reliable in its runtime — in this app, `AsyncLocalStorage`, which is
 * request-scoped across async boundaries and therefore safe under the concurrent rendering that makes
 * a module-level signal unusable on the server.
 *
 * Two properties keep this from being a back door: it is only ever READ during render, and it is
 * never set on the client (where the signal store is both correct and reactive). A host that installs
 * nothing gets exactly the previous behaviour.
 */
let ambientResolver: (() => CurrencyView | null) | null = null;

/** Install (or clear, with `null`) the host's request-scoped currency resolver. */
export function setAmbientCurrencyResolver(resolver: (() => CurrencyView | null) | null): void {
	ambientResolver = resolver;
}

/**
 * Resolve the currency, locale and table for one figure.
 *
 * In order: explicit props (a surface pinning an invoice to its own snapshot currency) → the request
 * context → the host's ambient resolver (server rendering) → the live signal store (a hydrated
 * island) → the figure's own currency, which means "do not convert" and is the right answer when
 * nothing has told us otherwise.
 *
 * Each link covers precisely the case the one before it cannot, and every one of them is total, so a
 * figure always renders — in the worst case in the currency it was priced in.
 */
export function useCurrencyView(
	overrides: Partial<CurrencyView>,
	fallbackCurrency: string,
): CurrencyView {
	const ctx = useContext(CurrencyContext);
	const ambient = ctx ?? ambientResolver?.() ?? null;
	return {
		displayCurrency: overrides.displayCurrency ?? ambient?.displayCurrency ??
			currencySignal.value ?? fallbackCurrency,
		locale: overrides.locale ?? ambient?.locale ?? localeSignal.value,
		table: overrides.table ?? ambient?.table ?? tableSignal.value,
	};
}
// #endregion

// #region Projection
/**
 * Resolve a figure for the current viewer.
 *
 * The rule, stated once: **the ORIGIN is the truth**. Whatever currency the server happened to
 * resolve `value` into, the amount that was actually priced, stored and agreed is `value.origin ??
 * value` — so that is what gets converted, never a previously-converted figure (converting a
 * conversion compounds two roundings and drifts).
 *
 * Three outcomes, checked in this order — the order is the point:
 *  1. the target is the currency the **server already resolved** → return the server's own `display`
 *     verbatim. The server converted using the authoritative snapshot rate, so re-deriving it here
 *     from a possibly-newer table would move the number under the reader for no reason, and would
 *     make SSR and hydration disagree byte-for-byte;
 *  2. the target IS the origin currency → the exact origin, with no estimate marker, because nothing
 *     about it is approximate;
 *  3. otherwise → the origin converted at the table's rate, marked `converted`.
 *
 * When no rate resolves, the ORIGIN is returned unchanged. Never a guessed rate, and never the origin
 * amount relabelled with the target's symbol — that is the one failure mode that yields a wrong number
 * instead of a missing one.
 */
export function projectMoney(
	value: MoneyValue,
	targetCurrency: string,
	locale: string,
	table: CurrencyRateTable | null,
): ProjectedMoney {
	const resolved = value.currency.toUpperCase();
	const target = (targetCurrency ?? "").toUpperCase() || resolved;
	const origin = value.origin
		? { minor: value.origin.minor, currency: value.origin.currency.toUpperCase() }
		: { minor: value.minor, currency: resolved };

	// (1) The server already answered this exact question. Trust it — it used the snapshot rate.
	if (target === resolved) {
		const disclose = value.origin && origin.currency !== resolved;
		return {
			display: value.display,
			currency: resolved,
			minor: value.minor,
			origin: disclose
				? { display: value.origin!.display, currency: origin.currency, minor: origin.minor }
				: null,
			converted: Boolean(disclose),
			rate: value.origin?.fxRate ?? 1,
			asOf: null,
		};
	}

	// (2) The viewer wants the currency this was actually priced in — an exact figure, no marker.
	if (origin.currency === target) {
		return {
			display: value.origin?.display ?? formatMoney(origin.minor, origin.currency, locale),
			currency: target,
			minor: origin.minor,
			origin: null,
			converted: false,
			rate: 1,
			asOf: null,
		};
	}

	const rate = resolveRate(table, origin.currency, target);
	if (rate === null) {
		// Unpriceable pair — show what we actually know, in the currency it is actually in.
		return {
			display: value.origin?.display ?? formatMoney(origin.minor, origin.currency, locale),
			currency: origin.currency,
			minor: origin.minor,
			origin: null,
			converted: false,
			rate: 1,
			asOf: null,
		};
	}

	const minor = convertMinorUnits(
		origin.minor,
		rate,
		currencyExponent(origin.currency),
		currencyExponent(target),
	);

	return {
		display: formatMoney(minor, target, locale),
		currency: target,
		minor,
		origin: {
			display: value.origin?.display ?? formatMoney(origin.minor, origin.currency, locale),
			currency: origin.currency,
			minor: origin.minor,
		},
		converted: true,
		rate,
		asOf: table?.asOf ?? null,
	};
}
// #endregion
