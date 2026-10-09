import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import { type StripeConfirmOutcome, useStripeIntent } from "../hooks/useStripeElement.ts";
import { StripeElementMount } from "./StripeElementMount.tsx";

export type { StripeConfirmOutcome } from "../hooks/useStripeElement.ts";

// #region Types
/** Props for {@link StripeElementPanel}. */
export interface StripeElementPanelProps {
	/** `payment` confirms a PaymentIntent (a charge); `setup` confirms a SetupIntent (a saved card). */
	mode: "payment" | "setup";
	/** The intent's client secret, from the server's handoff. Never stored, never logged. */
	clientSecret: string;
	/** The publishable key from the same handoff (`null` when the server has none for this mode). */
	publishableKey: string | null;
	/** The confirm button's label, e.g. "Pay £40.00". */
	submitLabel: string;
	/**
	 * Where Stripe returns a browser after a redirect-based step (3-D Secure on some banks, a bank
	 * redirect): a same-origin path. Defaults to the page in view with its query intact. Most cards
	 * confirm in place and never leave the page.
	 */
	returnPath?: string;
	/** Called once per confirmation with its outcome; the surface decides what "done" means. */
	onOutcome: (outcome: StripeConfirmOutcome) => void;
	/** Whether a surrounding action is in flight (disables the button). */
	busy?: boolean;
}
// #endregion

/**
 * An EXISTING intent's Payment Element with its confirm button in the body — the wallet's Top up card
 * step and a card checkout, where the charge is the region's one action and nothing else could own
 * it. A dialog that saves a card instead composes `useStripeCardSetup` + {@link StripeElementMount}
 * and puts its Save in the `footer` slot (DESIGN_SYSTEM §B.10.8).
 *
 * Money is recorded exclusively by the signed webhook (a charge) or the server's re-read of the
 * SetupIntent (a saved card), never on the browser's word.
 */
export function StripeElementPanel(props: StripeElementPanelProps): JSX.Element {
	const controller = useStripeIntent({
		mode: props.mode,
		clientSecret: props.clientSecret,
		publishableKey: props.publishableKey,
		returnPath: props.returnPath,
	});
	const confirming = controller.confirming.value;
	const submit = {
		label: confirming ? "Confirming…" : props.submitLabel,
		disabled: !controller.canConfirm.value || props.busy === true,
		loading: confirming,
		onClick: () => void controller.confirm().then(props.onOutcome),
		class: "pay-panel__submit",
	};
	return (
		<div class="pay-panel">
			<StripeElementMount controller={controller} />
			{props.mode === "payment"
				? <Button {...submit} variant="filled" severity="accent" rounded />
				: <Button {...submit} variant="filled" />}
		</div>
	);
}
