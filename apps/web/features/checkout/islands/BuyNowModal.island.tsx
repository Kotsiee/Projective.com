import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useCallback, useEffect, useMemo, useRef } from "preact/hooks";
import "../styles/checkout.css";
import "@features/profile/styles/profile-hire.css";
import { Icon } from "@projective/ui/icons";
import { Message, ProgressSpinner } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { createModalStack } from "@projective/ui/overlay";
import { displayCurrency as viewerCurrency } from "@projective/ui/display/money";
import { useMaskFigures } from "@projective/ui/utils/screen-share";
import { isCheckoutEligible, type TicketFundingQuote } from "@projective/types/finance";
import { SplitModal } from "@features/profile/components/hire/SplitModal.tsx";
import { SETTLE_MS } from "@features/view/core/cta-feedback.ts";
import { BasketService } from "../core/BasketService.ts";
import { CheckoutService } from "../core/CheckoutService.ts";
import { checkoutHref } from "../core/basket-model.ts";
import { gatedSentence } from "../core/business-gate.ts";
import { type ChargeWitness, chargeWitness, routeGatesFor } from "../core/checkout-model.ts";
import {
	basketStagesOf,
	initialStageSelection,
	type PrepaidPreview,
	previewQuote,
} from "../core/stage-picker.ts";
import { PaymentMethodChooser } from "../components/PaymentChoice.tsx";
import { BuyNowOutcome } from "../components/BuyNowOutcome.tsx";
import {
	BuyNowInputsSkeleton,
	OrderLinesSkeleton,
	OrderTotalsSkeleton,
} from "../components/BuyNowSkeleton.tsx";
import { OrderLines } from "../components/OrderLines.tsx";
import { OrderTotals } from "../components/OrderTotals.tsx";
import { PayGateNotice } from "../components/PayGateNotice.tsx";
import { StagePicker } from "../components/StagePicker.tsx";
import AddPaymentMethodModal from "./AddPaymentMethodModal.island.tsx";
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
	selectCardRoute,
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
	type BuyNowTicket,
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
 * **Two columns (`SplitModal`, `--overlay-w-lg`).** LEFT — the buyer's inputs: a ticket's stages, the
 * escrow terms, and how they pay. RIGHT — the order on a solid `--surface-1` pane beside one hairline:
 * the lines, the server's arithmetic and the Order Total with its FX disclosure, and the one pay
 * notice. The footer holds Review on the full checkout, Cancel and the tier-1 commit, so the commit
 * never scrolls away. Below `--bp-md` the frame docks as a bottom sheet and the columns stack.
 *
 * **What is shown is what is charged.** A listing is added carrying its `serviceId` narrowing token and
 * a ticket's stage lines are written exactly (`replaceStages`); the session is then read narrowed to
 * that scope (`?service_id=` / `?ticket_id=`) and the charge names exactly the lines that session
 * priced. Every stage change rewrites the lines and re-reads the session, one write at a time and the
 * latest selection last; while it does, the ledger's lines and figures shimmer at their own geometry.
 *
 * **The commit settles in place** — idle, pending, then a check for a beat before a ticket's modal
 * closes or a listing shows its outcome. Adding a card is a second frame of this modal's own stack
 * (`createModalStack`): the purchase unmounts while it shows, so one backdrop ever renders, and the
 * new card is the chosen one on return.
 *
 * Guests never reach here: `requestBuyNow` routes them to sign-in.
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

type BuyPhase = "preparing" | "ready" | "failed" | "done";
type CommitPhase = "idle" | "pending" | "settled";
type BuyNowFrame = "buy" | "add-card";

function scopeOf(base: CheckoutContext, target: BuyNowTarget): CheckoutContext {
	const display = viewerCurrency.peek();
	return target.ticket
		? { ...base, display, ticketId: target.ticket.ref, projectId: null, serviceId: null }
		: { ...base, display, serviceId: target.itemId, projectId: null, ticketId: null };
}

function accountBlockers(view: CheckoutSessionContext): CheckoutBlocker[] {
	const listed = new Set(view.items.map((item) => item.id));
	return view.blockers
		.filter((b) => b.code !== "empty" && !(b.itemId && listed.has(b.itemId)))
		.map((b) => ({ ...b, message: gatedSentence(b, view) }));
}

