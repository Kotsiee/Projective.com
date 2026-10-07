import type { JSX } from "preact";
import { Alert } from "@projective/ui/feedback";
import type { StripeElementController } from "../hooks/useStripeElement.ts";
import "../styles/stripe-element.css";

/** Props for {@link StripeElementMount}. */
export interface StripeElementMountProps {
	/** The controller from `useStripeCardSetup` / `useStripeIntent` that owns the Element. */
	controller: StripeElementController;
	/** Extra class(es) on the frame. */
	class?: string;
}

/**
 * The frame Stripe's Payment Element mounts into: a loading line until Stripe's iframe is ready, the
 * mount node, Stripe's own error text in an Alert, and one line saying where the card goes. There is
 * no card-number, expiry or CVV field here and nowhere to add one — the card is typed into Stripe's
 * iframe. The confirming control belongs to the host (a dialog's `footer`), which reads the same
 * controller.
 *
 * Test hooks: `.pay-element[data-state="ready"]`, `.pay-element__mount[data-ready="true"]`, and
 * Stripe's iframe inside `.pay-element__mount`.
 */
export function StripeElementMount(
	{ controller, class: className }: StripeElementMountProps,
): JSX.Element {
	const ready = controller.ready.value;
	const error = controller.error.value;
	const state = ready ? "ready" : error ? "error" : "loading";
	return (
		<div
			class={className ? `pay-element ${className}` : "pay-element"}
			data-mode={controller.mode}
			data-state={state}
			aria-busy={state === "loading" || controller.confirming.value}
		>
			{state === "loading" && (
				<p class="pay-element__loading" role="status">Loading the secure card form…</p>
			)}
			<div
				class="pay-element__mount"
				ref={controller.mount}
				data-ready={ready ? "true" : undefined}
			/>
			{error && <Alert severity="danger" description={error} class="pay-element__error" />}
			<p class="pay-element__note">
				Card details go straight to Stripe — Projective never sees the number.
			</p>
		</div>
	);
}
