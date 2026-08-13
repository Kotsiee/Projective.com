import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import "../styles/checkout-stepper.css";
import { Select } from "@projective/ui/fields";
import { DISPLAY_CURRENCIES } from "@projective/types/finance";
import { commitDisplayCurrency, displayCurrency } from "@web/features/shell/core/currency-state.ts";

/**
 * CheckoutCurrencySelect — the display-currency control in the right slot of the checkout stepper
 * band.
 *
 * **It owns nothing.** The whole mechanism — optimistic store update, DOM sweep of server-rendered
 * figures, cookie + `localStorage` persistence, the `PATCH /api/user/preferences` round trip, and the
 * reconciliation against what the server actually stored — already lives in `commitDisplayCurrency`
 * (CLAUDE.md Decision #69). This island is a second *trigger* for that one function, not a second
 * implementation of it: a currency switcher that persisted differently from the header's would give
 * the platform two answers to "what currency is this viewer in", and the checkout is the last place
 * that should be true.
 *
 * That shared store is also why the acceptance criterion is met across all four steps for free.
 * Every figure on these surfaces is a `MoneyView`, so a change here re-renders the reactive ones
 * through the signal and re-projects the server-rendered ones through the sweep — including the
 * totals in the footer band and the lane, which are separate hydration roots.
 *
 * **The value must be bound as a Signal, never as a raw string.** The field primitives seed their
 * internal signal from a raw value exactly once (`useControllable` memoises on `[]`), so a raw prop
 * would show the SSR currency forever and silently disagree with the figures beside it the moment the
 * header's picker changed them.
 */

// #region Props
/** Props for {@link CheckoutCurrencySelect}. */
export interface CheckoutCurrencySelectProps {
	/**
	 * The currency SSR resolved. Seeds the control so the first byte is already right; the store then
	 * takes over, which is why this is a seed and not the source of truth.
	 */
	initial: string;
}
// #endregion

/** `🇬🇧 GBP (£)` — the brief's format. The flag is decoration and is hidden from assistive tech. */
function currencyRow(code: string, compact: boolean): JSX.Element {
	const entry = DISPLAY_CURRENCIES.find((c) => c.code === code);
	if (!entry) return <span class="cko-cur__row">{code}</span>;
	return (
		<span class="cko-cur__row">
			<span class="cko-cur__flag" aria-hidden="true">{entry.flag}</span>
			<span class="cko-cur__code">{entry.code}</span>
			<span class="cko-cur__symbol" aria-hidden="true">({entry.symbol})</span>
			{compact ? null : <span class="cko-cur__name">{entry.label}</span>}
		</span>
	);
}

export default function CheckoutCurrencySelect(
	props: CheckoutCurrencySelectProps,
): JSX.Element {
	const choice = useSignal(props.initial.toUpperCase());
	// A saving that could not be persisted is still the viewer's currency in THIS browser — the cookie
	// and localStorage both took it — so the control says exactly that rather than reverting a choice
	// the surface is visibly honouring.
	const localOnly = useSignal(false);

	// Track the shared store, so switching from the header's picker (or a revert after a failed save)
	// moves this control too. Without it the two controls drift and one of them is lying.
	useSignalEffect(() => {
		const live = displayCurrency.value.toUpperCase();
		if (live && live !== choice.peek()) choice.value = live;
	});

	return (
		<div class="cko-cur">
			<Select
				class="cko-cur__field"
				aria-label="Display currency"
				size="sm"
				value={choice}
				options={DISPLAY_CURRENCIES.map((c) => ({
					// `label` stays the plain, matchable text: it is what typeahead searches and what
					// assistive tech reads. The templates below are presentation only.
					label: `${c.code} — ${c.label}`,
					value: c.code,
				}))}
				valueTemplate={(opt) => currencyRow(String(opt.value), true)}
				optionTemplate={(opt) => currencyRow(String(opt.value), false)}
				onValueChange={(next) => {
					if (!next || next === displayCurrency.peek().toUpperCase()) return;
					choice.value = next;
					void commitDisplayCurrency(next).then((saved) => {
						localOnly.value = !saved;
					});
				}}
			/>
			{localOnly.value
				? (
					<p class="cko-cur__note" role="status">
						Saved on this device only.
					</p>
				)
				: null}
		</div>
	);
}
