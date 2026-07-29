import { currencyExponent } from "../types/wallet-types.ts";

/**
 * money-format — presentation-only helpers for rendering a server-formatted {@link MoneyView}.
 *
 * RULE D-1 (BUILD CONTRACT §3.5): the client FORMATS money and computes display *ratios*. It never
 * computes a balance, a total, a split, a fee, a rate, or a currency string. Everything here either
 * SPLITS a string the server already produced, or interpolates between two amounts the server
 * already sent — the final frame always writes the server's own string verbatim.
 */

// #region Splitting a server-formatted amount
/** The parts of a formatted amount, so pence can be de-emphasised without re-composing the string. */
export interface MoneyParts {
	/** Everything before the first digit — "£", "€", "US$", or "" for a suffix-currency locale. */
	symbol: string;
	/** The major units WITH their group separators, e.g. "4,826". */
	major: string;
	/** The minor units and their separator, e.g. ".40" — `null` for a zero-decimal currency. */
	minor: string | null;
	/** Anything trailing the number (a suffixed currency code/symbol), e.g. " kr". */
	suffix: string;
}

/**
 * Split a server-formatted currency string into symbol / major / minor / suffix.
 *
 * Deliberately a STRING SPLIT, never a re-format: `Intl` has already applied the locale's grouping,
 * symbol position and decimal separator, and re-deriving any of that on the client is how SSR and
 * the hydrated island drift apart. The minor part is recognised as the LAST separator followed by
 * exactly `currencyExponent(code)` digits at the end of the numeric run; a zero-decimal currency
 * (JPY, KRW) correctly yields `minor: null`.
 */
export function splitMinor(display: string, code: string): MoneyParts {
	const exp = currencyExponent(code);
	// The numeric run: digits plus the separators a locale may place inside a number.
	const match = /[\d][\d\s.,  ']*[\d]|\d/.exec(display);
	if (!match) return { symbol: "", major: display, minor: null, suffix: "" };

	const start = match.index;
	const end = start + match[0].length;
	const symbol = display.slice(0, start);
	const suffix = display.slice(end);
	let number = match[0];
	let minor: string | null = null;

	if (exp > 0) {
		const tail = new RegExp(`[.,]\\d{${exp}}$`).exec(number);
		if (tail) {
			minor = tail[0];
			number = number.slice(0, tail.index);
		}
	}
	return { symbol, major: number, minor, suffix };
}

/**
 * Re-assemble {@link splitMinor}'s parts around a replacement major run — used ONLY by the count-up,
 * so an intermediate frame keeps the server string's symbol placement and suffix. The final frame
 * writes `MoneyView.display` itself, so no interpolated string ever survives to rest.
 */
export function composeParts(parts: MoneyParts, major: string, minor: string | null): string {
	return `${parts.symbol}${major}${minor ?? ""}${parts.suffix}`;
}
// #endregion

// #region Count-up
/** `easeOutCubic` — decelerating, no overshoot, matching the over-damped motion contract (§B.5). */
export function easeOutCubic(t: number): number {
	return 1 - Math.pow(1 - t, 3);
}

/**
 * Group the integer part of a number the way the server's own string was grouped, by reusing that
 * string's separator positions. Keeps an interpolating frame visually stable (no jumping commas)
 * without the client owning a locale rule.
 */
export function groupLike(sample: string, value: number): string {
	const sep = /[\s.,  ']/.exec(sample.replace(/^\D+/, ""));
	const raw = String(Math.max(0, Math.trunc(value)));
	if (!sep) return raw;
	const s = sep[0];
	let out = "";
	for (let i = 0; i < raw.length; i++) {
		if (i > 0 && (raw.length - i) % 3 === 0) out += s;
		out += raw[i];
	}
	return out;
}

/**
 * Drive a money count-up over `ms`, calling `onFrame` with the interpolated **integer major units**
 * only — minor units snap at completion (RULE M-2), because rolling pence reads as an odometer and
 * money must never appear to be spinning. Returns a cancel function. A caller under reduced motion
 * must not start this at all; it jumps to the final state instead.
 */
export function countUp(
	toMinor: number,
	exp: number,
	ms: number,
	onFrame: (majorUnits: number) => void,
	onDone: () => void,
): () => void {
	if (typeof requestAnimationFrame !== "function" || ms <= 0) {
		onDone();
		return () => {};
	}
	const target = toMinor / 10 ** exp;
	let raf = 0;
	let start = 0;
	let cancelled = false;

	const step = (ts: number) => {
		if (cancelled) return;
		if (!start) start = ts;
		const t = Math.min(1, (ts - start) / ms);
		if (t >= 1) {
			onDone();
			return;
		}
		onFrame(target * easeOutCubic(t));
		raf = requestAnimationFrame(step);
	};
	raf = requestAnimationFrame(step);

	return () => {
		cancelled = true;
		if (raf) cancelAnimationFrame(raf);
	};
}
// #endregion

// #region Environment
/**
 * Whether the viewer has asked for reduced motion — the media query AND the design-system attribute
 * (`data-motion="reduced"`), since the token layer only covers the media query. SSR-safe.
 */
export function prefersReducedMotion(): boolean {
	if (typeof document === "undefined") return true;
	if (document.documentElement.dataset.motion === "reduced") return true;
	return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
// #endregion
