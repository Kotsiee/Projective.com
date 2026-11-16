import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useCallback, useEffect, useRef } from "preact/hooks";
import "../styles/checkout.css";
import "../styles/checkout-payment.css";
import "../styles/checkout-gate.css";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { StripeElementPanel } from "@features/payments/components/StripeElementPanel.tsx";
import { PaymentsService } from "@features/payments/core/PaymentsService.ts";
import { loadStripe } from "@features/payments/core/stripe-js.ts";
import { returnPathOf, stripeReturnOf, withoutStripeReturn } from "@features/payments/core/stripe-flow.ts";
import type { CardPaymentHandoff } from "@projective/types/finance";
import { CheckoutService } from "../core/CheckoutService.ts";
import { basketHref, checkoutStepHref, payInParamOf } from "../core/basket-model.ts";
import {
	applyResponse,
	applySession,
	BASKET_REFRESH_EVENT,
	checkoutError,
	chosenCardId,
	chosenProvider,
	clearDraft,
	currentCheckoutContext,
	endsAttempt,
	lastResult,
	newAttemptKey,
	persistDraft,
	resetAttempt,
	restoreDraft,
	seedCheckoutContext,
	selectCardRoute,
	selectPaymentMethod,
	session as sessionSignal,
	submitting,
} from "../core/basket-state.ts";
import { contributionOptedIn, seedStep } from "../core/checkout-state.ts";
import { cardStepPending } from "../core/card-step.ts";
import {
	attemptFingerprint,
	type ChargeWitness,
	chargeWitness,
	includedNow,
	resultIcon,
	resultTitle,
	routeGatesFor,
} from "../core/checkout-model.ts";
import { useCheckoutContext } from "../core/checkout-context.ts";
import {
	businessGateOf,
	gatedSentence,
	gateTakesCommit,
	ownedByGate,
	refusalLines,
} from "../core/business-gate.ts";
import { devGateSession } from "../core/dev-gate.ts";
import { type DevCheckoutGate, readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { Amount } from "../components/Amount.tsx";
import { rowDomId } from "../components/BasketRow.tsx";
import { BusinessSpendGate } from "../components/BusinessSpendGate.tsx";
import { CheckoutContractBanner } from "../components/CheckoutContractBanner.tsx";
import { ConfirmPayDialog } from "../components/ConfirmPayDialog.tsx";
import { OrderSummaryRail } from "../components/OrderSummaryRail.tsx";
import { PaymentMethodChooser } from "../components/PaymentChoice.tsx";
import { PayGateNotice } from "../components/PayGateNotice.tsx";
import { type ExpressStart, ExpressCheckoutElement } from "../components/ExpressCheckoutElement.tsx";
import { RequestApprovalDialog } from "../components/RequestApprovalDialog.tsx";
import { SpendLimitNotice } from "../components/SpendLimitNotice.tsx";
import AddPaymentMethodModal from "./AddPaymentMethodModal.island.tsx";
import type {
	BasketItem,
	CheckoutBootstrap,
	CheckoutSessionContext,
	MonthlyInvoicing,
	SavedCard,
} from "../types/checkout-types.ts";

/**
 * CheckoutPaymentScreen — step 3 of the flow: which instrument, what it will cost, and the commit.
 *
 * ## What it inherited, verbatim and deliberately
 *
 * Three things were lifted from the single-page checkout unchanged because each is load-bearing and
 * each was arrived at by measurement rather than preference:
 *
 * 1. **`expectedCharge` is a witness statement, not a calculation.** It is the charge the buyer was
 *    SHOWN — the session's `buyerCharge`, in their own currency with the quote it was priced on, or in
 *    the listings' own; the server recomputes and refuses on mismatch, which is what turns a price that
 *    moved between render and submit into a `price_changed` refusal instead of a silent overcharge, and
 *    a quote that ran out into `quote_expired` and a re-read (Decision #435).
 * 2. **The attempt key is minted once per attempt and dropped when the purchase changes.** A retry
 *    replays an outcome; a genuinely different purchase must never replay the previous one's.
 * 3. **The outcome claims focus, and re-claims it.** The confirm dialog restores focus to its trigger
 *    on an exit ANIMATION, and that trigger has been replaced by the outcome panel — so focus lands
 *    on `<body>` and a buyer who paid by keyboard is left with no position at all. See the effect.
 *
 * ## The three regions
 *
 * **The banner states the contract.** Where the work goes and who is billed — already decided, one
 * link from being changed. The settlement currency and any FX rate are disclosed beside the total.
 *
 * **The main column answers "how".** The express wallets first, above an OR divider, then ONE radio
 * group of routes — the Projective wallet, a card on file, the invoice — where only the chosen route
 * opens, plus the alternative arrangement (monthly invoicing) for the identities that qualify.
 *
 * **The summary rail answers "how much", and carries the commit.** The lines, the arithmetic, the one
 * pay notice and Buy Now, in that order, so the button that agrees to a total is beside the total it
 * agrees to — and every reason it is off is said once, beside it.
 *
 * ## What this step does NOT do
 *
 * **It does not edit the basket or the details.** Selecting lines belongs to step 1 and the buyer's
 * record belongs to step 2, both of which have the controls for them; this step links back to each.
 * Carrying step 1's client-side slot gate here would state a requirement with no control on the page
 * to satisfy it — a dead end dressed as a blocker.
 *
 * **It computes no money.** Every figure is a server-computed `MoneyView`. The voluntary contribution
 * in particular is never added client-side: opting in re-reads the session with `contribute=1`, and
 * the whole totals block comes back recomputed, which is also what keeps `expectedCharge` agreeing
 * with the server's own recompute at charge time.
 *
 * **It has no footer band.** The step runs in focus chrome (§D.6) and owns its actions here.
 */

// #region Props
/** Props for {@link CheckoutPaymentScreen}. */
export interface CheckoutPaymentScreenProps {
	/** The SSR-resolved checkout projection. */
	initial: CheckoutBootstrap;
	/**
	 * The acting account's saved cards from the dedicated cards read.
	 *
	 * The SESSION's `savedCards` is authoritative whenever it resolved, because it is the list the
	 * server priced and gated this checkout against. This prop is the fallback for the one case where
	 * they can differ: a degraded session read returns an empty projection while the cards read
	 * succeeded, and showing "no cards on file" to an account that has some would send the buyer off
	 * to add a card they already have.
	 */
	cards: readonly SavedCard[];
	/** The card a card payment pre-selects; `null` when none is usable. */
	defaultCardId: string | null;
	/**
	 * The Details step reopened for editing (`detailsEditHref`), built by the route from its own URL so
	 * the basket, the owner, the narrowing and the carried params survive the round trip.
	 */
	detailsHref: string;
	/** This step in each currency the order may be paid in (`payInHrefs`, Decision #435), keyed by currency. */
	payInHrefs: Readonly<Record<string, string>>;
}
// #endregion

/** How long before a shown quote expires it is re-read — under the server's five-minute reuse window. */
const QUOTE_REFRESH_LEAD_MS = 4 * 60 * 1000;

export default function CheckoutPaymentScreen(props: CheckoutPaymentScreenProps): JSX.Element {
	const { initial } = props;

	// #region Local state
	const resultRef = useRef<HTMLElement | null>(null);
	/** The `(provider, contribution)` pair the last read was made for — the refetch loop's guard. */
	const readKey = useRef<string>("");

	const confirmOpen = useSignal(false);
	const addMethodOpen = useSignal(false);
	const reading = useSignal(false);
	/**
	 * The business "Request approval" dialog (Decision #243): open, in flight, its refusal of the reason
	 * (the field's) or of the request (the form's), and what the last filing said once it closed.
	 */
	const approvalOpen = useSignal(false);
	const approvalBusy = useSignal(false);
	const approvalFieldError = useSignal<string | null>(null);
	const approvalFormError = useSignal<string | null>(null);
	const approvalNote = useSignal<string | null>(null);
	/** Set by a filing that closed the dialog: focus then goes to what the gate says now (below). */
	const approvalFiled = useSignal(false);
	const gateRef = useRef<HTMLElement | null>(null);
	/** The Dev Context Switcher's checkout gate state; read after hydration, so first paint is the server's. */
	const devGate = useSignal<DevCheckoutGate | undefined>(undefined);
	/**
	 * The attempt key a processor charge (card or express) was started under.
	 *
	 * The wallet order that follows the charge is placed under THIS key, never a fresh one, so a
	 * placement that already happened — a retry, a second tab, the webhook placing it server-side —
	 * replays instead of ordering twice. Held in a ref rather than read back from `attemptKey`, because
	 * the screen resets the attempt whenever the purchase fingerprint moves, and the settlement wait can
	 * outlast such a reset.
	 */
	const chargeKey = useRef<string | null>(null);
	/**
	 * The charge, and the quote it was priced on, that a processor charge was started for. The wallet
	 * order that completes it states THESE, not the session's current ones: a re-read can lock a fresh
	 * quote while the payment settles, and the order must be the one the card paid for.
	 */
	const chargeWitnessRef = useRef<ChargeWitness | null>(null);
	// #endregion

	// #region Reads
	const reload = useCallback(async () => {
		reading.value = true;
		const res = await CheckoutService.session({
			...currentCheckoutContext(),
			// The route and the contribution BOTH change what the server offers and what it totals, so
			// they travel with the read rather than being applied to its answer afterwards.
			provider: chosenProvider.peek(),
			contribute: contributionOptedIn.peek(),
		});
		applyResponse(res, applySession);
		reading.value = false;
	}, []);

	useEffect(() => {
		seedStep("payment");
		seedCheckoutContext({
			basketId: initial.session.basketId || null,
			owner: initial.owner,
			display: initial.display,
			projectId: initial.session.preselect.projectId,
			serviceId: initial.session.preselect.serviceId,
			payIn: payInParamOf(initial.session.payIn),
		});
		applySession({ session: initial.session });
		restoreDraft(initial.session.basketId);
		contributionOptedIn.value = initial.session.processingOffer.optedIn;
		if (chosenCardId.value === null) chosenCardId.value = props.defaultCardId;
	}, [initial, props.defaultCardId]);

	useCheckoutContext({
		basketId: initial.session.basketId || null,
		owner: initial.owner,
		display: initial.display,
		projectId: initial.session.preselect.projectId,
		serviceId: initial.session.preselect.serviceId,
		payIn: payInParamOf(initial.session.payIn),
	});

	useEffect(() => {
		const refresh = () => void reload();
		globalThis.addEventListener?.(BASKET_REFRESH_EVENT, refresh);
		return () => globalThis.removeEventListener?.(BASKET_REFRESH_EVENT, refresh);
	}, [reload]);

	useEffect(() => {
		devGate.value = readDevSeam()?.checkoutGate;
		return subscribeDevSeam((seam) => {
			devGate.value = seam?.checkoutGate;
		});
	}, []);
	// #endregion

	const view = devGateSession(sessionSignal.value ?? initial.session, devGate.value);
	const result = lastResult.value;

	// #region Derivations (all read signals, so a change re-renders)
	const paying = view.items.filter((item) => includedNow(item, item.isSelectedForCheckout));

	const gates = routeGatesFor(view, chosenProvider.value, chosenCardId.value);
	const blockers = [...view.blockers, ...gates];
	const blocked = blockers.length > 0;
	/** Blockers that an express sheet cannot clear either — everything except "pick an instrument". */
	const hardBlocked = view.blockers.length > 0;

	/*
	 * A business checkout's refusal and its one way forward (Decision #243). Every business refusal is
	 * worded from the one refusal map — in the list, beside Buy Now and in a refused attempt's reasons —
	 * and the ones the gate already says leave the list, so one refusal is never said twice.
	 */
	const businessGate = businessGateOf({
		session: view,
		provider: chosenProvider.value,
		lastResult: result,
		returnHref: checkoutStepHref("payment", view.basketId || null, initial.owner, view.preselect),
	});
	const worded = blockers.map((blocker) =>
		blocker.gate ? { ...blocker, message: gatedSentence(blocker, view) } : blocker
	);
	const listed = worded.filter((blocker) => !ownedByGate(businessGate, blocker));
	const gateLines = listed.length > 0 ? listed : worded.slice(0, 1);

	const fingerprint = attemptFingerprint(
		view,
		chosenProvider.value,
		chosenCardId.value,
		(item: BasketItem) => item.isSelectedForCheckout,
	);
	// #endregion

	// #region Attempt identity + the reconciling read
	// A changed purchase must not replay the previous purchase's stored outcome.
	useEffect(() => {
		resetAttempt();
	}, [fingerprint]);

	// The buyer's unsubmitted choices survive a reload; the amount and the instrument never do.
	useEffect(() => {
		persistDraft();
	}, [chosenProvider.value, chosenCardId.value]);

	/*
	 * Re-read whenever the ROUTE or the contribution changes, because the offer and the totals both
	 * depend on them — a wallet payment incurs no gateway cost, so the contribution simply stops being
	 * offered.
	 *
	 * **The seed is the SERVER's own answer, and that is a fix rather than a detail.** It used to seed
	 * from `chosenProvider`, the route the client had just ADOPTED, so the guard compared the client's
	 * route against itself and no reconciling read ever fired. The SSR projection is always resolved
	 * with no provider at all (`session.provider` is `null` by construction — the server does not
	 * choose for the buyer), which means it always reports the contribution as offered. On a wallet or
	 * invoice payment that is wrong, and the disagreement surfaced at the worst possible moment: the
	 * checkbox painted, and vanished the instant it was ticked, because ticking it was the first read
	 * that ever carried the route. Seeding from `initial.session.provider` makes the mount itself the
	 * reconciling read, so the offer appears or disappears with the ROUTE and never as a side effect of
	 * answering it. Verified by reproduction: with the wallet restored from a draft, the box previously
	 * rendered unticked and disappeared on the first click.
	 */
	useEffect(() => {
		const key = `${chosenProvider.value ?? "-"}|${contributionOptedIn.value ? "1" : "0"}`;
		if (readKey.current === "") {
			readKey.current = `${initial.session.provider ?? "-"}|${
				initial.session.processingOffer.optedIn ? "1" : "0"
			}`;
		}
		if (readKey.current === key) return;
		readKey.current = key;
		void reload();
	}, [chosenProvider.value, contributionOptedIn.value]);

	/*
	 * A conversion quote on screen is re-read shortly before it runs out (Decision #435), inside the
	 * window the server no longer reuses it in, so the charge shown is always one Pay can still take. A
	 * quote with less time than that left is answered by the payment itself: `quote_expired`, then the
	 * re-read below.
	 */
	const shownQuote = view.buyerCharge?.quote ?? null;
	useEffect(() => {
		if (!shownQuote) return;
		const wait = Date.parse(shownQuote.expiresAt) - Date.now() - QUOTE_REFRESH_LEAD_MS;
		if (!(wait > 0)) return;
		const id = setTimeout(() => {
			if (!submitting.peek()) void reload();
		}, wait);
		return () => clearTimeout(id);
	}, [shownQuote?.quoteId, shownQuote?.expiresAt]);

	/*
	 * An outcome takes focus. It is the answer to the only question the buyer had, and on a long
	 * checkout it can otherwise land far outside the viewport.
	 *
	 * Re-asserted until it sticks, for a measured reason. The confirm dialog restores focus to its
	 * trigger when it finishes unmounting, and it unmounts on an exit ANIMATION — so a focus call made
	 * synchronously, or on the next tick, is undone a hundred-odd milliseconds later. Worse, the trigger
	 * it restores to has itself been replaced by this panel, so focus lands on `<body>`: a buyer who
	 * paid by keyboard was returned to the document with no position at all (measured).
	 *
	 * The retry stops the moment focus is inside the outcome, and also the moment it lands anywhere
	 * REAL — if the reader has moved on, that is their decision and this must not take it back. Only
	 * the `<body>` case, which is the failure itself, keeps trying. Encoding the dialog's exit duration
	 * here would have worked today and broken silently the day that duration changed.
	 */
	useEffect(() => {
		const node = resultRef.current;
		if (!result || confirmOpen.value || !node) return;

		let tries = 0;
		const claim = () => {
			const active = document.activeElement;
			if (node.contains(active)) return true;
			if (active !== null && active !== document.body) return true;
			node.focus();
			return false;
		};

		if (claim()) return;
		const id = setInterval(() => {
			if (claim() || ++tries > 8) clearInterval(id);
		}, 50);
		return () => clearInterval(id);
	}, [result, confirmOpen.value]);

	/*
	 * A filing hands focus to the gate. It closes the request dialog and as a rule removes the control
	 * that opened it — Request approval gives way to "Waiting for approval…", or the gate leaves when
	 * the order no longer needs one — so the dialog's restore has nothing to return to and focus falls
	 * to `<body>` (measured). Claimed once the dialog has left the DOM (its trap holds focus until
	 * then), only while focus is on `<body>`, and on the gate's region — or Buy Now when no gate is left.
	 */
	useEffect(() => {
		if (!approvalFiled.value || approvalOpen.value) return;
		let tries = 0;
		const claim = () => {
			if (document.querySelector(".cko-approve")) return false;
			const active = document.activeElement;
			if (active !== null && active !== document.body) return true;
			(gateRef.current ?? document.querySelector<HTMLElement>(".cko-rail__buy:not(:disabled)"))
				?.focus();
			return false;
		};
		const done = () => {
			approvalFiled.value = false;
		};
		if (claim()) return done();
		const id = setInterval(() => {
			if (claim() || ++tries > 30) {
				clearInterval(id);
				done();
			}
		}, 50);
		return () => clearInterval(id);
	}, [approvalFiled.value, approvalOpen.value]);
	// #endregion

	// #region Writes
	/**
	 * Charge the purchase — from the selected instrument, or (`override`) as the wallet order that
	 * completes a processor charge, under that charge's own attempt key.
	 */
	const submit = useCallback(async (
		override?: { provider: "wallet"; key: string; witness: ChargeWitness | null },
	) => {
		const current = sessionSignal.value;
		if (!current || submitting.value) return;

		const provider = override?.provider ?? chosenProvider.value;
		if (!provider) {
			checkoutError.value = "Choose how you'd like to pay first.";
			return;
		}
		const itemIds = current.items
			.filter((item) => includedNow(item, item.isSelectedForCheckout))
			.map((item) => item.id);
		if (itemIds.length === 0) {
			checkoutError.value = "Nothing is selected for this payment.";
			return;
		}

		submitting.value = true;
		approvalNote.value = null;
		const key = override?.key ?? newAttemptKey();
		// The charge the buyer was SHOWN — in their own currency with its quote, or the listings' — never
		// recomputed here: the server re-verifies it and refuses on mismatch, which is what makes a moved
		// price a refusal instead of an overcharge. The order completing a card charge states that charge's.
		const witness = override?.witness ?? chargeWitness(current);
		const res = await CheckoutService.create({
			basketId: current.basketId,
			ownerType: current.owner.ownerType,
			ownerId: current.owner.ownerId,
			itemIds,
			provider,
			cardId: provider === "card" ? chosenCardId.value : null,
			promoCode: current.promo?.valid ? current.promo.code : null,
			currency: current.currency,
			expectedCharge: witness.expectedCharge,
			fxQuoteId: witness.fxQuoteId,
			// The SERVER's own contribution figure, echoed back rather than re-derived. It is part of
			// the total above, so a write that omitted it would make the server's recompute lower by
			// exactly the contribution and refuse every attempt as `price_changed`.
			processingContributionMinor: current.totals.processingContribution.minor,
			billingContextId: current.buyer.contextId,
			idempotencyKey: key,
		}, {
			...currentCheckoutContext(),
			provider,
			contribute: contributionOptedIn.value,
		});
		submitting.value = false;
		confirmOpen.value = false;

		applyResponse(res, (data) => {
			lastResult.value = data.result;
			// A card charge hands over to the browser; its order will be placed under this same key.
			if (data.result.status === "requires_action") {
				chargeKey.current = key;
				chargeWitnessRef.current = witness;
			}
			if (data.result.status === "succeeded") {
				clearDraft();
				/*
				 * A completed purchase belongs on the confirmation step, which is a GET over the ORDER —
				 * never a re-POST of `create()`. The panel below still paints in the meantime, so a buyer
				 * whose navigation is blocked or slow is never left looking at a checkout that appears not
				 * to have done anything.
				 */
				const href = checkoutStepHref(
					"confirmation",
					current.basketId,
					initial.owner,
					undefined,
					data.result.orderId,
				);
				if (typeof globalThis.location !== "undefined") globalThis.location.href = href;
			}
			// A refusal ends the attempt unless a payment for these lines is still live (`endsAttempt`).
			if (endsAttempt(data.result)) resetAttempt();
		});
		await reload();
	}, [reload]);

	/**
	 * A card or express checkout, after Stripe accepted the payment: the charge tops up the paying
	 * wallet, and only the signed webhook can say it arrived — so wait for THAT, then place the order
	 * from the wallet under the charge's OWN attempt key (`key`; the charge itself ran as `card-<key>`).
	 * Reusing the key is what makes an order that was already placed for this payment replay rather
	 * than be placed twice. A payment that has not cleared by the end of the wait is said out loud;
	 * nothing is ordered on the browser's word.
	 */
	const cardSettling = useSignal(false);
	const finishByCard = useCallback(async (paymentId: string, key: string | null) => {
		cardSettling.value = true;
		checkoutError.value = null;
		const settled = await PaymentsService.waitForSettlement(paymentId);
		cardSettling.value = false;
		if (settled !== "succeeded") {
			checkoutError.value = settled === "failed"
				? "The card payment didn't go through. Nothing was charged."
				: "Your bank accepted the payment, but it hasn't reached your wallet yet. Your order is placed automatically when it arrives — you'll get a notification.";
			return;
		}
		await submit({
			provider: "wallet",
			key: key ?? newAttemptKey(),
			witness: chargeWitnessRef.current,
		});
	}, [submit]);

	/** Open the PaymentIntent for an express wallet payment (Stripe's Express Checkout Element). */
	const beginExpress = useCallback(async (): Promise<ExpressStart> => {
		const current = sessionSignal.value;
		if (!current || submitting.value) return { ok: false, message: "A payment is already in progress." };
		// Each press of a wallet button is its own attempt; its key travels with the charge from here.
		resetAttempt();
		const key = newAttemptKey();
		const witness = chargeWitness(current);
		chargeKey.current = key;
		chargeWitnessRef.current = witness;
		submitting.value = true;
		const res = await CheckoutService.create({
			basketId: current.basketId,
			ownerType: current.owner.ownerType,
			ownerId: current.owner.ownerId,
			itemIds: current.items.filter((item) => includedNow(item, item.isSelectedForCheckout)).map((item) => item.id),
			provider: "express",
			cardId: null,
			promoCode: current.promo?.valid ? current.promo.code : null,
			currency: current.currency,
			expectedCharge: witness.expectedCharge,
			fxQuoteId: witness.fxQuoteId,
			processingContributionMinor: current.totals.processingContribution.minor,
			billingContextId: current.buyer.contextId,
			idempotencyKey: key,
		}, { ...currentCheckoutContext(), provider: "express", contribute: contributionOptedIn.value });
		submitting.value = false;
		const result = res.ok ? res.data?.result : undefined;
		if (result?.status === "requires_action" && result.payment) return { ok: true, payment: result.payment };
		return { ok: false, message: result?.message ?? res.message ?? "Express checkout couldn't start. Nothing was charged." };
	}, []);

	/**
	 * A SAVED card was charged on the server. When the bank asks its holder to confirm (3-D Secure),
	 * Stripe.js answers that in place; either way the order is placed only once the webhook has credited
	 * the wallet ({@link finishByCard}).
	 */
	const continueSavedCard = useCallback(async (payment: CardPaymentHandoff) => {
		if (payment.confirmation === "authenticate") {
			cardSettling.value = true;
			try {
				const stripe = await loadStripe(payment.publishableKey);
				const { error } = await stripe.handleNextAction({ clientSecret: payment.clientSecret });
				if (error) {
					cardSettling.value = false;
					checkoutError.value = error.message ?? "Your bank didn't confirm the payment. Nothing was charged.";
					resetAttempt();
					return;
				}
			} catch (error) {
				cardSettling.value = false;
				checkoutError.value = error instanceof Error
					? error.message
					: "Your bank's check couldn't be opened. Nothing was charged.";
				return;
			}
		}
		await finishByCard(payment.paymentId, chargeKey.current);
	}, [finishByCard]);

	// A saved-card charge carries on by itself — the buyer already chose the card and confirmed the amount.
	const continued = useRef<string | null>(null);
	const pendingPayment = lastResult.value?.status === "requires_action" ? lastResult.value.payment : undefined;
	useEffect(() => {
		if (!pendingPayment || pendingPayment.confirmation === "collect") return;
		if (continued.current === pendingPayment.paymentId) return;
		continued.current = pendingPayment.paymentId;
		void continueSavedCard(pendingPayment);
	}, [pendingPayment?.paymentId]);

	/*
	 * A redirect-based wallet (PayPal) came back. The return names the payment and the attempt it was
	 * started under (`expressReturnPath`), so the page RESUMES that payment — waits for the webhook,
	 * then places the order under the same key — instead of offering to start a second one. The
	 * params are stripped from the address before anything else, so a reload can never replay them.
	 * Stripe's `redirect_status` is a claim, not the fact: success is still decided by the webhook.
	 */
	useEffect(() => {
		const back = expressReturnOf(globalThis.location?.href ?? "");
		if (!back) return;
		globalThis.history.replaceState(globalThis.history.state, "", back.cleanPath);
		if (back.status === "failed") {
			checkoutError.value = "The wallet didn't complete the payment. Nothing was charged.";
			return;
		}
		void finishByCard(back.paymentId, back.key);
	}, []);

	/**
	 * Open the confirmation rather than charging.
	 *
	 * An irreversible payment gets the platform's established confirm grammar (the wallet's), not a
	 * single click. An express route travels through the SAME gate: the vendor's sheet is where the
	 * buyer approves the payment, but this is where they approve the AMOUNT, and the two are different
	 * agreements.
	 */
	const openConfirm = useCallback(() => {
		if (submitting.value) return;
		confirmOpen.value = true;
	}, []);

	/**
	 * File a business order's approval request, bound to this basket (Decision #243). The lines are the
	 * ones Buy Now would send, in the page's deep-link scope; the amount is the server's. The answer is
	 * the fresh session, whose gate then reads "Waiting for approval…", and a sentence the page keeps
	 * when the gate does not already say it ("This order no longer needs approval…"). A refused reason
	 * stays beside the field; any other refusal is said for the whole form, and the dialog stays open.
	 */
	const requestApproval = useCallback(async (reason: string) => {
		const current = sessionSignal.value;
		if (!current || approvalBusy.value) return;
		const itemIds = current.items
			.filter((item) => includedNow(item, item.isSelectedForCheckout))
			.map((item) => item.id);
		if (itemIds.length === 0) {
			approvalFormError.value = "Nothing is selected for this order.";
			return;
		}
		approvalBusy.value = true;
		approvalFieldError.value = null;
		approvalFormError.value = null;
		const res = await CheckoutService.requestApproval({
			basketId: current.basketId,
			itemIds,
			reason,
			preselect: current.preselect,
		}, {
			...currentCheckoutContext(),
			provider: chosenProvider.peek(),
			contribute: contributionOptedIn.peek(),
		});
		approvalBusy.value = false;
		if (res.ok && res.data) {
			applySession(res.data);
			// The refusal that prompted the request has been answered by it.
			if (lastResult.peek()?.status === "failed") lastResult.value = null;
			approvalNote.value = res.message ?? null;
			approvalFiled.value = true;
			approvalOpen.value = false;
			return;
		}
		const fieldError = res.errors?.reason ?? null;
		approvalFieldError.value = fieldError;
		approvalFormError.value = fieldError
			? null
			: res.message ?? "The request couldn't be sent. Try again.";
	}, []);
	// #endregion

	// #region Render
	const savedCards = view.savedCards.length > 0 ? view.savedCards : props.cards;
	const card = savedCards.find((entry) => entry.id === chosenCardId.value) ?? null;
	const done = result?.status === "succeeded";
	const cardStep = cardStepPending(result);
	/** A refused attempt says a business refusal once: the map's headline, the other reasons below. */
	const outcomeLines = result ? refusalLines(result, view) : null;
	/** The gate's fill is the region's commit while it offers one (§B.8.2); Buy Now then leaves the DOM. */
	const gateCommits = gateTakesCommit(businessGate);
	/** What the last filing said, kept only where the gate does not already say it. */
	const filingNote = businessGate?.kind === "pending" ? null : approvalNote.value;
	const showsInvoicing = view.buyer.contextKind === "business" ||
		view.owner.ownerType === "business" || view.owner.ownerType === "enterprise";
	const detailsHref = props.detailsHref;
	const payable = view.buyerCharge?.quote ? view.buyerCharge : view.totals.total;
	const buyLabel = submitting.value ? "Taking payment…" : `Buy Now · ${payable.display}`;
	// The route the confirmation is actually about, so the dialog never names the instrument the buyer
	// had selected when they pressed an express button instead.
	const confirmProvider = chosenProvider.value;

	return (
		<div class="cko cko-pstep" data-done={done ? "true" : undefined}>
			{checkoutError.value && (
				<p class="cko__error" role="alert">
					<Icon name="warning" />
					{checkoutError.value}
				</p>
			)}

			{
				/*
				 * The outcome's liveness comes from its ROLE alone. An explicit `aria-live="polite"` beside
				 * `role="alert"` OVERRIDES the role's implicit `assertive`, so the one outcome that has to
				 * interrupt — a refused payment — was announced at exactly the politeness of a successful one,
				 * queued behind whatever was already speaking.
				 */
			}
			{result && (
				<section
					class="cko-result"
					data-status={result.status}
					role={result.status === "failed" ? "alert" : "status"}
					tabIndex={-1}
					ref={resultRef}
				>
					<span class="cko-result__icon" aria-hidden="true">
						<Icon name={resultIcon(result.status)} />
					</span>
					<div class="cko-result__body">
						<h2 class="cko-result__title">{resultTitle(result.status)}</h2>
						{result.status === "succeeded" && (
							<p class="cko-result__figure">
								<Amount value={result.charged} size="hero" />
							</p>
						)}
						<p class="cko-result__text">{outcomeLines?.headline ?? result.message}</p>

						{outcomeLines && outcomeLines.reasons.length > 0 && (
							<ul class="cko-result__reasons">
								{outcomeLines.reasons.map(({ blocker, sentence }, index) => (
									<li key={`${blocker.code}-${index}`} data-code={blocker.code}>
										{sentence}
										{(blocker.code === "price_changed" || blocker.code === "quote_expired") && (
											<a class="cko-result__jump" href="#cko-summary">See the new total</a>
										)}
									</li>
								))}
							</ul>
						)}

						{result.status === "requires_action" && result.payment && (
							<div class="cko-result__card" aria-busy={cardSettling.value}>
								{cardSettling.value || result.payment.confirmation !== "collect"
									? <p class="cko-result__message" role="status">Confirming the payment with your bank…</p>
									: (
										<StripeElementPanel
											mode="payment"
											clientSecret={result.payment.clientSecret}
											publishableKey={result.payment.publishableKey}
											submitLabel={`Pay ${result.payment.amount.display}`}
											returnPath={typeof globalThis.location !== "undefined"
												? `${globalThis.location.pathname}${globalThis.location.search}`
												: "/checkout"}
											busy={submitting.value}
											onOutcome={(outcome) => {
												if (outcome.ok && result.payment) void finishByCard(result.payment.paymentId, chargeKey.current);
											}}
										/>
									)}
							</div>
						)}

						<p class="cko-result__actions">
							{
								/*
								 * `requires_action` hands off rather than redirecting. An automatic navigation
								 * would take a buyer off-platform on a URL this surface cannot verify, and
								 * would destroy the in-page attempt — including the idempotency key that makes
								 * coming back safe. The link is auto-focused instead, so it is one keystroke.
								 */
							}
							{result.status === "requires_action" && result.nextActionUrl && (
								<a class="cko-result__cta" href={result.nextActionUrl} rel="noopener noreferrer">
									<Icon name="external-link" />
									Continue to finish paying
								</a>
							)}
							{result.status === "succeeded" && (
								<a
									class="cko-result__cta"
									href={checkoutStepHref(
										"confirmation",
										view.basketId,
										initial.owner,
										undefined,
										result.orderId,
									)}
								>
									<Icon name="arrow-right" />
									See your order
								</a>
							)}
							{result.status === "pending" && (
								<a class="cko-result__link" href="/wallet/invoices">See your invoices</a>
							)}
						</p>
					</div>
				</section>
			)}

			{!done && (
				<>
					{businessGate && (
						<BusinessSpendGate
							view={businessGate}
							regionRef={gateRef}
							onRequest={() => {
								approvalFieldError.value = null;
								approvalFormError.value = null;
								approvalNote.value = null;
								approvalOpen.value = true;
							}}
							onCheckAgain={() => void reload()}
							reading={reading.value}
						/>
					)}

					{filingNote && <p class="cko-gate__note" aria-hidden="true">{filingNote}</p>}
					<span class="ui-visually-hidden" role="status">{approvalNote.value ?? ""}</span>

					<SpendLimitNotice limit={view.spendLimit} />

					<div class="cko-pstep__cols">
						<div class="cko-pstep__main">
							<CheckoutContractBanner buyer={view.buyer} detailsHref={detailsHref} />

							<section class="cko__section" aria-labelledby="cko-pay-head">
								<div class="cko__headrow">
									<h2 class="cko__head" id="cko-pay-head">How you'll pay</h2>
									<p class="cko__sub">
										Paying from <strong>{view.owner.name}</strong>
										{view.owner.handle && <span class="cko__handle">@{view.owner.handle}</span>}
									</p>
								</div>

								<ExpressCheckoutElement
									offer={view.providers.find((entry) => entry.provider === "express")}
									charge={view.buyerCharge}
									blocked={hardBlocked}
									begin={beginExpress}
									onConfirmed={(paymentId) => void finishByCard(paymentId, chargeKey.current)}
									returnPathFor={(paymentId) => expressReturnPath(paymentId, chargeKey.current)}
									onError={(message) => {
										checkoutError.value = message;
									}}
								/>

								<PaymentMethodChooser
									providers={view.providers}
									wallet={view.wallet}
									// The wallet card prints the account it belongs to. It comes from the
									// session's resolved owner rather than the viewer's own name, because on a
									// team or business basket the balance being spent is the ENTITY's.
									ownerName={view.owner.name}
									ownerType={view.owner.ownerType}
									cards={savedCards}
									provider={chosenProvider.value}
									cardId={chosenCardId.value}
									labelledBy="cko-pay-head"
									onSelect={selectPaymentMethod}
									onSelectCardRoute={selectCardRoute}
									onAddCard={() => {
										addMethodOpen.value = true;
									}}
									canAddCard={view.cardsConnected}
									onAccountNote={view.invoicing.mode === "intervaled_monthly"
										? view.invoicing.nextStatementLabel ?? "Billed on your next monthly invoice"
										: null}
									refusalId="cko-buy-gate"
									settlement={view.settlement}
								/>

								{
									/*
									 * The alternative ARRANGEMENT, not an alternative instrument — which is why it
									 * sits under the instrument list rather than in it. Monthly invoicing is a
									 * property of the billing identity, agreed once; offering it as a per-purchase
									 * route would imply it can be picked per basket.
									 */
								}
								{showsInvoicing && (
									<div class="cko-pstep__alt">
										<InvoicingAction
											invoicing={view.invoicing}
											href={detailsHref}
											id="cko-inv-main"
										/>
									</div>
								)}
							</section>
						</div>

						<div class="cko-pstep__aside">
							<OrderSummaryRail
								view={view}
								items={paying}
								contribution={view.processingOffer}
								optedIn={contributionOptedIn}
								reading={reading.value}
								onToggleContribution={(next) => {
									contributionOptedIn.value = next;
								}}
								basketHref={basketHref(view.basketId || null, initial.owner)}
								payInHrefs={props.payInHrefs}
							>
								{!cardStep && blocked && (
									<PayGateNotice
										id="cko-buy-gate"
										blockers={gateLines}
										lineHref={(itemId) => basketLineHref(view, initial.owner, itemId)}
									/>
								)}

								{!cardStep && !gateCommits && (
									<div class="cko-rail__commit">
										<Button
											class="cko-rail__buy"
											severity="accent"
											variant="filled"
											size="lg"
											fluid
											rounded
											disabled={blocked}
											loading={submitting.value}
											aria-describedby={blocked ? "cko-buy-gate" : undefined}
											label={buyLabel}
											onClick={() => openConfirm()}
										/>
										<p class="cko-rail__reassure">
											<Icon name="lock" />
											<span>You'll confirm the amount before anything is charged.</span>
										</p>
									</div>
								)}
							</OrderSummaryRail>
						</div>
					</div>
				</>
			)}

			<ConfirmPayDialog
				open={confirmOpen}
				session={{ ...view, provider: confirmProvider }}
				lineCount={paying.length}
				card={confirmProvider === "card" ? card : null}
				busy={submitting.value}
				onConfirm={() => void submit()}
			/>

			{view.businessAccount && (
				<RequestApprovalDialog
					open={approvalOpen}
					amount={view.buyerCharge ?? view.totals.total}
					lineCount={paying.length}
					business={view.owner.name}
					approvers={view.businessAccount.approvers}
					busy={approvalBusy.value}
					fieldError={approvalFieldError.value}
					formError={approvalFormError.value}
					onSubmit={(reason) => void requestApproval(reason)}
				/>
			)}

			<AddPaymentMethodModal
				open={addMethodOpen}
				onClose={() => {
					addMethodOpen.value = false;
				}}
				owner={view.owner}
				cardsConnected={view.cardsConnected}
				onSaved={(cardId) => {
					// The modal has already selected the new card; this re-reads the offer it changes.
					selectPaymentMethod(`card:${cardId}`);
					void reload();
				}}
			/>
		</div>
	);
	// #endregion
}

// #region Redirect return (express wallets)
/** The params an express return carries beside Stripe's own: the payment, and its attempt key. */
const RETURN_PAY = "pay";
const RETURN_ATTEMPT = "attempt";
const PAYMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTEMPT_KEY = /^co_[0-9a-z]+_[0-9a-z]+$/;

/**
 * Where a redirect-based wallet returns: this page, minus any earlier Stripe return, plus the payment
 * and the attempt key it was started under — so the return resumes THAT payment.
 */
function expressReturnPath(paymentId: string, key: string | null): string {
	const url = new URL(returnPathOf(globalThis.location), globalThis.location.origin);
	url.searchParams.set(RETURN_PAY, paymentId);
	if (key) url.searchParams.set(RETURN_ATTEMPT, key);
	return `${url.pathname}${url.search}`;
}

/**
 * The express payment an address returned from, or `null`. Both ids are validated before use — they
 * arrive in a URL — and the address with every return param removed is handed back for
 * `history.replaceState`.
 */
function expressReturnOf(href: string): {
	paymentId: string;
	key: string | null;
	status: string;
	cleanPath: string;
} | null {
	if (!href) return null;
	const url = new URL(href);
	const back = stripeReturnOf(url.searchParams);
	const paymentId = url.searchParams.get(RETURN_PAY) ?? "";
	if (!back || back.kind !== "payment" || !PAYMENT_ID.test(paymentId)) return null;
	const rawKey = url.searchParams.get(RETURN_ATTEMPT);
	const clean = withoutStripeReturn(url);
	clean.searchParams.delete(RETURN_PAY);
	clean.searchParams.delete(RETURN_ATTEMPT);
	return {
		paymentId,
		key: rawKey && ATTEMPT_KEY.test(rawKey) ? rawKey : null,
		status: back.status,
		cleanPath: `${clean.pathname}${clean.search}${clean.hash}`,
	};
}
// #endregion

// #region Route back to the basket
function basketLineHref(view: CheckoutSessionContext, owner: string, itemId: string): string {
	const base = basketHref(view.basketId || null, owner);
	const item = view.items.find((entry) => entry.id === itemId);
	return item ? `${base}#${rowDomId(item)}` : base;
}
// #endregion

// #region Monthly invoicing
/** Props for {@link InvoicingAction}. */
interface InvoicingActionProps {
	invoicing: MonthlyInvoicing;
	/** Where the setting is actually changed — the Details step, in edit mode. */
	href: string;
	/** Unique per instance, so two copies of this control do not share one reason element id. */
	id: string;
}

/**
 * Switch this identity to consolidated monthly billing.
 *
 * **Rendered and locked when refused, never removed.** Monthly invoicing is a verified-business
 * capability, and an account that cannot see it at all cannot learn how to qualify for it — the same
 * gate-versus-absence rule `/wallet` draws. The refusal is the server's own sentence, bound to the
 * disabled control with `aria-describedby` so it is heard on arrival rather than only seen beside it.
 *
 * The eligible form is an ANCHOR, not a button: it navigates to a real page, so it must survive a
 * middle-click and an open-in-new-tab. It is hand-classed onto the shared button styles rather than
 * wrapping {@link Button}, because a `<button>` that navigates is a link that has thrown its
 * affordances away.
 */
function InvoicingAction(props: InvoicingActionProps): JSX.Element {
	const { invoicing, id } = props;
	const active = invoicing.mode === "intervaled_monthly";
	const reasonId = `${id}-reason`;
	const label = active ? "Change Billing Settings" : "Set Up Monthly Invoicing";

	if (!invoicing.eligible) {
		return (
			<div class="cko-invact" data-state="locked">
				<Button
					class="cko-invact__btn"
					variant="outlined"
					rounded
					disabled
					aria-describedby={reasonId}
					icon={<Icon name="lock" />}
					label={label}
				/>
				<p class="cko-invact__reason" id={reasonId}>
					{invoicing.ineligibleReason ??
						"Monthly invoicing is available to verified business accounts."}
				</p>
			</div>
		);
	}

	return (
		<div class="cko-invact" data-state={active ? "on" : "off"}>
			<a
				class="ui-button ui-button--outlined ui-button--rounded cko-invact__btn"
				href={props.href}
				aria-describedby={active ? reasonId : undefined}
			>
				<span class="ui-button__icon">
					<Icon name="document" />
				</span>
				<span class="ui-button__label">{label}</span>
			</a>
			{active && (
				<p class="cko-invact__reason" id={reasonId}>
					On — this purchase joins your next monthly invoice.
					{invoicing.nextStatementLabel ? ` ${invoicing.nextStatementLabel}.` : ""}
				</p>
			)}
		</div>
	);
}
// #endregion
