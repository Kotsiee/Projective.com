import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useCallback, useEffect, useRef } from "preact/hooks";
import "../styles/checkout.css";
import "../styles/checkout-payment.css";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { CheckoutService } from "../core/CheckoutService.ts";
import { basketHref, checkoutStepHref } from "../core/basket-model.ts";
import {
	applyResponse,
	applySession,
	BASKET_REFRESH_EVENT,
	checkoutError,
	chosenCardId,
	chosenProvider,
	clearDraft,
	currentCheckoutContext,
	lastResult,
	newAttemptKey,
	persistDraft,
	resetAttempt,
	restoreDraft,
	seedCheckoutContext,
	selectedMethodId,
	selectPaymentMethod,
	session as sessionSignal,
	submitting,
} from "../core/basket-state.ts";
import { contributionOptedIn, seedStep } from "../core/checkout-state.ts";
import {
	attemptFingerprint,
	includedNow,
	resultIcon,
	resultTitle,
	routeGatesFor,
} from "../core/checkout-model.ts";
import { useCheckoutSeam } from "../core/checkout-seam.ts";
import { Amount } from "../components/Amount.tsx";
import { CheckoutBlockers } from "../components/CheckoutBlockers.tsx";
import { CheckoutContractBanner } from "../components/CheckoutContractBanner.tsx";
import { ConfirmPayDialog } from "../components/ConfirmPayDialog.tsx";
import { OrderSummaryRail } from "../components/OrderSummaryRail.tsx";
import { ExpressCheckout, PaymentMethodChooser } from "../components/PaymentChoice.tsx";
import { SpendLimitNotice } from "../components/SpendLimitNotice.tsx";
import AddPaymentMethodModal from "./AddPaymentMethodModal.island.tsx";
import { LINE_ID_PREFIX } from "../components/CheckoutLine.tsx";
import type {
	BasketItem,
	CheckoutBootstrap,
	MonthlyInvoicing,
	PaymentProvider,
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
 * 1. **`expectedTotalMinor` is a witness statement, not a calculation.** It is the total the buyer
 *    was SHOWN; the server recomputes and refuses on mismatch, which is what turns a price that moved
 *    between render and submit into a `price_changed` refusal instead of a silent overcharge.
 * 2. **The attempt key is minted once per attempt and dropped when the purchase changes.** A retry
 *    replays an outcome; a genuinely different purchase must never replay the previous one's.
 * 3. **The outcome claims focus, and re-claims it.** The confirm dialog restores focus to its trigger
 *    on an exit ANIMATION, and that trigger has been replaced by the outcome panel — so focus lands
 *    on `<body>` and a buyer who paid by keyboard is left with no position at all. See the effect.
 *
 * ## The three regions
 *
 * **The banner states the contract.** Where the work goes, who is billed, what currency it settles in
 * and — only when one applies — the FX rate it was priced at. All of it already decided, all of it one
 * link from being changed.
 *
 * **The main column answers "how".** One list of instruments the buyer owns — the Projective wallet
 * and every card on file — sharing one selection, plus the alternative arrangement (monthly
 * invoicing) for the identities that qualify for it.
 *
 * **The summary rail answers "how much", and carries the commit.** The lines, the arithmetic, the
 * express sheets and Buy Now, in that order, so the button that agrees to a total is beside the total
 * it agrees to rather than a screen away from it.
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
 * the whole totals block comes back recomputed, which is also what keeps `expectedTotalMinor`
 * agreeing with the server's own recompute at charge time.
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
}
// #endregion

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
	 * The express route a confirmation is open for, or `null` for the selected instrument.
	 *
	 * Express is a separate act from selecting, so it must not overwrite the buyer's saved-method
	 * choice: pressing PayPal and then dismissing the confirmation has to leave the wallet or card they
	 * had picked exactly as it was. Holding the route for the life of one confirmation is what keeps
	 * those two decisions independent.
	 */
	const expressRoute = useSignal<PaymentProvider | null>(null);
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
		});
		applySession({ session: initial.session });
		restoreDraft(initial.session.basketId);
		contributionOptedIn.value = initial.session.processingOffer.optedIn;
		if (chosenCardId.value === null) chosenCardId.value = props.defaultCardId;
	}, [initial, props.defaultCardId]);

	useCheckoutSeam({
		basketId: initial.session.basketId || null,
		owner: initial.owner,
		display: initial.display,
		projectId: initial.session.preselect.projectId,
		serviceId: initial.session.preselect.serviceId,
		onRefetch: () => void reload(),
	});

	useEffect(() => {
		const refresh = () => void reload();
		globalThis.addEventListener?.(BASKET_REFRESH_EVENT, refresh);
		return () => globalThis.removeEventListener?.(BASKET_REFRESH_EVENT, refresh);
	}, [reload]);
	// #endregion

	const view = sessionSignal.value ?? initial.session;
	const result = lastResult.value;

	// #region Derivations (all read signals, so a change re-renders)
	const paying = view.items.filter((item) => includedNow(item, item.isSelectedForCheckout));

	const gates = routeGatesFor(view, chosenProvider.value, chosenCardId.value);
	const blockers = [...view.blockers, ...gates];
	const blocked = blockers.length > 0;
	/** Blockers that an express sheet cannot clear either — everything except "pick an instrument". */
	const hardBlocked = view.blockers.length > 0;

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
	// #endregion

	// #region Writes
	const submit = useCallback(async () => {
		const current = sessionSignal.value;
		if (!current || submitting.value) return;

		// The express route wins for the life of one confirmation; otherwise the selected instrument.
		const provider = expressRoute.value ?? chosenProvider.value;
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
		const res = await CheckoutService.create({
			basketId: current.basketId,
			ownerType: current.owner.ownerType,
			ownerId: current.owner.ownerId,
			itemIds,
			provider,
			cardId: provider === "card" ? chosenCardId.value : null,
			promoCode: current.promo?.valid ? current.promo.code : null,
			currency: current.currency,
			// The total the buyer was SHOWN. Never recomputed here — the server re-verifies it and
			// refuses on mismatch, which is what makes a moved price a refusal instead of an overcharge.
			expectedTotalMinor: current.totals.total.minor,
			// The SERVER's own contribution figure, echoed back rather than re-derived. It is part of
			// the total above, so a write that omitted it would make the server's recompute lower by
			// exactly the contribution and refuse every attempt as `price_changed`.
			processingContributionMinor: current.totals.processingContribution.minor,
			billingContextId: current.buyer.contextId,
			idempotencyKey: newAttemptKey(),
		}, {
			...currentCheckoutContext(),
			provider,
			contribute: contributionOptedIn.value,
		});
		submitting.value = false;
		confirmOpen.value = false;
		expressRoute.value = null;

		applyResponse(res, (data) => {
			lastResult.value = data.result;
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
			// A FAILED charge moved no money, so there is nothing to protect against a duplicate of —
			// and replaying a stored refusal forever would leave "try again" unable to try anything.
			// `succeeded` / `pending` / `requires_action` keep the key, because those are the states
			// where a repeat would be real money.
			if (data.result.status === "failed") resetAttempt();
		});
		await reload();
	}, [reload]);

	/**
	 * Open the confirmation rather than charging.
	 *
	 * An irreversible payment gets the platform's established confirm grammar (the wallet's), not a
	 * single click. An express route travels through the SAME gate: the vendor's sheet is where the
	 * buyer approves the payment, but this is where they approve the AMOUNT, and the two are different
	 * agreements.
	 */
	const openConfirm = useCallback((route?: PaymentProvider) => {
		if (submitting.value) return;
		expressRoute.value = route ?? null;
		confirmOpen.value = true;
	}, []);
	// #endregion

	// #region Render
	const savedCards = view.savedCards.length > 0 ? view.savedCards : props.cards;
	const card = savedCards.find((entry) => entry.id === chosenCardId.value) ?? null;
	const done = result?.status === "succeeded";
	const showsInvoicing = view.buyer.contextKind === "business" ||
		view.owner.ownerType === "business" || view.owner.ownerType === "organisation";
	const detailsHref = editDetailsHref(initial.owner);
	const buyLabel = submitting.value ? "Taking payment…" : `Buy Now · ${view.totals.total.display}`;
	// The route the confirmation is actually about, so the dialog never names the instrument the buyer
	// had selected when they pressed an express button instead.
	const confirmProvider = expressRoute.value ?? chosenProvider.value;

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
						<p class="cko-result__text">{result.message}</p>

						{result.blockers.length > 0 && (
							<ul class="cko-result__reasons">
								{result.blockers.map((blocker, index) => (
									<li key={`${blocker.code}-${index}`} data-code={blocker.code}>
										{blocker.message}
										{blocker.code === "price_changed" && (
											<a class="cko-result__jump" href="#cko-summary">See the new total</a>
										)}
									</li>
								))}
							</ul>
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
					<CheckoutBlockers
						blockers={blockers}
						title={blockers.length === 1
							? "One thing to sort out first"
							: `${blockers.length} things to sort out first`}
						lineIdPrefix={LINE_ID_PREFIX}
					/>

					<SpendLimitNotice limit={view.spendLimit} />

					<div class="cko-pstep__cols">
						<div class="cko-pstep__main">
							<CheckoutContractBanner
								buyer={view.buyer}
								settlement={view.settlement}
								detailsHref={detailsHref}
							/>

							<section class="cko__section" aria-labelledby="cko-pay-head">
								<div class="cko__headrow">
									<h2 class="cko__head" id="cko-pay-head">How you'll pay</h2>
									<p class="cko__sub">
										Paying from <strong>{view.owner.name}</strong>
										{view.owner.handle && <span class="cko__handle">@{view.owner.handle}</span>}
									</p>
								</div>

								{
									/*
									 * ONE list, ONE selection. The wallet and the cards write the same
									 * `selectedMethodId`, so choosing a card cannot leave the wallet looking chosen
									 * and vice versa — the two presentations are two drawings of one decision.
									 */
								}
								<PaymentMethodChooser
									providers={view.providers}
									wallet={view.wallet}
									// The wallet card prints the account it belongs to. It comes from the
									// session's resolved owner rather than the viewer's own name, because on a
									// team or business basket the balance being spent is the ENTITY's.
									ownerName={view.owner.name}
									cards={savedCards}
									selected={selectedMethodId.value}
									labelledBy="cko-pay-head"
									onSelect={selectPaymentMethod}
									onAddCard={() => {
										addMethodOpen.value = true;
									}}
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
							>
								<ExpressCheckout
									providers={view.providers}
									busy={submitting.value}
									blocked={hardBlocked}
									onPay={(provider) => openConfirm(provider)}
								/>

								{
									/*
									 * Two hairlines meeting a word is one separation device drawn across the row,
									 * not a box — and the word stays in the accessibility tree because "these are
									 * two different ways to pay" is a fact a reader needs, not decoration.
									 */
								}
								<p class="cko-rail__or">
									<span class="cko-rail__or-word">OR PAY WITH SAVED METHOD</span>
								</p>

								{
									/*
									 * The reason, repeated next to the money. A disabled control whose explanation
									 * lives elsewhere on the page is indistinguishable from a broken one.
									 */
								}
								{blocked && blockers[0] && (
									<p class="cko__gate" id="cko-buy-gate" role="status">
										<Icon name="lock" />
										<span>Pay is off until this is sorted: {blockers[0].message}</span>
									</p>
								)}

								<div class="cko-rail__commit">
									<Button
										class="cko-rail__buy"
										variant="filled"
										severity="warning"
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

			<AddPaymentMethodModal open={addMethodOpen} />
		</div>
	);
	// #endregion
}

// #region Route back to the buyer's record
/**
 * The Details step, forced into edit mode.
 *
 * `?edit=1` is mandatory, not decoration: the Details step auto-skips a buyer whose record is already
 * complete, so without the flag every route back into the form redirects straight past it and the
 * settings become unreachable the moment they are filled in.
 */
function editDetailsHref(owner: string): string {
	const base = checkoutStepHref("details", null, owner);
	return `${base}${base.includes("?") ? "&" : "?"}edit=1`;
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
					On — this purchase joins your {invoicing.nextStatementLabel ?? "next monthly statement"}.
				</p>
			)}
		</div>
	);
}
// #endregion
