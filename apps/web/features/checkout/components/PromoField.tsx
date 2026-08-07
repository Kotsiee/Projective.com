import type { JSX } from "preact";
import { Button, InputText } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { Amount } from "./Amount.tsx";
import { promoDraft } from "../core/basket-state.ts";
import type { AppliedPromo } from "../types/checkout-types.ts";

/**
 * PromoField — the basket-wide discount code.
 *
 * The code is TYPED here and RESOLVED there: the field never decides whether a code is real, what it
 * is worth, or whether it beats a creator discount already on a line. It posts the string and renders
 * the {@link AppliedPromo} that comes back — including the refused one, which arrives as a resolved
 * promo carrying its own reason rather than as a failure. That distinction is the whole point of the
 * shape: "EXPIRED24 · Spring sale — expired on 30 June" tells the buyer something, where a total that
 * simply failed to move tells them nothing.
 *
 * A refusal is announced (`role="alert"`) because it answers something the reader just did; an applied
 * saving is polite (`role="status"`) because the totals visibly moving is the primary channel and a
 * second assertive interruption would talk over it.
 *
 * This is a field with a commit control, not a call to action: it acts on the basket the body is
 * already showing, exactly as the per-line address field does. Every action that moves the reader
 * onward or moves money lives in the footer band.
 */

// #region Props
/** Props for {@link PromoField}. */
export interface PromoFieldProps {
	/** The promo the server has attached to this basket, valid or refused. */
	promo: AppliedPromo | null;
	/** Whether a promo write is in flight. */
	busy: boolean;
	/** Submit the typed code, or `null` to clear the applied one. */
	onApply: (code: string | null) => void;
}
// #endregion

export function PromoField(props: PromoFieldProps): JSX.Element {
	const { promo, busy } = props;
	const applied = promo?.valid === true;

	const submit = (event: JSX.TargetedEvent<HTMLFormElement>) => {
		event.preventDefault();
		const code = promoDraft.value.trim();
		if (code === "" || busy) return;
		props.onApply(code);
	};

	return (
		<section class="bsk-promo" aria-labelledby="bsk-promo-head">
			<h2 class="bsk-promo__head" id="bsk-promo-head">Discount code</h2>

			<form class="bsk-promo__form" onSubmit={submit}>
				<label class="bsk-promo__label" for="bsk-promo-code">Have a code?</label>
				<div class="bsk-promo__controls">
					<InputText
						id="bsk-promo-code"
						size="sm"
						fluid
						class="bsk-promo__field"
						placeholder="SUMMER20"
						autoComplete="off"
						value={promoDraft}
						disabled={busy}
					/>
					<Button
						type="submit"
						variant="outlined"
						severity="primary"
						size="sm"
						loading={busy}
						disabled={busy}
					>
						Apply
					</Button>
				</div>
			</form>

			{promo && (
				<p
					class="bsk-promo__applied"
					data-valid={applied ? "true" : "false"}
					role={applied ? "status" : "alert"}
				>
					<Icon name={applied ? "success" : "warning"} size="xs" />
					<span class="bsk-promo__applied-label">{promo.label}</span>
					{applied
						? (
							<span class="bsk-promo__applied-amount">
								<Amount
									value={promo.amount}
									sign="−"
									tone="credit"
									srLabel={`Minus ${promo.amount.display}`}
								/>
							</span>
						)
						: (
							<span class="bsk-promo__applied-message">
								{promo.message ?? "That code could not be applied to this basket."}
							</span>
						)}
					<Button
						variant="text"
						severity="secondary"
						size="sm"
						disabled={busy}
						aria-label={`Remove the code ${promo.code}`}
						onClick={() => props.onApply(null)}
					>
						Remove
					</Button>
				</p>
			)}
		</section>
	);
}
