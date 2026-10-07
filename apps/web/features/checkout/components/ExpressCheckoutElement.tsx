import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Icon } from "@projective/ui/icons";
import { PaymentsService } from "@features/payments/core/PaymentsService.ts";
import { appearanceFromTokens, loadStripe } from "@features/payments/core/stripe-js.ts";
import type { CardPaymentHandoff } from "@projective/types/finance";
import type { MoneyView, ProviderAvailability } from "../types/checkout-types.ts";

/**
 * ExpressCheckoutElement — Apple Pay, Google Pay and PayPal, drawn by Stripe (Decision #153).
 *
 * ## Stripe's buttons, not ours
 *
 * The step used to draw three hand-made vendor buttons from a block of quarantined hex colours, and
 * every one of them was refused in every environment. This mounts Stripe's Express Checkout Element
 * instead: the vendors' own marks, in each platform's own rendering, shown only where the device, the
 * browser and the account can actually pay with them. Which buttons appear is the Element's decision
 * and not this one's — a server cannot know whether this browser has Google Pay — so when it can show
 * none, the region says so in one line rather than leaving an unexplained gap.
 *
 * ## Deferred intent: the sheet shows the CHARGE
 *
 * The Element is mounted before any PaymentIntent exists (`mode: "payment"`, `amount`, `currency`),
 * and its amount is the session's `charge` — the order total in the listings' own currency, which is
 * what the processor actually takes. The wallet sheet is where the buyer agrees to that amount, so the
 * Element must show the figure that will be charged, not a converted display total. On `confirm`:
 *
 * 1. `elements.submit()` — the sheet's details are validated.
 * 2. `begin()` — the server re-prices the purchase and opens the PaymentIntent for the SAME `charge`
 *    (`CheckoutBackendService.create` with provider `express`); a refusal is reported back to the
 *    sheet with `paymentFailed` and in words on the page.
 * 3. `stripe.confirmPayment({ redirect: "if_required" })` — device wallets confirm in place; a
 *    redirect-based wallet (PayPal) leaves and returns to {@link ExpressCheckoutElementProps.returnPathFor},
 *    which names the payment so the page resumes it rather than starting again.
 *
 * Money is recorded only by the signed webhook; {@link ExpressCheckoutElementProps.onConfirmed} hands
 * over to the screen, which waits for that and then places the order.
 *
 * The Element is an external DOM library, which is the case an effect exists for: it is mounted into a
 * node this component owns, re-mounted when the charge changes, and destroyed on unmount.
 */

// #region Props
/** What {@link ExpressCheckoutElementProps.begin} answers: the intent to confirm, or a refusal. */
export type ExpressStart =
	| { ok: true; payment: CardPaymentHandoff }
	| { ok: false; message: string };

/** Props for {@link ExpressCheckoutElement}. */
export interface ExpressCheckoutElementProps {
	/** The server's offer for the `express` route; absent → no express region at all. */
	offer: ProviderAvailability | undefined;
	/** The amount the sheet shows and the processor takes — the session's `charge`. */
	charge: MoneyView | null;
	/** Something unrelated to the route blocks payment (a basket or details blocker). */
	blocked: boolean;
	/** Open the PaymentIntent server-side for this charge. */
	begin: () => Promise<ExpressStart>;
	/** Stripe confirmed in place: wait for the webhook, then place the order. */
	onConfirmed: (paymentId: string) => void;
	/** The same-origin path a redirect-based wallet returns to, naming the payment it is for. */
	returnPathFor: (paymentId: string) => string;
	/** Say something went wrong, in the buyer's words. Nothing was charged when this is called. */
	onError: (message: string) => void;
}
// #endregion

const LOAD_FAILED = "Express checkout couldn't load. Pay with your wallet or a card below.";

