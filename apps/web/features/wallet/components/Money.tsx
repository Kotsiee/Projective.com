import type { JSX } from "preact";
import { cx } from "@ui/core/cx.ts";
import { splitMinor } from "../core/money-format.ts";
import { fxNote } from "../core/hero-model.ts";
import type { MoneyView } from "../types/wallet-types.ts";

/**
 * Money — the single way a {@link MoneyView} reaches the screen on this surface.
 *
 * It renders the SERVER's `display` string, split so the minor units can be de-emphasised
 * (baseline-aligned at `--wlt-minor-size`, never superscript — a superscript breaks tabular
 * alignment and reads as a retail price tag). It never formats, converts, rounds or composes a
 * currency string (RULE D-1).
 *
 * Cross-currency figures disclose INLINE, never on hover: origin amount then rate, and nothing else.
 * There is deliberately no fee, spread, cost or saving element in this component or anywhere in the
 * BEM inventory — who bears the FX spread is an open business question, and rendering a placeholder
 * would be fabricating policy (BUILD CONTRACT §12.7).
 */
export interface MoneyProps {
	value: MoneyView;
	/** Type scale. `hero` is the balance identity; `key` a legend figure; `figure` a plate headline. */
	size?: "hero" | "figure" | "key" | "body" | "micro";
	/** Semantic tone. `debit` is deliberately neutral — a debit is a movement, not a failure. */
	tone?: "default" | "credit" | "debit" | "fee" | "dispute" | "muted";
	/** A leading `+`/`−`. Purely presentational; the server sends unsigned amounts with a direction. */
	sign?: "+" | "−" | null;
	/** Show the inline FX disclosure when the figure carries an origin. Defaults to `true`. */
	showFx?: boolean;
	/** Overrides the spoken form. Defaults to the `display` string, which screen readers speak well. */
	srLabel?: string;
	class?: string;
}

export function Money(props: MoneyProps): JSX.Element {
	const { value, size = "body", tone = "default", sign = null, showFx = true } = props;
	const parts = splitMinor(value.display, value.currency);
	const note = showFx ? fxNote(value) : null;

	return (
		<span class={cx("wlt-money", `wlt-money--${size}`, `wlt-money--${tone}`, props.class)}>
			<span class="wlt-money__amount wlt-num" aria-hidden={props.srLabel ? "true" : undefined}>
				{sign && <span class="wlt-money__sign">{sign}</span>}
				{parts.symbol && <span class="wlt-money__symbol">{parts.symbol}</span>}
				<span class="wlt-money__major">{parts.major}</span>
				{parts.minor && <span class="wlt-money__minor">{parts.minor}</span>}
				{parts.suffix && <span class="wlt-money__symbol">{parts.suffix}</span>}
			</span>
			{props.srLabel && <span class="ui-visually-hidden">{props.srLabel}</span>}
			{note && <span class="wlt-money__fx wlt-num">{note}</span>}
		</span>
	);
}
