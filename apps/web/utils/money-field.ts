import { currencyExponent } from "@projective/types/finance";

/**
 * The shared `NumberInput` configuration for every MONEY field in the app (project setup, the
 * catalogue editor). Three decisions, each of which would otherwise be re-made per field and drift:
 *
 *  - **The leading adornment is the currency's own symbol**, which `NumberInput` derives from the
 *    code, and it is the ONLY place the currency appears — the box holds the bare figure, so there
 *    is nothing to type around and no second symbol to disagree with the first.
 *  - **Coarser travel** (`3` px per unit rather than the default `6`), because these fields run from
 *    a two-figure bonus to a six-figure budget. A scrub is the coarse approach; the exact figure is
 *    still typed, and typing is never snapped to the step grid.
 *  - **Whole units by default, pennies on Ctrl.** `step: 1` is what a stepper press, an arrow or a
 *    wheel notch moves; holding Ctrl (or Cmd) switches every one of them — and the scrub — to
 *    `precisionStep`, which is the currency's own minor unit (see {@link moneyDigits}).
 */
export const MONEY_FIELD = {
	mode: "currency",
	step: 1,
	min: 0,
	enableIconScrub: true,
	scrubPixelsPerStep: 3,
} as const;

/** The currency-dependent half of a money field's configuration. */
export interface MoneyDigits {
	currency: string;
	minFractionDigits: number;
	maxFractionDigits: number;
	/** One minor unit in major units — `0.01` for GBP, `1` for JPY, `0.001` for KWD. */
	precisionStep: number;
}

/**
 * The digits a money field shows and the fine step it takes, from the currency's own exponent rather
 * than an assumed 2, so a JPY field never offers pennies and a KWD field can land on its smallest unit.
 */
export function moneyDigits(currency: string): MoneyDigits {
	const exponent = currencyExponent(currency);
	return {
		currency,
		minFractionDigits: exponent,
		maxFractionDigits: exponent,
		precisionStep: 1 / 10 ** exponent,
	};
}
