import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useCallback, useEffect, useRef } from "preact/hooks";
import "../styles/checkout.css";
import { Icon } from "@projective/ui/icons";
import { Dialog, Message } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { isCheckoutEligible, type TicketFundingQuote } from "@projective/types/finance";
import { BasketService } from "../core/BasketService.ts";
import { CheckoutService } from "../core/CheckoutService.ts";
import { checkoutHref } from "../core/basket-model.ts";
import { gatedSentence, refusalLines } from "../core/business-gate.ts";
import {
	basketStagesOf,
	initialStageSelection,
	type PrepaidPreview,
	previewQuote,
} from "../core/stage-picker.ts";
import { PaymentMethodChooser } from "../components/PaymentChoice.tsx";
import { Amount } from "../components/Amount.tsx";
import { CheckoutBlockers } from "../components/CheckoutBlockers.tsx";
import { OrderLines } from "../components/OrderLines.tsx";
import { OrderTotals } from "../components/OrderTotals.tsx";
import { StagePicker } from "../components/StagePicker.tsx";
import AddPaymentMethodModal from "./AddPaymentMethodModal.island.tsx";
import { StripeElementPanel } from "@features/payments/components/StripeElementPanel.tsx";
import { PaymentsService } from "@features/payments/core/PaymentsService.ts";
import { loadStripe } from "@features/payments/core/stripe-js.ts";
import { readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import {
	activeBasketId,
	activeOwner,
	applyBasket,
	applyResponse,
	applySession,
	basket,
	chosenCardId,
	chosenProvider,
	currentCheckoutContext,
	lastResult,
	newAttemptKey,
	notifyBasketChanged,
	resetAttempt,
	selectedMethodId,
	selectPaymentMethod,
	session as sessionSignal,
	submitting,
} from "../core/basket-state.ts";
import {
	type BuyNowHost,
	buyNowHost,
	buyNowOpen,
	type BuyNowTarget,
	buyNowTarget,
	closeBuyNow,
	registerBuyNowHost,
	ticketRefsOf,
} from "../core/buy-now-state.ts";
import type {
	CheckoutBlocker,
	CheckoutContext,
	CheckoutSessionContext,
	ProviderAvailability,
} from "../types/checkout-types.ts";

/**
 * BuyNowModal — one purchase, checked out without leaving the page: a listing from Explore or its
 * entity page, or the stages of one project ticket (Decisions #166, #430).
 *
 * **What is shown is what is charged.** A listing is added carrying its `serviceId` narrowing token and
 * a ticket's stage lines are written exactly (`replaceStages`); the session is then read narrowed to
 * that scope (`?service_id=` / `?ticket_id=`) and the charge names exactly the lines that session
 * priced, so the figure on the button and the charge agree by construction rather than by arithmetic.
 *
 * **A ticket's stages are chosen here.** The quote lists every stage the ticket runs through; any the
 * server marks `fundable` can be ticked — the stage it is in is held at once, a later one is prepaid and
 * held when the ticket reaches it. Every change rewrites the ticket's lines and re-reads the session, one
 * write at a time and the latest selection last, so a slower answer can never paint over a newer one.
 *
 * Its parts are the checkout's own — the lines, the instrument chooser, the blockers and the totals —
 * so the panel and `/checkout` cannot describe one purchase two ways. Guests never reach here:
 * `requestBuyNow` routes them to sign-in.
 */

// #region Props
/** Props for {@link BuyNowModal}. */
export interface BuyNowModalProps {
	/**
	 * Where this instance is mounted. Both purchase CTAs on a listing page are always mounted (they
	 * hide each other by `display`, and this panel portals out of a hidden ancestor anyway), so the
	 * host with the highest fixed priority renders and the rest stand down.
	 */
	host?: BuyNowHost;
}
// #endregion

/**
 * The offer as THIS panel can act on it. The express wallets need Stripe's Express Checkout Element,
 * which only the full payment step mounts, so here the route is shown refused with where to find it.
 */
function buyNowOffer(providers: readonly ProviderAvailability[]): ProviderAvailability[] {
	return providers.map((offer) =>
		offer.provider === "express" && offer.available
			? {
				...offer,
				available: false,
				reason: "Pay with a wallet like Apple Pay from the full checkout.",
			}
			: offer
	);
}

/** How far along one instant-purchase attempt is. */
type BuyPhase = "preparing" | "ready" | "failed" | "done";

/** The checkout scope one attempt runs in: a listing by its `serviceId`, a ticket by its own lines. */
function scopeOf(base: CheckoutContext, target: BuyNowTarget): CheckoutContext {
	return target.ticket
		? { ...base, ticketId: target.ticket.ref, projectId: null, serviceId: null }
		: { ...base, serviceId: target.itemId, projectId: null, ticketId: null };
}

/**
 * What stands in the account's way, said once above the lines. A line's own obstacle is printed on the
 * line, and `empty` is the panel's own sentence rather than the basket's.
 */
function accountBlockers(view: CheckoutSessionContext): CheckoutBlocker[] {
	const listed = new Set(view.items.map((item) => item.id));
	return view.blockers
		.filter((b) => b.code !== "empty" && !(b.itemId && listed.has(b.itemId)))
		.map((b) => ({ ...b, message: gatedSentence(b, view) }));
}

export default function BuyNowModal({ host = "lane" }: BuyNowModalProps): JSX.Element | null {
	const phase = useSignal<BuyPhase>("preparing");
	const failure = useSignal<string | null>(null);
	/** A card charge is confirmed; waiting for the webhook to credit the wallet before the order. */
	const settling = useSignal(false);
	const confirmRef = useRef<HTMLDivElement>(null);
	const quote = useSignal<TicketFundingQuote | null>(null);
	const stages = useSignal<readonly string[]>([]);
	/** A stage write or the session read after it is in flight. */
	const syncing = useSignal(false);
	const pendingStages = useRef<readonly string[] | null>(null);
	const draining = useRef(false);
	const addMethodOpen = useSignal(false);
	const prepaidPreview = useSignal<PrepaidPreview>(readDevSeam()?.prepaidStages ?? "auto");

	useEffect(() =>
		subscribeDevSeam((seam) => {
			prepaidPreview.value = seam?.prepaidStages ?? "auto";
		}), []);

	// #region Host election
	useEffect(() => registerBuyNowHost(host), [host]);
	const elected = buyNowHost.value === host;
	// #endregion

	// #region Session
	/** Adopt an instrument the offer can complete — a carried-over choice may not be on offer here. */
	const adoptProvider = useCallback((providers: readonly ProviderAvailability[]) => {
		const offer = buyNowOffer(providers);
		const held = chosenProvider.value;
		if (!held || !offer.some((p) => p.provider === held && p.available)) {
			chosenProvider.value =
				offer.find((p) => p.available && (p.provider === "wallet" || p.provider === "card"))
					?.provider ?? null;
		}
	}, []);

	/** Re-read the narrowed session; `false` (and the reason said) when it could not be read. */
	const readSession = useCallback(async (target: BuyNowTarget): Promise<boolean> => {
		const read = await CheckoutService.session({
			...scopeOf(currentCheckoutContext(), target),
			basketId: activeBasketId.value,
		});
		if (pendingStages.current) return true;
		if (!applyResponse(read, applySession)) {
			failure.value = read.message ?? "We couldn't price that purchase just now.";
			return false;
		}
		adoptProvider(read.data?.session.providers ?? []);
		return true;
	}, []);

	/** Write one stage selection as the ticket's lines, then re-read the session priced over them. */
	const writeStages = useCallback(async (want: readonly string[]): Promise<boolean> => {
		const target = buyNowTarget.peek();
		if (!target?.ticket) return false;
		const scoped = scopeOf(currentCheckoutContext(), target);
		const write = await BasketService.setTicketStages(
			target.ticket.ticketId,
			target.ticket.projectId,
			scoped,
			want,
		);
		if (!applyResponse(write, applyBasket)) {
			failure.value = write.message ?? "We couldn't update your basket just now.";
			return false;
		}
		notifyBasketChanged();
		if (pendingStages.current) return true;
		failure.value = null;
		return await readSession(target);
	}, []);

	/**
	 * Queue a selection. One write runs at a time and only the newest waiting selection is sent next,
	 * so the basket and the panel always settle on the last thing the buyer ticked.
	 */
	const syncStages = useCallback(async (want: readonly string[]): Promise<boolean> => {
		pendingStages.current = want;
		syncing.value = true;
		if (draining.current) return true;
		draining.current = true;
		let ok = true;
		while (pendingStages.current) {
			const next = pendingStages.current;
			pendingStages.current = null;
			ok = await writeStages(next);
		}
		draining.current = false;
		syncing.value = false;
		return ok;
	}, []);
	// #endregion

	// #region Preparation
	/**
	 * A listing: add its line, then read the session narrowed to it. A ticket: read its funding quote,
	 * open on the stages already in the basket (else the stage it is funded in), write them as its lines
	 * and read the session narrowed to the ticket.
	 */
	const prepare = useCallback(async () => {
		const target = buyNowTarget.value;
		if (!target) return;
		phase.value = "preparing";
		failure.value = null;
		quote.value = null;
		// A previous attempt's key must never be replayed against a different purchase.
		resetAttempt();

		if (target.ticket) {
			const read = await PaymentsService.ticketFundingQuote(
				target.ticket.projectId,
				target.ticket.ref,
			);
			if (!read.ok || !read.data) {
				failure.value = read.message ?? "We couldn't read what this ticket needs just now.";
				phase.value = "failed";
				return;
			}
			quote.value = read.data.quote;
			const opening = initialStageSelection(
				read.data.quote,
				basketStagesOf(basket.peek()?.items ?? [], ticketRefsOf(target.ticket)),
			);
			stages.value = opening;
			phase.value = (await syncStages(opening)) ? "ready" : "failed";
			return;
		}

		const scoped = scopeOf(currentCheckoutContext(), target);
		const add = await BasketService.addItem(
			{
				basketId: activeBasketId.value,
				itemType: target.itemType,
				itemId: target.itemId,
				quantity: 1,
				metadata: { serviceId: target.itemId },
			},
			scoped,
		);
		if (!applyResponse(add, applyBasket)) {
			failure.value = add.message ?? "We couldn't add that to your basket.";
			phase.value = "failed";
			return;
		}
		notifyBasketChanged();
		phase.value = (await readSession(target)) ? "ready" : "failed";
	}, []);

	useEffect(() => {
		if (!elected) return;
		if (buyNowOpen.value) void prepare();
	}, [elected, buyNowOpen.value, buyNowTarget.value?.itemId, buyNowTarget.value?.ticket?.ref, prepare]);
	// #endregion

	const dismiss = useCallback(() => {
		closeBuyNow();
		lastResult.value = null;
		phase.value = "preparing";
		failure.value = null;
		settling.value = false;
		quote.value = null;
		pendingStages.current = null;
	}, []);

	const chooseStages = (next: string[]) => {
		stages.value = next;
		resetAttempt();
		void syncStages(next);
	};

	// #region Confirm
	/**
	 * Charge the purchase — or, with `override`, place the WALLET order that completes a card charge,
	 * under the charge's own attempt key: a card tops the paying wallet up, the webhook credits it, and
	 * only then is the order placed from the wallet.
	 */
	const confirm = useCallback(async (override?: { provider: "wallet" }) => {
		const view = sessionSignal.value;
		const target = buyNowTarget.value;
		if (!view || !target || submitting.value || syncing.value) return;
		const provider = override?.provider ?? chosenProvider.value;
		if (!provider) {
			failure.value = "Choose how you'd like to pay first.";
			return;
		}
		// Exactly the lines the server priced in the projection above — the same predicate it used.
		const itemIds = view.items.filter(isCheckoutEligible).map((item) => item.id);
		if (itemIds.length === 0) {
			failure.value = "There's nothing payable in this purchase right now.";
			return;
		}

		submitting.value = true;
		failure.value = null;
		const res = await CheckoutService.create({
			basketId: view.basketId,
			ownerType: view.owner.ownerType,
			ownerId: view.owner.ownerId,
			itemIds,
			provider,
			cardId: provider === "card" ? chosenCardId.value : null,
			promoCode: view.promo?.valid ? view.promo.code : null,
			currency: view.currency,
			// The charge the buyer was SHOWN, in the listings' own currency. A witness statement, not a
			// computation — the server recomputes it and refuses on mismatch.
			expectedCharge: view.charge
				? { minor: view.charge.minor, currency: view.charge.currency }
				: null,
			// Buy Now never offers the voluntary gateway contribution, so it is explicitly nothing.
			processingContributionMinor: 0,
			idempotencyKey: newAttemptKey(),
		}, scopeOf(currentCheckoutContext(), target));
		submitting.value = false;

		const landed = applyResponse(res, (data) => {
			lastResult.value = data.result;
		});
		if (!landed) {
			failure.value = res.message ?? "That payment could not be attempted just now.";
			return;
		}
		phase.value = "done";
		notifyBasketChanged();
		const result = lastResult.value;
		// A saved card the bank wants confirmed (3-D Secure) is answered in place, then settles like any card.
		if (
			result?.status === "requires_action" && result.payment &&
			result.payment.confirmation !== "collect"
		) {
			void finishByCard(
				result.payment.paymentId,
				result.payment.confirmation === "authenticate"
					? {
						publishableKey: result.payment.publishableKey,
						clientSecret: result.payment.clientSecret,
					}
					: null,
			);
		}
		// A funded ticket goes back to its line, which re-reads the server and says Funded in place.
		if (result?.status === "succeeded" && target.ticket) {
			target.ticket.onSettled?.();
			dismiss();
		}
	}, []);

	/**
	 * A card the bank accepted: wait for the signed webhook to credit the wallet, then place the order
	 * from it. Nothing is ordered on the browser's word, and a charge that has not cleared is said aloud.
	 */
	const finishByCard = useCallback(async (
		paymentId: string,
		authenticate: { publishableKey: string | null; clientSecret: string } | null,
	) => {
		settling.value = true;
		failure.value = null;
		if (authenticate) {
			try {
				const stripe = await loadStripe(authenticate.publishableKey);
				const { error } = await stripe.handleNextAction({
					clientSecret: authenticate.clientSecret,
				});
				if (error) throw new Error(error.message ?? "Your bank didn't confirm the payment.");
			} catch (error) {
				settling.value = false;
				failure.value = `${
					error instanceof Error ? error.message : "Your bank didn't confirm the payment."
				} Nothing was charged.`;
				resetAttempt();
				return;
			}
		}
		const settled = await PaymentsService.waitForSettlement(paymentId);
		settling.value = false;
		if (settled !== "succeeded") {
			failure.value = settled === "failed"
				? "The card payment didn't go through. Nothing was charged."
				: "Your bank accepted the payment, but it hasn't reached your wallet yet. It completes automatically when it arrives.";
			return;
		}
		await confirm({ provider: "wallet" });
	}, []);
	// #endregion

	if (!elected) return null;

	const view = sessionSignal.value;
	const target = buyNowTarget.value;
	const result = lastResult.value;
	const forTicket = !!target?.ticket;
	const shownQuote = quote.value ? previewQuote(quote.value, prepaidPreview.value) : null;
	const chosenNone = forTicket && stages.value.length === 0;
	const blockers = view ? accountBlockers(view) : [];
	const payable = phase.value === "ready" && view !== null && !syncing.value && !chosenNone &&
		view.blockers.length === 0 && view.items.some(isCheckoutEligible) &&
		chosenProvider.value !== null;

	return (
		<Dialog
			visible={buyNowOpen}
			onVisibleChange={(next) => {
				if (!next) dismiss();
			}}
			header={phase.value === "done" ? "Purchase" : "Buy now"}
			width="min(32rem, 94vw)"
			initialFocusRef={confirmRef}
		>
			<div class="bnow" ref={confirmRef} tabIndex={-1} aria-busy={syncing.value || undefined}>
				{failure.value ? <Message severity="danger" text={failure.value} /> : null}

				{phase.value === "preparing"
					? (
						<p class="bnow__pending" role="status">
							<Icon name="hourglass" size="md" />
							<span>Pricing {target?.title ?? "this purchase"}…</span>
						</p>
					)
					: null}

				{phase.value === "failed"
					? (
						<div class="bnow__recover">
							<Button
								variant="outlined"
								rounded
								icon={<Icon name="refresh" size="sm" />}
								label="Try again"
								onClick={() => void prepare()}
							/>
						</div>
					)
					: null}

				{phase.value === "done" && result
					? (
						<div class="bnow__result" data-status={result.status}>
							<Icon
								name={result.status === "succeeded"
									? "success"
									: result.status === "failed"
									? "error"
									: "hourglass"}
								size="xl"
							/>
							<p class="bnow__result-msg">{refusalLines(result, view ?? null).headline}</p>
							{result.status === "succeeded"
								? (
									<p class="bnow__result-amount">
										<Amount value={result.charged} size="hero" />
									</p>
								)
								: null}
							{result.status === "requires_action" && result.payment
								? settling.value || result.payment.confirmation !== "collect"
									? (
										<p class="bnow__pending" role="status">
											Confirming the payment with your bank…
										</p>
									)
									: (
										<StripeElementPanel
											mode="payment"
											clientSecret={result.payment.clientSecret}
											publishableKey={result.payment.publishableKey}
											submitLabel={`Pay ${result.payment.amount.display}`}
											busy={submitting.value}
											onOutcome={(outcome) => {
												if (outcome.ok && result.payment) {
													void finishByCard(result.payment.paymentId, null);
												}
											}}
										/>
									)
								: result.nextActionUrl
								? (
									<a class="bnow__next" href={result.nextActionUrl} rel="noopener noreferrer">
										Continue
									</a>
								)
								: null}
							{refusalLines(result, view ?? null).reasons.map(({ blocker, sentence }) => (
								<p key={`${blocker.code}-${blocker.itemId ?? "account"}`} class="bnow__blocker">
									<Icon name="warning" size="sm" />
									<span>{sentence}</span>
								</p>
							))}
							<Button variant="text" rounded label="Done" onClick={dismiss} />
						</div>
					)
					: null}

				{phase.value === "ready" && view
					? (
						<>
							{forTicket && shownQuote
								? (
									<section class="bnow__section" aria-labelledby="bnow-stages">
										<h3 class="bnow__head" id="bnow-stages">Stages</h3>
										<StagePicker
											quote={shownQuote}
											selected={stages}
											onChange={chooseStages}
											disabled={submitting.value}
											idPrefix="bnow-stage"
											labelledBy="bnow-stages"
										/>
									</section>
								)
								: null}

							<CheckoutBlockers
								blockers={blockers}
								title="Before you can pay"
								lineIdPrefix="bnow-line-"
								id="bnow-blockers-head"
							/>

							<section class="bnow__section" aria-labelledby="bnow-items">
								<h3 class="bnow__head" id="bnow-items">You're buying</h3>
								<OrderLines
									items={view.items}
									lineIdPrefix="bnow-line-"
									empty={forTicket
										? "Choose at least one stage to pay for."
										: "There's nothing payable in this purchase right now."}
								/>
							</section>

							{chosenNone ? null : (
								<section class="bnow__section" aria-labelledby="bnow-pay">
									<h3 class="bnow__head" id="bnow-pay">How you'll pay</h3>
									<PaymentMethodChooser
										providers={buyNowOffer(view.providers)}
										wallet={view.wallet}
										ownerName={view.owner.name}
										cards={view.savedCards}
										selected={selectedMethodId.value}
										labelledBy="bnow-pay"
										onSelect={selectPaymentMethod}
										onAddCard={() => (addMethodOpen.value = true)}
										canAddCard={view.cardsConnected}
									/>
								</section>
							)}

							{forTicket && !chosenNone
								? (
									<p class="bnow__escrow">
										<Icon name="lock" size="sm" />
										<span>
											{chosenProvider.value === "card"
												? "Your card pays into your wallet first. It is held in escrow from there and released only when you approve the work."
												: "Held in escrow from your wallet, released only when you approve the work."}
										</span>
									</p>
								)
								: null}

							{chosenNone ? null : <OrderTotals view={view} id="bnow-summary" />}

							<div class="bnow__foot">
								<Button
									class="cko-rail__buy"
									severity="accent"
									variant="filled"
									size="lg"
									fluid
									rounded
									loading={submitting.value}
									disabled={!payable || submitting.value}
									label={submitting.value
										? "Taking payment…"
										: chosenNone
										? "Choose a stage to pay for"
										: `Buy now · ${view.totals.total.display}`}
									onClick={() => void confirm()}
								/>
								<a
									class="bnow__full"
									href={checkoutHref(view.basketId, activeOwner.value, {
										serviceId: target?.ticket ? null : target?.itemId ?? null,
										ticketId: target?.ticket?.ref ?? null,
									})}
								>
									Review on the full checkout
								</a>
							</div>

							<AddPaymentMethodModal
								open={addMethodOpen}
								owner={view.owner}
								cardsConnected={view.cardsConnected}
								onSaved={(cardId) => {
									selectPaymentMethod(`card:${cardId}`);
									if (target) void readSession(target);
								}}
							/>
						</>
					)
					: null}
			</div>
		</Dialog>
	);
}