export function ExpressCheckoutElement(props: ExpressCheckoutElementProps): JSX.Element | null {
	const { offer, charge, blocked } = props;
	const host = useRef<HTMLDivElement | null>(null);
	/** `loading` until the Element answers; `none` when it can show no wallet on this device. */
	const state = useSignal<"loading" | "ready" | "none" | "failed">("loading");
	// The latest handlers, so a re-render never re-mounts the Element just to swap a closure.
	const latest = useRef(props);
	latest.current = props;

	const live = offer?.available === true && !blocked && charge !== null;
	const amount = charge?.minor ?? 0;
	const currency = charge?.currency ?? "";

	useEffect(() => {
		if (!live || !host.current) return;
		let cancelled = false;
		let teardown: (() => void) | null = null;
		state.value = "loading";

		(async () => {
			const config = await PaymentsService.cardSetupConfig();
			if (cancelled) return;
			if (!config.ok || !config.data) {
				state.value = "failed";
				return;
			}
			const stripe = await loadStripe(config.data.publishableKey);
			if (cancelled || !host.current) return;
			const elements = stripe.elements({
				mode: "payment",
				amount,
				currency: currency.toLowerCase(),
				appearance: appearanceFromTokens(),
			});
			const element = elements.create("expressCheckout", {
				buttonHeight: 44,
				buttonType: { applePay: "buy", googlePay: "buy", paypal: "buynow" },
				layout: { maxColumns: 3, maxRows: 1, overflow: "auto" },
			});
			element.on("ready", (event) => {
				if (!cancelled) state.value = event.availablePaymentMethods ? "ready" : "none";
			});
			element.on("loaderror", () => {
				if (!cancelled) state.value = "failed";
			});
			// The sheet must be opened within a second of the press, so nothing is awaited here.
			element.on("click", (event) => event.resolve());
			element.on("confirm", async (event) => {
				const { begin, onConfirmed, onError, returnPathFor } = latest.current;
				const submitted = await elements.submit();
				if (submitted.error) {
					event.paymentFailed({ reason: "fail" });
					onError(
						submitted.error.message ??
							"Those payment details weren't accepted. Nothing was charged.",
					);
					return;
				}
				const started = await begin();
				if (!started.ok) {
					event.paymentFailed({ reason: "fail" });
					onError(started.message);
					return;
				}
				const returnUrl =
					new URL(returnPathFor(started.payment.paymentId), globalThis.location.origin).href;
				const { error } = await stripe.confirmPayment({
					elements,
					clientSecret: started.payment.clientSecret,
					redirect: "if_required",
					confirmParams: { return_url: returnUrl },
				});
				if (error) {
					onError(error.message ?? "The wallet didn't confirm the payment. Nothing was charged.");
					return;
				}
				onConfirmed(started.payment.paymentId);
			});
			element.mount(host.current);
			teardown = () => element.destroy();
		})().catch(() => {
			if (!cancelled) state.value = "failed";
		});

		return () => {
			cancelled = true;
			teardown?.();
		};
	}, [live, amount, currency]);

	// No express route was offered for this checkout — no region, rather than an empty one.
	if (!offer) return null;

	const reason = !offer.available
		? offer.reason ?? "Express checkout isn't available for this account."
		: blocked
		? "Sort out the item above first — an express payment can't clear it."
		: charge === null
		? "This basket mixes currencies, so it can't be paid in one express payment."
		: null;

	return (
		<section
			class="cko-xpay"
			aria-labelledby="cko-xpay-head"
			aria-busy={live && state.value === "loading"}
		>
			<h3 class="cko-xpay__head" id="cko-xpay-head">Express checkout</h3>
			{reason
				? (
					<p class="cko-xpay__reason">
						<Icon name="lock" />
						<span>{reason}</span>
					</p>
				)
				: (
					<>
						<div class="cko-xpay__element" ref={host} data-state={state.value} />
						{state.value === "none" && (
							<p class="cko-xpay__reason" role="status">
								No express wallet is set up in this browser.
							</p>
						)}
						{state.value === "failed" && <p class="cko-xpay__reason" role="status">{LOAD_FAILED}
						</p>}
					</>
				)}
		</section>
	);
}