export default function BuyNowModal({ host = "lane" }: BuyNowModalProps): JSX.Element | null {
	const mask = useMaskFigures();
	const phase = useSignal<BuyPhase>("preparing");
	const commit = useSignal<CommitPhase>("idle");
	const failure = useSignal<string | null>(null);
	const settling = useSignal(false);
	const quote = useSignal<TicketFundingQuote | null>(null);
	const stages = useSignal<readonly string[]>([]);
	const syncing = useSignal(false);
	const pendingStages = useRef<readonly string[] | null>(null);
	const draining = useRef(false);
	const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const settledTicket = useRef<BuyNowTicket | null>(null);
	/** The charge and quote a card charge was started for; the wallet order completing it states these. */
	const chargeWitnessRef = useRef<ChargeWitness | null>(null);
	const focusRef = useRef<HTMLDivElement>(null);
	const resultRef = useRef<HTMLDivElement>(null);
	const prepaidPreview = useSignal<PrepaidPreview>(readDevSeam()?.prepaidStages ?? "auto");
	const stack = useMemo(() => createModalStack<BuyNowFrame>(), []);
	const addingCard = useComputed(() => stack.top.value?.kind === "add-card");

	useEffect(() =>
		subscribeDevSeam((seam) => {
			prepaidPreview.value = seam?.prepaidStages ?? "auto";
		}), []);

	useEffect(() => () => {
		if (settleTimer.current !== null) clearTimeout(settleTimer.current);
	}, []);

	// #region Host election
	useEffect(() => registerBuyNowHost(host), [host]);
	const elected = buyNowHost.value === host;
	// #endregion

	// #region Session
	const adoptProvider = useCallback((providers: readonly ProviderAvailability[]) => {
		const offer = buyNowOffer(providers);
		const held = chosenProvider.value;
		if (!held || !offer.some((p) => p.provider === held && p.available)) {
			chosenProvider.value = offer.find((p) =>
				p.available && (p.provider === "wallet" || p.provider === "card")
			)
				?.provider ?? null;
		}
	}, []);

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
	const prepare = useCallback(async () => {
		const target = buyNowTarget.value;
		if (!target) return;
		stack.open("buy", target.itemId);
		phase.value = "preparing";
		commit.value = "idle";
		failure.value = null;
		quote.value = null;
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
	}, [
		elected,
		buyNowOpen.value,
		buyNowTarget.value?.itemId,
		buyNowTarget.value?.ticket?.ref,
		prepare,
	]);
	// #endregion

	const dismiss = useCallback(() => {
		if (settleTimer.current !== null) {
			clearTimeout(settleTimer.current);
			settleTimer.current = null;
		}
		const settled = settledTicket.current;
		settledTicket.current = null;
		stack.close();
		closeBuyNow();
		lastResult.value = null;
		phase.value = "preparing";
		commit.value = "idle";
		failure.value = null;
		settling.value = false;
		quote.value = null;
		pendingStages.current = null;
		settled?.onSettled?.();
	}, []);

	const chooseStages = (next: string[]) => {
		stages.value = next;
		resetAttempt();
		void syncStages(next);
	};

	useEffect(() => {
		if (phase.value !== "done") return;
		const id = setTimeout(() => {
			const node = resultRef.current;
			if (node && !node.contains(document.activeElement)) node.focus({ preventScroll: true });
		}, 0);
		return () => clearTimeout(id);
	}, [phase.value]);

	// #region Confirm
	const settle = (target: BuyNowTarget) => {
		commit.value = "settled";
		if (target.ticket) settledTicket.current = target.ticket;
		settleTimer.current = setTimeout(() => {
			settleTimer.current = null;
			if (target.ticket) {
				dismiss();
				return;
			}
			commit.value = "idle";
			phase.value = "done";
		}, SETTLE_MS);
	};

	/**
	 * Charge the purchase — or, with `override`, place the WALLET order that completes a card charge,
	 * under the charge's own attempt key: a card tops the paying wallet up, the webhook credits it, and
	 * only then is the order placed from the wallet.
	 */
	const confirm = useCallback(async (override?: { provider: "wallet" }) => {
		const view = sessionSignal.value;
		const target = buyNowTarget.value;
		if (!view || !target || submitting.value || syncing.value) return;
		if (!override && commit.value !== "idle") return;
		const provider = override?.provider ?? chosenProvider.value;
		if (!provider) {
			failure.value = "Choose how you'd like to pay first.";
			return;
		}
		const itemIds = view.items.filter(isCheckoutEligible).map((item) => item.id);
		if (itemIds.length === 0) {
			failure.value = "There's nothing payable in this purchase right now.";
			return;
		}

		commit.value = "pending";
		submitting.value = true;
		failure.value = null;
		const witness = (override ? chargeWitnessRef.current : null) ?? chargeWitness(view);
		const res = await CheckoutService.create({
			basketId: view.basketId,
			ownerType: view.owner.ownerType,
			ownerId: view.owner.ownerId,
			itemIds,
			provider,
			cardId: provider === "card" ? chosenCardId.value : null,
			promoCode: view.promo?.valid ? view.promo.code : null,
			currency: view.currency,
			expectedCharge: witness.expectedCharge,
			fxQuoteId: witness.fxQuoteId,
			processingContributionMinor: 0,
			idempotencyKey: newAttemptKey(),
		}, scopeOf(currentCheckoutContext(), target));
		submitting.value = false;

		const landed = applyResponse(res, (data) => {
			lastResult.value = data.result;
			if (data.result.status === "requires_action") chargeWitnessRef.current = witness;
		});
		if (!landed) {
			failure.value = res.message ?? "That payment could not be attempted just now.";
			commit.value = "idle";
			return;
		}
		notifyBasketChanged();
		const result = lastResult.value;
		if (result?.status === "succeeded") {
			settle(target);
			return;
		}
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
			return;
		}
		commit.value = "idle";
		phase.value = "done";
	}, []);

	/**
	 * A card the bank accepted: wait for the signed webhook to credit the wallet, then place the order
	 * from it. Nothing is ordered on the browser's word, and a charge that has not cleared is said aloud.
	 */
	const finishByCard = useCallback(async (
		paymentId: string,
		authenticate: { publishableKey: string | null; clientSecret: string } | null,
	) => {
		commit.value = "pending";
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
				commit.value = "idle";
				return;
			}
		}
		const settled = await PaymentsService.waitForSettlement(paymentId);
		settling.value = false;
		if (settled === "failed") {
			failure.value = "The card payment didn't go through. Nothing was charged.";
			resetAttempt();
			commit.value = "idle";
			return;
		}
		if (settled !== "succeeded") {
			failure.value =
				"Your bank accepted the payment, but it hasn't reached your wallet yet. It completes automatically when it arrives.";
			commit.value = "idle";
			phase.value = "done";
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
	const ready = phase.value === "ready" && view !== null;
	const live = ready && !syncing.value && !chosenNone;
	const gates = live ? routeGatesFor(view, chosenProvider.value, chosenCardId.value) : [];
	const gateLines = live ? [...accountBlockers(view), ...gates] : [];
	const priced = live && view.items.some(isCheckoutEligible);
	const payable = priced && view.blockers.length === 0 && gates.length === 0 &&
		chosenProvider.value !== null;
	const locked = commit.value !== "idle";

	if (addingCard.value && view) {
		return (
			<AddPaymentMethodModal
				open={addingCard}
				onClose={() => {
					stack.back();
				}}
				owner={view.owner}
				cardsConnected={view.cardsConnected}
				onSaved={(cardId) => {
					selectPaymentMethod(`card:${cardId}`);
					if (target) void readSession(target);
				}}
			/>
		);
	}

	const commitLabel = commit.value === "settled"
		? "Paid"
		: commit.value === "pending"
		? settling.value ? "Confirming with your bank…" : "Taking payment…"
		: chosenNone
		? "Choose a stage to pay for"
		: priced
		? `Buy now · ${mask((view.buyerCharge?.quote ? view.buyerCharge : view.totals.total).display)}`
		: "Buy now";

	const commitIcon = commit.value === "pending"
		? <ProgressSpinner size={16} strokeWidth={2} aria-label="Working" class="bnow__spinner" />
		: commit.value === "settled"
		? <Icon name="check" size="sm" class="bnow__check" aria-hidden />
		: <Icon name="lock" size="sm" aria-hidden />;

	const inputs = phase.value === "preparing"
		? <BuyNowInputsSkeleton stages={forTicket} />
		: phase.value === "failed"
		? (
			<div class="bnow__recover">
				<Button
					severity="neutral"
					variant="outlined"
					rounded
					icon={<Icon name="refresh" size="sm" />}
					label="Try again"
					onClick={() => void prepare()}
				/>
			</div>
		)
		: phase.value === "done" && result
		? (
			<BuyNowOutcome
				result={result}
				view={view}
				settling={settling.value}
				busy={submitting.value}
				onCardConfirmed={(paymentId) => void finishByCard(paymentId, null)}
				regionRef={resultRef}
			/>
		)
		: view
		? (
			<fieldset class="bnow__lock" disabled={locked}>
				{forTicket && shownQuote && (
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
						{chosenNone ? null : (
							<p class="bnow__escrow">
								<Icon name="lock" size="sm" />
								<span>
									{chosenProvider.value === "card"
										? "Your card pays into your wallet first, and every stage you chose is paid from there: held in escrow and released only when you approve the work."
										: "Held in escrow from your wallet, released only when you approve the work."}
								</span>
							</p>
						)}
					</section>
				)}

				{chosenNone ? null : (
					<section class="bnow__section" aria-labelledby="bnow-pay">
						<h3 class="bnow__head" id="bnow-pay">How you'll pay</h3>
						<PaymentMethodChooser
							compact
							providers={buyNowOffer(view.providers)}
							wallet={view.wallet}
							ownerName={view.owner.name}
							ownerType={view.owner.ownerType}
							cards={view.savedCards}
							provider={chosenProvider.value}
							cardId={chosenCardId.value}
							labelledBy="bnow-pay"
							onSelect={selectPaymentMethod}
							onSelectCardRoute={selectCardRoute}
							onAddCard={() => {
								stack.push("add-card", "add-card");
							}}
							canAddCard={view.cardsConnected}
							refusalId="bnow-buy-gate"
							settlement={view.settlement}
						/>
					</section>
				)}
			</fieldset>
		)
		: null;

	const ledger = phase.value === "failed" ? null : (
		<div class="bnow-ledger">
			<h3 class="bnow__head" id="bnow-items">Your order</h3>
			{phase.value === "preparing" || !view
				? (
					<>
						<OrderLinesSkeleton count={1} />
						<OrderTotalsSkeleton />
					</>
				)
				: (
					<>
						{syncing.value ? <OrderLinesSkeleton count={stages.value.length} /> : (
							<OrderLines
								items={view.items}
								lineIdPrefix="bnow-line-"
								empty={forTicket
									? "Choose at least one stage to pay for."
									: "There's nothing payable in this purchase right now."}
							/>
						)}
						{chosenNone
							? null
							: <OrderTotals view={view} id="bnow-summary" pending={syncing.value} />}
						<PayGateNotice id="bnow-buy-gate" blockers={gateLines} />
					</>
				)}
		</div>
	);

	const status = phase.value === "preparing"
		? `Pricing ${target?.title ?? "this purchase"}…`
		: commit.value === "settled"
		? "Payment complete."
		: "";

	return (
		<SplitModal
			open={buyNowOpen}
			title={phase.value === "done" ? "Purchase" : "Buy now"}
			subtitle={target?.title}
			class="bnow-split"
			width="var(--overlay-w-lg)"
			asideLabel="Your order"
			loading={phase.value === "preparing" || syncing.value}
			initialFocusRef={focusRef}
			notice={failure.value ? <Message severity="danger" text={failure.value} /> : undefined}
			left={
				<div class="bnow" ref={focusRef} tabIndex={-1}>
					{inputs}
				</div>
			}
			right={ledger}
			summary={
				<>
					{ready && target
						? (
							<a
								class="bnow__full"
								href={checkoutHref(view.basketId, activeOwner.value, {
									serviceId: target.ticket ? null : target.itemId,
									ticketId: target.ticket?.ref ?? null,
								})}
							>
								Review on the full checkout
							</a>
						)
						: null}
					<span class="ui-visually-hidden" role="status">{status}</span>
				</>
			}
			actions={phase.value === "done"
				? <Button variant="text" severity="secondary" rounded label="Done" onClick={dismiss} />
				: (
					<>
						<Button variant="text" severity="secondary" rounded label="Cancel" onClick={dismiss} />
						{phase.value === "failed" ? null : (
							<Button
								class="bnow__commit"
								severity="accent"
								variant="filled"
								rounded
								icon={commitIcon}
								label={commitLabel}
								disabled={!locked && !payable}
								aria-disabled={locked ? "true" : undefined}
								aria-busy={commit.value === "pending" ? "true" : undefined}
								aria-describedby={gateLines.length > 0 ? "bnow-buy-gate" : undefined}
								data-phase={commit.value}
								onClick={() => {
									if (!locked && payable) void confirm();
								}}
							/>
						)}
					</>
				)}
			onClose={dismiss}
		/>
	);
}
