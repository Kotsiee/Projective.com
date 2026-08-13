import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import "../styles/money-view.css";
import { cx } from "../../core/cx.ts";
import {
	BASE_CURRENCY,
	type CurrencyRateTable,
	formatMoney,
	type MoneyValue,
	type ProjectedMoney,
	projectMoney,
	splitMoney,
	useCurrencyView,
} from "../core/currency-store.ts";

/**
 * MoneyView — the single way a money figure reaches the screen.
 *
 * ## One component, three ways of learning the currency
 *
 * There is deliberately no separate "static" and "live" variant to keep in step. This single component
 * resolves its currency through {@link useCurrencyView}: explicit props → the request context (server
 * rendering) → the shared signal store (a hydrated island) → the figure's own currency.
 *
 * That makes it correct in all three places a money figure appears. In a **server component** it paints
 * the viewer's currency in the first byte from the request context, runs no client JS, and is updated
 * on a later currency switch by the app's DOM sweep. Inside a **hydrated island** it reads the store,
 * so a switch re-renders it instantly. Given **explicit props** it converts nothing it was not told to.
 *
 * ## The dual-currency rule
 *
 * The viewer's currency is the PRIMARY text. When the figure was priced in a different currency, an
 * estimate indicator follows it carrying the origin: `£78.50 (~€90.00 EUR)`.
 *
 * The origin is always shown, never hidden behind a hover — a hover is not available on touch, is not
 * discoverable, and this is the fact that tells a reader whether the number they are looking at is
 * exact. The visible marker is the tilde; the full statement ("approximately £78.50, converted from
 * €90.00 EUR at 0.872") lives in the accessible label and the `title`, because the compact form has
 * room for the two amounts but not for which of them is authoritative.
 *
 * A same-currency figure renders with no marker at all. Nothing about it is approximate, and a
 * "(~£12.00 GBP)" tail beside £12.00 would manufacture doubt about an exact number.
 *
 * ## The data attributes
 *
 * Every instance emits `data-money` plus its origin `(minor, currency)`. That is the contract the
 * app's currency bridge uses to re-project figures rendered by *server* components — the ones with no
 * island of their own to re-render them — when the viewer switches currency. The island marks itself
 * `data-money-live` on mount so the bridge leaves reactive instances alone.
 */

/** Type scale. `hero` is a balance identity; `figure` a plate headline; `micro` a dense table cell. */
export type MoneySize = "hero" | "figure" | "key" | "body" | "micro";

/** Semantic tone. `debit` is deliberately neutral — a debit is a movement, not a failure. */
export type MoneyTone = "default" | "credit" | "debit" | "fee" | "muted";

export interface MoneyViewProps {
	/**
	 * The server-resolved figure. Structurally the Zod `MoneyView` from `@projective/types/finance`,
	 * so a caller passes one straight in.
	 *
	 * Mutually exclusive with {@link minor} + {@link currency}, which are the shorthand for a plain
	 * priced amount that never went through the wallet projection (an Explore card, a catalogue price).
	 */
	value?: MoneyValue;
	/** Shorthand: an integer minor-unit amount. Used with {@link currency} when {@link value} is absent. */
	minor?: number;
	/** Shorthand: the ISO-4217 currency {@link minor} is priced in. */
	currency?: string;
	/** The viewer's display currency. The island supplies this from the store. */
	displayCurrency?: string;
	/** The BCP-47 locale to format with. The island supplies this from the store. */
	locale?: string;
	/** The FX table used to convert. Without one, a cross-currency figure renders in its origin. */
	table?: CurrencyRateTable | null;
	/** Type scale (default `body`). */
	size?: MoneySize;
	/** Semantic tone (default `default`). */
	tone?: MoneyTone;
	/** A leading `+`/`−`. Presentational only — amounts are unsigned with a separate direction. */
	sign?: "+" | "−" | null;
	/** Suppress the origin disclosure (a dense table that discloses once in its own header). */
	hideOrigin?: boolean;
	class?: string;
}

