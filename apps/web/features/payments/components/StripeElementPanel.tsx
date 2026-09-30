import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Alert } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import {
	appearanceFromTokens,
	loadStripe,
	type StripeElements,
	type StripeJs,
	type StripePaymentElement,
} from "../core/stripe-js.ts";
import "../styles/stripe-element.css";

// #region Types
/** What happened when the person pressed the confirm button. */
export type StripeConfirmOutcome =
	| { ok: true; status: string; id: string }
	| { ok: false; message: string };

/** Props for {@link StripeElementPanel}. */
export interface StripeElementPanelProps {
	/** `payment` confirms a PaymentIntent (a charge); `setup` confirms a SetupIntent (a saved card). */
	mode: "payment" | "setup";
	/** The intent's client secret, from the server's handoff. Never stored, never logged. */
	clientSecret: string;
	/** The publishable key from the same handoff (`null` when the server has none for this mode). */
	publishableKey: string | null;
	/** The confirm button's label, e.g. "Pay £40.00" or "Save card". */
	submitLabel: string;
	/**
	 * Where Stripe returns a browser after a redirect-based step (3-D Secure on some banks, a bank
	 * redirect): a same-origin path. Most cards confirm in place and never leave the page.
	 */
	returnPath: string;
	/** Called once with the outcome; the surface decides what "done" means (poll, confirm, close). */
	onOutcome: (outcome: StripeConfirmOutcome) => void;
	/** Whether a surrounding action is in flight (disables the button). */
	busy?: boolean;
}
// #endregion

/**
 * The Stripe Payment Element, and the one button that confirms it.
 *
 * The card (or Apple Pay / Google Pay, where the device supports them) is entered inside Stripe's own
 * iframe — the number never reaches Projective's DOM, network or server. This component only mounts the
 * Element, forwards the confirm, and reports the outcome; money is recorded exclusively by the signed
 * webhook (a charge) or the server's re-read of the SetupIntent (a saved card), never on the browser's
 * word. `useEffect`/`useRef` are the sanctioned exception for an external, non-reactive DOM library
 * (root CLAUDE.md §3).
 */
export function StripeElementPanel(props: StripeElementPanelProps): JSX.Element {
	const mount = useRef<HTMLDivElement>(null);
	const stripe = useRef<StripeJs | null>(null);
	const elements = useRef<StripeElements | null>(null);
	const ready = useSignal(false);
	const complete = useSignal(false);
	const confirming = useSignal(false);
	const error = useSignal<string | null>(null);

	useEffect(() => {
		let element: StripePaymentElement | null = null;
		let cancelled = false;
		ready.value = false;
		error.value = null;
		loadStripe(props.publishableKey).then((client) => {
			if (cancelled || !mount.current) return;
			stripe.current = client;
			const group = client.elements({
				clientSecret: props.clientSecret,
				appearance: appearanceFromTokens(),
			});
			elements.current = group;
			element = group.create("payment", { layout: "tabs" });
			element.on("ready", () => (ready.value = true));
			element.on("change", (event) => (complete.value = event.complete === true));
			element.mount(mount.current);
		}).catch((reason) => {
			if (!cancelled) error.value = reason instanceof Error ? reason.message : "Couldn't load the card form.";
		});
		return () => {
			cancelled = true;
			element?.destroy();
			elements.current = null;
		};
	}, [props.clientSecret, props.publishableKey]);

	const confirm = async () => {
		const client = stripe.current;
		const group = elements.current;
		if (!client || !group || confirming.value) return;
		confirming.value = true;
		error.value = null;
		try {
			const submitted = await group.submit();
			if (submitted.error) {
				error.value = submitted.error.message ?? "Check the card details.";
				return;
			}
			const returnUrl = new URL(props.returnPath, globalThis.location.origin).toString();
			if (props.mode === "payment") {
				const result = await client.confirmPayment({
					elements: group,
					redirect: "if_required",
					confirmParams: { return_url: returnUrl },
				});
				if (result.error) {
					error.value = result.error.message ?? "The payment didn't go through.";
					props.onOutcome({ ok: false, message: error.value });
					return;
				}
				props.onOutcome({ ok: true, status: result.paymentIntent?.status ?? "processing", id: result.paymentIntent?.id ?? "" });
			} else {
				const result = await client.confirmSetup({
					elements: group,
					redirect: "if_required",
					confirmParams: { return_url: returnUrl },
				});
				if (result.error) {
					error.value = result.error.message ?? "The card couldn't be saved.";
					props.onOutcome({ ok: false, message: error.value });
					return;
				}
				props.onOutcome({ ok: true, status: result.setupIntent?.status ?? "processing", id: result.setupIntent?.id ?? "" });
			}
		} finally {
			confirming.value = false;
		}
	};

	return (
		<div class="pay-element" aria-busy={!ready.value || confirming.value}>
			{!ready.value && !error.value && <p class="pay-element__loading">Loading the secure card form…</p>}
			<div class="pay-element__mount" ref={mount} data-ready={ready.value ? "true" : undefined} />
			{error.value && <Alert severity="danger" description={error.value} class="pay-element__error" />}
			<p class="pay-element__note">
				Card details go straight to Stripe, our payment processor. Projective never sees the card number.
			</p>
			<Button
				label={confirming.value ? "Confirming…" : props.submitLabel}
				variant="filled"
				disabled={!ready.value || !complete.value || confirming.value || props.busy === true}
				loading={confirming.value}
				onClick={() => void confirm()}
				class="pay-element__submit"
			/>
		</div>
	);
}
