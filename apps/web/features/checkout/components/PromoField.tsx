import type { JSX } from "preact";
import { Button, InputText } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { Amount } from "./Amount.tsx";
import { promoDraft } from "../core/basket-state.ts";
import type { AppliedPromo } from "../types/checkout-types.ts";

/**
 * PromoField — the basket-wide discount code, and the second of the two cards in the basket's right
 * rail.
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
 * ## The applied code is a chip, and the chip carries its own dismissal
 *
 * A resolved code is a thing now attached to the basket, so it reads as one object rather than as a
 * sentence with a "Remove" verb parked at the end of it: the code, and an `×` that detaches it. The
 * `×` is icon-only, so it carries an `aria-label`, a portal `Tooltip` and a hit target at the 24px
 * floor (WCAG 2.2 AA 2.5.8). The saving and the promo's own label sit beside the chip rather than
 * inside it — they are what the code DID, not part of its identity.
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
		<section class="bsk-promo" aria-labelledby="bsk-promo-label">
			<form class="bsk-promo__form" onSubmit={submit}>
				{
					/*
					 * The visible label IS the section's accessible name and the field's, bound by `for`/`id`
					 * rather than by proximity — one string, stated once, reachable both ways.
					 */
				}
				<label class="bsk-promo__label" id="bsk-promo-label" for="bsk-promo-code">
					Add promo/discount code
				</label>

				{
					/*
					 * The field and its commit control are sized as ONE object by `.bsk-promo__controls`,
					 * which sets the primitives' own `--field-*` / `--btn-*` channels. The `size` props below
					 * are the ramp those overrides start from, not the final geometry.
					 *
					 * `filled secondary` is the footer rig's neutral commit pill: a commit reads the same
					 * wherever it appears on this surface, and the amber stays unique to the CTA in the
					 * summary card above (§B.8.2 — one filled accent per decision region).
					 */
				}
				<div class="bsk-promo__controls">
					<InputText
						id="bsk-promo-code"
						size="sm"
						fluid
						class="bsk-promo__field"
						placeholder="Discount Code"
						autoComplete="off"
						value={promoDraft}
						disabled={busy}
					/>
					<Button
						type="submit"
						variant="filled"
						severity="secondary"
						size="sm"
						rounded
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
					<span class="bsk-promo__chip">
						<Icon name={applied ? "tag" : "warning"} size="2xs" />
						<span class="bsk-promo__chip-code">{promo.code}</span>
						<Tooltip content={`Remove ${promo.code}`} placement="top">
							<button
								type="button"
								class="bsk-promo__clear"
								disabled={busy}
								aria-label={`Remove the code ${promo.code}`}
								onClick={() => props.onApply(null)}
							>
								<Icon name="close" size="2xs" />
							</button>
						</Tooltip>
					</span>

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
				</p>
			)}
		</section>
	);
}