/** Normalise the two input forms into one {@link MoneyValue}. */
function toValue(props: MoneyViewProps, locale: string): MoneyValue {
	if (props.value) return props.value;
	const currency = (props.currency ?? BASE_CURRENCY).toUpperCase();
	const minor = props.minor ?? 0;
	return { minor, currency, display: formatMoney(minor, currency, locale), origin: null };
}

/**
 * The spoken form. Names which figure is the estimate and which is exact, in that order, because the
 * compact visual cannot: a screen-reader user hears "approximately £78.50, converted from €90.00
 * EUR" and knows immediately that the euro amount is the agreed one.
 */
function spokenLabel(projected: ProjectedMoney): string {
	if (!projected.origin) return projected.display;
	const rate = projected.rate.toLocaleString("en-GB", { maximumFractionDigits: 6 });
	return `approximately ${projected.display}, converted from ${projected.origin.display} ${projected.origin.currency} at a rate of ${rate}`;
}

export function MoneyView(props: MoneyViewProps): JSX.Element {
	const own = (props.value?.currency ?? props.currency ?? BASE_CURRENCY).toUpperCase();
	const view = useCurrencyView(
		{ displayCurrency: props.displayCurrency, locale: props.locale, table: props.table },
		own,
	);

	const value = toValue(props, view.locale);
	const projected = projectMoney(value, view.displayCurrency, view.locale, view.table);
	const origin = props.hideOrigin ? null : projected.origin;

	const { size = "body", tone = "default", sign = null } = props;

	/*
	 * The figure is rendered in PARTS so the minor units can sit a step smaller and raised — the
	 * treatment the design uses on every price. It is a SPLIT of the string `Intl` already produced,
	 * never a re-format: see `splitMoney`. An unparseable string returns itself as `major`, so the
	 * fallback is exactly "render it unsplit".
	 *
	 * The parts must stay structural rather than cosmetic, because the app's currency sweep rebuilds
	 * this same subtree when it re-projects a server-rendered figure. If the two ever disagreed, a
	 * swept figure would lose its pence styling while the one beside it kept it.
	 */
	const parts = splitMoney(projected.display, projected.currency);

	// `data-money-live` tells the app's DOM sweep to leave this instance alone, because it will
	// re-render itself from the store. It can ONLY be set from an effect — which is exactly right:
	// an effect runs on hydration and never during SSR, so the flag answers "is this instance
	// actually reactive" with the one signal that genuinely knows, rather than with a guess.
	const host = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		if (host.current) host.current.dataset.moneyLive = "1";
	}, []);

	return (
		<span
			ref={host}
			class={cx("ui-money", `ui-money--${size}`, `ui-money--${tone}`, props.class)}
			// The bridge's contract: the immutable origin, so a re-projection never converts a
			// conversion. Read by `apps/web/features/shell/islands/CurrencyBridge` — see the class doc.
			data-money=""
			data-money-minor={value.origin?.minor ?? value.minor}
			data-money-currency={(value.origin?.currency ?? value.currency).toUpperCase()}
			data-money-size={size}
			// Carried so a re-projection cannot re-introduce a disclosure the caller suppressed.
			data-money-hide-origin={props.hideOrigin ? "1" : undefined}
			title={origin ? spokenLabel(projected) : undefined}
		>
			<span class="ui-money__amount ui-money__num" aria-hidden="true">
				{sign ? <span class="ui-money__sign">{sign}</span> : null}
				{parts.symbol ? <span class="ui-money__symbol">{parts.symbol}</span> : null}
				<span class="ui-money__major">{parts.major}</span>
				{parts.minor ? <span class="ui-money__minor">{parts.minor}</span> : null}
				{parts.suffix ? <span class="ui-money__symbol">{parts.suffix}</span> : null}
			</span>
			{origin
				? (
					<span class="ui-money__origin ui-money__num" aria-hidden="true">
						(~{origin.display} {origin.currency})
					</span>
				)
				: null}
			<span class="ui-visually-hidden">{spokenLabel(projected)}</span>
		</span>
	);
}
