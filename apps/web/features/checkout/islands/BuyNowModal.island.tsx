import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useCallback, useEffect, useRef } from "preact/hooks";
import "../styles/checkout.css";
import { Icon } from "@projective/ui/icons";
import { Dialog, Message } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { PaymentCard } from "@projective/ui/display";
import { isCheckoutEligible, resolveCardArt } from "@projective/types/finance";
import { readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { BasketService } from "../core/BasketService.ts";
import { CheckoutService } from "../core/CheckoutService.ts";
import { checkoutHref } from "../core/basket-model.ts";
import { CardChooser } from "../components/PaymentChoice.tsx";
import { checkoutSim } from "../core/checkout-seam.ts";
import {
	activeBasketId,
	activeOwner,
	applyBasket,
	applyResponse,
	applySession,
	chosenCardId,
	chosenProvider,
	currentCheckoutContext,
	devSim,
	lastResult,
	newAttemptKey,
	notifyBasketChanged,
	resetAttempt,
	session as sessionSignal,
	submitting,
} from "../core/basket-state.ts";
import {
	type BuyNowHost,
	buyNowHost,
	buyNowOpen,
	buyNowTarget,
	closeBuyNow,
	registerBuyNowHost,
} from "../core/buy-now-state.ts";
import type { CheckoutContext, PaymentProvider } from "../types/checkout-types.ts";

/**
 * BuyNowModal — single-listing instant checkout, without leaving Explore or the entity page.
 *
 * **How one listing gets priced on its own.** The shipped `CheckoutSessionContext` totals cover every
 * eligible line in scope, and the charge re-totals over exactly the `itemIds` submitted — so a modal
 * that added a line and then charged only that line while quoting the whole basket's total would be
 * refused with `price_changed` every time. Two ways out existed: silently de-select the buyer's other
 * lines (destructive, and it edits a basket they did not open), or read a NARROWED session. This takes
 * the second: the line is added carrying the `metadata.serviceId` narrowing token, and both the session
 * read and the charge are scoped by `?service_id=`. The client still computes nothing — it submits the
 * exact line set the server priced and quotes the exact total the server returned, so the two agree by
 * construction rather than by arithmetic.
 *
 * **What is shown is what is charged.** When the buyer already holds sibling lines for the same
 * listing, the narrowing keeps them and the modal LISTS them with the total. A quiet subset-charge
 * would be cheaper to build and is the one outcome a purchase surface may never produce.
 *
 * Guests never reach here — {@link requestBuyNow} routes them to sign-in, because every checkout call
 * resolves against an acting account and a guest would arrive at an offer with nothing on it.
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

/** The human name of each payment route — the enum's own vocabulary, never re-invented per surface. */
const PROVIDER_LABEL: Record<PaymentProvider, string> = {
	card: "Card",
	wallet: "Projective wallet",
	google_pay: "Google Pay",
	apple_pay: "Apple Pay",
	paypal: "PayPal",
	invoice: "Invoice",
};

/** How far along one instant-purchase attempt is. */
type BuyPhase = "preparing" | "ready" | "failed" | "done";

export default function BuyNowModal({ host = "lane" }: BuyNowModalProps): JSX.Element | null {
	const phase = useSignal<BuyPhase>("preparing");
	const failure = useSignal<string | null>(null);
	const confirmRef = useRef<HTMLDivElement>(null);

	// #region Host election
	useEffect(() => registerBuyNowHost(host), [host]);
	const elected = buyNowHost.value === host;
	// #endregion

	// #region Preparation
	/**
	 * Add the line, then read the checkout projection narrowed to it.
	 *
	 * Both calls carry the same `serviceId`, so the session's `items` and `totals` describe exactly the
	 * set the confirm step will name.
	 */
	const prepare = useCallback(async () => {
		const target = buyNowTarget.value;
		if (!target) return;
		phase.value = "preparing";
		failure.value = null;
		// A previous attempt's key must never be replayed against a different purchase.
		resetAttempt();

		const base = currentCheckoutContext();
		const scoped: CheckoutContext = { ...base, serviceId: target.itemId, projectId: null };

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

		const read = await CheckoutService.session({ ...scoped, basketId: activeBasketId.value });
		if (!applyResponse(read, applySession)) {
			failure.value = read.message ?? "We couldn't price that purchase just now.";
			phase.value = "failed";
			return;
		}

		// A provider adopted for an earlier scope may not be on offer here. `applySession` only adopts
		// into an EMPTY choice, so an unavailable carry-over is corrected explicitly rather than left to
		// be refused at the last step.
		const offer = read.data?.session.providers ?? [];
		const held = chosenProvider.value;
		if (!held || !offer.some((p) => p.provider === held && p.available)) {
			chosenProvider.value = offer.find((p) => p.available)?.provider ?? null;
		}
		phase.value = "ready";
	}, []);

	useEffect(() => {
		if (!elected) return;
		if (buyNowOpen.value) void prepare();
	}, [elected, buyNowOpen.value, buyNowTarget.value?.itemId, prepare]);

	// A persona flip re-scopes whose money this is, so the whole quote is re-taken; inert in production.
	useEffect(() => {
		if (!elected) return;
		devSim.value = checkoutSim(readDevSeam());
		return subscribeDevSeam((seam) => {
			devSim.value = checkoutSim(seam);
			chosenProvider.value = null;
			chosenCardId.value = null;
			resetAttempt();
			if (buyNowOpen.value) void prepare();
		});
	}, [elected, prepare]);
	// #endregion

	// #region Confirm
	const confirm = useCallback(async () => {
		const view = sessionSignal.value;
		const target = buyNowTarget.value;
		if (!view || !target || submitting.value) return;
		const provider = chosenProvider.value;
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
		const base = currentCheckoutContext();
		const res = await CheckoutService.create({
			basketId: view.basketId,
			ownerType: view.owner.ownerType,
			ownerId: view.owner.ownerId,
			itemIds,
			provider,
			cardId: provider === "card" ? chosenCardId.value : null,
			promoCode: view.promo?.valid ? view.promo.code : null,
			currency: view.currency,
			// The total the buyer was SHOWN. A witness statement, not a computation — the server
			// recomputes it and refuses on mismatch.
			expectedTotalMinor: view.totals.total.minor,
			// Buy Now never offers the voluntary gateway contribution — there is no control here to
			// accept one with — so it is explicitly nothing. It is sent rather than omitted because the
			// server recomputes the total from what the write carries, and a contribution the client
			// left out of the write but had included in `expectedTotalMinor` refuses every attempt as
			// `price_changed`.
			processingContributionMinor: 0,
			idempotencyKey: newAttemptKey(),
		}, { ...base, serviceId: target.itemId, projectId: null });
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
	}, []);

	const dismiss = useCallback(() => {
		closeBuyNow();
		lastResult.value = null;
		phase.value = "preparing";
		failure.value = null;
	}, []);
	// #endregion

	if (!elected) return null;

	const view = sessionSignal.value;
	const target = buyNowTarget.value;
	const result = lastResult.value;
	const blockers = view?.blockers ?? [];
	const payable = phase.value === "ready" && view !== null && blockers.length === 0 &&
		chosenProvider.value !== null;
	const cards = view?.savedCards ?? [];
	const singleCard = cards.length === 1 ? cards[0] : null;

	return (
		<Dialog
			visible={buyNowOpen}
			onVisibleChange={(next) => {
				if (!next) dismiss();
			}}
			header={phase.value === "done" ? "Purchase" : "Buy now"}
			width="min(30rem, 94vw)"
			initialFocusRef={confirmRef}
		>
			<div class="bnow" ref={confirmRef} tabIndex={-1}>
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
							<p class="bnow__result-msg">{result.message}</p>
							{/* Server-formatted. The client never renders a figure it computed. */}
							{result.status === "succeeded"
								? <p class="bnow__result-amount">{result.charged.display}</p>
								: null}
							{result.nextActionUrl
								? (
									<a class="bnow__next" href={result.nextActionUrl} rel="noopener noreferrer">
										Continue
									</a>
								)
								: null}
							{result.blockers.map((blocker) => (
								<p key={`${blocker.code}-${blocker.itemId ?? "account"}`} class="bnow__blocker">
									<Icon name="warning" size="sm" />
									<span>{blocker.message}</span>
								</p>
							))}
							<Button variant="text" rounded label="Done" onClick={dismiss} />
						</div>
					)
					: null}

				{phase.value === "ready" && view
					? (
						<>
							<section class="bnow__section" aria-labelledby="bnow-items">
								<h3 class="bnow__head" id="bnow-items">You're buying</h3>
								<ul class="bnow__items">
									{view.items.map((item) => (
										<li key={item.id} class="bnow__item">
											<span class="bnow__item-body">
												<span class="bnow__item-title">{item.title}</span>
												<span class="bnow__item-meta">
													{item.subtitle ?? item.sellerName ?? ""}
													{item.quantity > 1 ? ` · ×${item.quantity}` : ""}
												</span>
											</span>
											<span class="bnow__item-price">{item.lineTotal.display}</span>
										</li>
									))}
								</ul>
							</section>

							{/* What stands between the reader and paying is the most useful thing on the panel. */}
							{blockers.length > 0
								? (
									<ul class="bnow__blockers" aria-label="Before you can pay">
										{blockers.map((blocker) => (
											<li
												key={`${blocker.code}-${blocker.itemId ?? "account"}`}
												class="bnow__blocker"
											>
												<Icon name="warning" size="sm" />
												<span>{blocker.message}</span>
											</li>
										))}
									</ul>
								)
								: null}

							<section class="bnow__section" aria-labelledby="bnow-pay">
								<h3 class="bnow__head" id="bnow-pay">How you'll pay</h3>
								{
									/*
								  Every route is rendered, refused ones disabled with the server's own reason.
								  Hiding a closed route leaves a buyer looking at a short list with no way to
								  learn why the one they wanted is missing.
								*/
								}
								{
									/*
									 * `role="radiogroup"` requires the radios to be its OWNED children. A `<li>` in between is
									 * a `listitem` — neither a radio nor a generic — so the tree read radiogroup → listitem →
									 * radio and the group lost its members. `role="none"` strips only the `<li>`'s own
									 * semantics; the radio inside keeps all of its. It is the standard fix for a list used as
									 * layout.
									 */
								}
								<ul class="bnow__providers" role="radiogroup" aria-labelledby="bnow-pay">
									{view.providers.map((offer) => (
										<li key={offer.provider} role="none">
											<label
												class="bnow__provider"
												data-available={offer.available ? "true" : "false"}
											>
												<input
													type="radio"
													name="bnow-provider"
													value={offer.provider}
													checked={chosenProvider.value === offer.provider}
													disabled={!offer.available}
													aria-describedby={!offer.available && offer.reason
														? `bnow-reason-${offer.provider}`
														: undefined}
													onChange={() => (chosenProvider.value = offer.provider)}
												/>
												<span class="bnow__provider-label">
													{PROVIDER_LABEL[offer.provider]}
												</span>
												{!offer.available && offer.reason
													? (
														<span
															class="bnow__provider-reason"
															id={`bnow-reason-${offer.provider}`}
														>
															{offer.reason}
														</span>
													)
													: null}
											</label>
										</li>
									))}
								</ul>

								{chosenProvider.value === "card" && singleCard
									? (
										<div class="bnow__card-single">
											<PaymentCard
												card={singleCard}
												art={resolveCardArt({
													brand: singleCard.brand,
													binNumber: singleCard.binNumber,
													isBusinessCard: singleCard.isBusinessCard,
												})}
												size="sm"
											/>
										</div>
									)
									: null}

								{chosenProvider.value === "card" && cards.length > 1
									? (
										<div class="bnow__cards">
											{
												/*
												 * The SAME picker `/checkout` uses, not a second copy of it. The copy this replaced
												 * gave every option `tabIndex={-1}` until one was chosen, so a group with no default
												 * card had no tab stop at all and could not be entered from the keyboard — the exact
												 * trap `CardChooser` guards against, and it also carries the arrow-key model a
												 * radiogroup is expected to have.
												 */
											}
											<CardChooser
												cards={cards}
												chosen={chosenCardId.value}
												onChoose={(id) => (chosenCardId.value = id)}
											/>
										</div>
									)
									: null}
							</section>

							<dl class="bnow__totals">
								<div class="bnow__total-row">
									<dt>Subtotal</dt>
									<dd>{view.totals.subtotal.display}</dd>
								</div>
								{view.totals.platformFeeMode === "buyer_added"
									? (
										<div class="bnow__total-row">
											<dt>Service fee</dt>
											<dd>{view.totals.platformFee.display}</dd>
										</div>
									)
									: null}
								{view.totals.taxNote
									? (
										<div class="bnow__total-row">
											<dt>{view.totals.taxNote}</dt>
											<dd>{view.totals.taxes.display}</dd>
										</div>
									)
									: null}
								<div class="bnow__total-row bnow__total-row--total">
									<dt>Total</dt>
									<dd>{view.totals.total.display}</dd>
								</div>
							</dl>

							<div class="bnow__foot">
								<Button
									fluid
									rounded
									loading={submitting.value}
									disabled={!payable || submitting.value}
									icon={<Icon name="lock" size="sm" />}
									label={submitting.value ? "Paying…" : `Pay ${view.totals.total.display}`}
									onClick={() => void confirm()}
								/>
								<a
									class="bnow__full"
									href={checkoutHref(view.basketId, activeOwner.value, {
										serviceId: target?.itemId ?? null,
									})}
								>
									Review on the full checkout
								</a>
							</div>
						</>
					)
					: null}
			</div>
		</Dialog>
	);
}
