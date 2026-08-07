import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { Dialog } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { feeDisclosure, PROVIDER_LABEL } from "../core/checkout-model.ts";
import { Amount } from "./Amount.tsx";
import type { CheckoutSessionContext, SavedCard } from "../types/checkout-types.ts";

/**
 * ConfirmPayDialog — the last step before money moves.
 *
 * A modal rather than an inline confirm because the grammar is the point: it removes the escape route
 * deliberately, which is correct for an action that cannot be taken back and wrong for anything that
 * can. It mirrors the wallet's `ConfirmMoveModal`, which is the platform's established shape for an
 * irreversible money action, so a buyer meets one confirmation pattern rather than two.
 *
 * **The commit is not a safe primary.** A purchase is not destructive, so `danger` would overstate
 * it; it is also not routine, so the default filled primary — the same treatment as "Save" — would
 * understate it. `warning` is the register the platform already uses for a consequential gate, and
 * the button carries the exact server-formatted amount: a button reading "Confirm" asks the buyer to
 * remember what they were told, and one reading "Pay £1,225.00" does not.
 *
 * **The outcome is not shown here.** The dialog closes the moment a charge lands and the body's
 * result panel takes focus, so there is exactly one place an outcome is rendered — including
 * `requires_action`, whose hand-off link must survive the dialog being dismissed.
 */

// #region Props
/** Props for {@link ConfirmPayDialog}. */
export interface ConfirmPayDialogProps {
	/** Controlled visibility, so the body can close it when a result lands. */
	open: Signal<boolean>;
	/** The projection being confirmed — the source of every figure printed here. */
	session: CheckoutSessionContext;
	/** How many lines this payment covers. A count, never money. */
	lineCount: number;
	/** The card being charged, when the route is `card`. */
	card: SavedCard | null;
	/** Whether the charge is in flight. */
	busy: boolean;
	onConfirm: () => void;
}
// #endregion

/** How the money is leaving, in one phrase. */
function routeLabel(session: CheckoutSessionContext, card: SavedCard | null): string {
	const provider = session.provider;
	if (!provider) return "Not chosen yet";
	if (provider === "card" && card) {
		const tail = card.last4 ? ` ending ${card.last4}` : "";
		return `${PROVIDER_LABEL.card}${tail}`;
	}
	return PROVIDER_LABEL[provider];
}

/** Ask the buyer to commit. */
export function ConfirmPayDialog(props: ConfirmPayDialogProps): JSX.Element {
	const { open, session, lineCount, card, busy } = props;
	const fee = feeDisclosure(session.totals);

	const footer = (
		<div class="cko-confirm__foot">
			<Button
				variant="text"
				label="Back"
				disabled={busy}
				onClick={() => {
					open.value = false;
				}}
			/>
			<Button
				variant="filled"
				severity="warning"
				loading={busy}
				// The SERVER's string, printed verbatim. This dialog composes no figure of its own.
				label={busy ? "Taking payment…" : `Pay ${session.totals.total.display}`}
				onClick={props.onConfirm}
			/>
		</div>
	);

	return (
		<Dialog
			visible={open}
			modal
			role="alertdialog"
			class="cko-confirm"
			header="Confirm this payment"
			footer={footer}
			closable={!busy}
			closeOnEscape={!busy}
			dismissableMask={!busy}
		>
			<div class="cko-confirm__body">
				<p class="cko-confirm__figure">
					<Amount value={session.totals.total} size="hero" />
				</p>

				<dl class="cko-confirm__rows">
					<div class="cko-confirm__row">
						<dt class="cko-confirm__label">Paying from</dt>
						<dd class="cko-confirm__value">{session.owner.name}</dd>
					</div>
					<div class="cko-confirm__row">
						<dt class="cko-confirm__label">Method</dt>
						<dd class="cko-confirm__value">{routeLabel(session, card)}</dd>
					</div>
					<div class="cko-confirm__row">
						<dt class="cko-confirm__label">Covers</dt>
						<dd class="cko-confirm__value">
							{lineCount} {lineCount === 1 ? "item" : "items"}
						</dd>
					</div>
					{session.promo?.valid && (
						<div class="cko-confirm__row">
							<dt class="cko-confirm__label">{session.promo.label}</dt>
							<dd class="cko-confirm__value">
								−<Amount value={session.totals.promoDiscount} size="micro" tone="credit" />
							</dd>
						</div>
					)}
					<div class="cko-confirm__row">
						<dt class="cko-confirm__label">{fee.label}</dt>
						<dd class="cko-confirm__value">
							<Amount
								value={session.totals.platformFee}
								size="micro"
								tone={fee.charged ? "default" : "muted"}
							/>
							<span class="cko-confirm__hint">{fee.note}</span>
						</dd>
					</div>
				</dl>

				<p class="cko-confirm__warn">
					<Icon name="lock" />
					<span>Once confirmed, this payment can't be reversed from here.</span>
				</p>
			</div>
		</Dialog>
	);
}
