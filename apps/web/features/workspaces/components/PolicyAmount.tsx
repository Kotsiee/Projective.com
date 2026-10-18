import type { JSX } from "preact";
import { cx } from "@ui/core/cx.ts";
import { currencyExponent, type MoneyView } from "@projective/types/finance";

/**
 * PolicyAmount — the way a {@link MoneyView} reaches the screen in the business money editors (the
 * spend envelopes, the approval queue, the finance summary).
 *
 * It renders the **server's own `display` string**, split only so the minor units can be de-emphasised
 * (baseline-aligned and smaller, never superscript — a raised minor run breaks tabular alignment down a
 * money column and reads as a retail price tag). It never formats, converts, rounds, totals or composes
 * a currency string: the client is forbidden from doing money arithmetic (root CLAUDE.md §12), so the
 * only transformation here is a string split whose parts re-concatenate to exactly what the server sent.
 */

// #region Splitting a server-formatted amount
/** The parts of a formatted amount, so the minor run can be de-emphasised without re-composing it. */
interface AmountParts {
	/** Everything before the first digit — `"£"`, `"US$"`, or `""` in a suffix-currency locale. */
	symbol: string;
	/** The major units WITH their locale group separators, e.g. `"4,826"`. */
	major: string;
	/** The minor run including its separator, e.g. `".50"` — `null` for a zero-decimal currency. */
	minor: string | null;
	/** Anything trailing the numeric run (a suffixed code or symbol), e.g. `" kr"`. */
	suffix: string;
}

/**
 * Split a server-formatted currency string into symbol / major / minor / suffix.
 *
 * Deliberately a STRING SPLIT and never a re-format: `Intl` has already applied the locale's grouping,
 * symbol position and decimal separator server-side, and re-deriving any of that on the client is how a
 * server-rendered figure and its hydrated counterpart drift apart. The minor run is recognised as the
 * last separator followed by exactly `currencyExponent(code)` digits at the end of the number, so a
 * zero-decimal currency (JPY, KRW) correctly yields `minor: null`.
 */
function splitAmount(display: string, code: string): AmountParts {
	const exponent = currencyExponent(code);
	const match = /[\d][\d\s.,  ']*[\d]|\d/.exec(display);
	if (!match) return { symbol: "", major: display, minor: null, suffix: "" };

	const start = match.index;
	const end = start + match[0].length;
	let number = match[0];
	let minor: string | null = null;

	if (exponent > 0) {
		const tail = new RegExp(`[.,]\\d{${exponent}}$`).exec(number);
		if (tail) {
			minor = tail[0];
			number = number.slice(0, tail.index);
		}
	}
	return { symbol: display.slice(0, start), major: number, minor, suffix: display.slice(end) };
}
// #endregion

// #region Component
export interface PolicyAmountProps {
	/** The server-computed figure. Rendered verbatim; never recomputed. */
	value: MoneyView;
	/**
	 * Type scale — `key` for a legend figure, `figure` for a band headline. Only those two shrink and
	 * fade the minor run; at `body` and `micro` it stays at full size and ink, as in `MoneyView`.
	 */
	size?: "figure" | "key" | "body" | "micro";
	/** Secondary tone, for a supporting figure that must not compete with the row's subject. */
	muted?: boolean;
	/** Overrides the spoken form. Defaults to the display string, which screen readers read well. */
	srLabel?: string;
	class?: string;
}

/** Render a server-computed money figure with its minor units de-emphasised. */
export function PolicyAmount(props: PolicyAmountProps): JSX.Element {
	const { value, size = "body", muted = false } = props;
	const parts = splitAmount(value.display, value.currency);
	const spoken = props.srLabel ?? null;

	return (
		<span
			class={cx(
				"wsp-money",
				`wsp-money--${size}`,
				muted && "wsp-money--muted",
				props.class,
			)}
		>
			<span aria-hidden={spoken ? "true" : undefined}>
				{parts.symbol && <span class="wsp-money__symbol">{parts.symbol}</span>}
				<span>{parts.major}</span>
				{parts.minor && <span class="wsp-money__minor">{parts.minor}</span>}
				{parts.suffix && <span class="wsp-money__symbol">{parts.suffix}</span>}
			</span>
			{spoken && <span class="ui-visually-hidden">{spoken}</span>}
		</span>
	);
}
// #endregion
