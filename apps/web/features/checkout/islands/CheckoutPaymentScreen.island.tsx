import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useSignal } from "@preact/signals";
import { useCallback, useEffect, useRef } from "preact/hooks";
import "../styles/checkout.css";
import "../styles/checkout-payment.css";
import { itemKindMeta } from "@projective/types/finance";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { CheckoutService } from "../core/CheckoutService.ts";
import { checkoutStepHref, itemKindLabel } from "../core/basket-model.ts";
import {
	applyResponse,
	applySession,
	BASKET_REFRESH_EVENT,
	CHECKOUT_SUBMIT_EVENT,
	checkoutError,
	chosenCardId,
	chosenProvider,
	clearDraft,
	clientBlockers,
	currentCheckoutContext,
	lastResult,
	newAttemptKey,
	persistDraft,
	resetAttempt,
	restoreDraft,
	seedCheckoutContext,
	session as sessionSignal,
	submitting,
} from "../core/basket-state.ts";
import { contributionOptedIn, seedStep } from "../core/checkout-state.ts";
import {
	attemptFingerprint,
	feeDisclosure,
	includedNow,
	resultIcon,
	resultTitle,
	routeGatesFor,
} from "../core/checkout-model.ts";
import { useCheckoutSeam } from "../core/checkout-seam.ts";
import { Amount } from "../components/Amount.tsx";
import { CheckoutBlockers } from "../components/CheckoutBlockers.tsx";
import { ConfirmPayDialog } from "../components/ConfirmPayDialog.tsx";
import {
	CardChooser,
	InstrumentFace,
	instrumentLabel,
	ProviderChoice,
} from "../components/PaymentChoice.tsx";
import { ProcessingContribution } from "../components/ProcessingContribution.tsx";
import { SpendLimitNotice } from "../components/SpendLimitNotice.tsx";
import { groupIconName } from "../components/checkout-glyphs.tsx";
import AddPaymentMethodModal from "./AddPaymentMethodModal.island.tsx";
import { LINE_ID_PREFIX } from "../components/CheckoutLine.tsx";
import type {
	BasketItem,
	CheckoutBootstrap,
	CheckoutSessionContext,
	MoneyView,
	MonthlyInvoicing,
	PaymentProvider,
	PostalAddress,
	SavedCard,
} from "../types/checkout-types.ts";

/**
 * CheckoutPaymentScreen — step 3 of the flow: which instrument, what it will cost, and the commit.
 *
 * ## What it inherited, verbatim and deliberately
 *
 * Four things were lifted from the single-page checkout unchanged because each is load-bearing and
 * each was arrived at by measurement rather than preference:
 *
 * 1. **`expectedTotalMinor` is a witness statement, not a calculation.** It is the total the buyer
 *    was SHOWN; the server recomputes and refuses on mismatch, which is what turns a price that moved
 *    between render and submit into a `price_changed` refusal instead of a silent overcharge.
 * 2. **The attempt key is minted once per attempt and dropped when the purchase changes.** A retry
 *    replays an outcome; a genuinely different purchase must never replay the previous one's.
 * 3. **The footer band owns the commit action, so it dispatches rather than charges.** The rig holds
 *    the button, this body holds the composition and the blockers, and a rig that assembled its own
 *    idea of what was being bought would be a second answer to the same question.
 * 4. **The outcome claims focus, and re-claims it.** The confirm dialog restores focus to its trigger
 *    on an exit ANIMATION, and that trigger has been replaced by the outcome panel — so focus lands
 *    on `<body>` and a buyer who paid by keyboard is left with no position at all. See the effect.
 *
 * ## The two regions
 *
 * **The main column answers "how".** The wallet's own container, the saved-card list, and the actions
 * that follow from them — commit, switch to monthly invoicing, add a card.
 *
 * **The summary rail answers "what, to whom, and for how much".** Where the details go, who is
 * billed, which instrument is charged, what is in the basket, and the arithmetic. It carries its own
 * copy of the commit because it is where the total is, and a buyer reading a total should not have to
 * hunt for the button that agrees to it.
 *
 * ## What this step does NOT do
 *
 * **It does not edit the basket or the details.** Selecting lines belongs to step 1 and the buyer's
 * record belongs to step 2, both of which have the controls for them; this step renders both
 * read-only and links back. Carrying step 1's client-side slot gate here would state a requirement
 * with no control on the page to satisfy it — a dead end dressed as a blocker.
 *
 * **It computes no money.** Every figure is a server-computed `MoneyView`. The voluntary
 * contribution in particular is never added client-side: opting in re-reads the session with
 * `contribute=1`, and the whole totals block comes back recomputed, which is also what keeps
 * `expectedTotalMinor` agreeing with the server's own recompute at charge time.
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

	const fingerprint = attemptFingerprint(
		view,
		chosenProvider.value,
		chosenCardId.value,
		(item: BasketItem) => item.isSelectedForCheckout,
	);
	// #endregion

	// #region Cross-region publication + attempt identity
	// The footer band's Pay control reads `clientBlockers`; publishing from render would be a write
	// during render, so the derived list is synced here instead.
	const gateKey = gates.map((gate) => `${gate.code}:${gate.itemId ?? "-"}`).join("|");
	useEffect(() => {
		clientBlockers.value = gates;
	}, [gateKey]);

	// A changed purchase must not replay the previous purchase's stored outcome.
	useEffect(() => {
		resetAttempt();
	}, [fingerprint]);

	// The buyer's unsubmitted choices survive a reload; the amount and the instrument never do.
	useEffect(() => {
		persistDraft();
	}, [chosenProvider.value, chosenCardId.value]);

	/*
	 * Re-read whenever the ROUTE changes, because the offer and the totals both depend on it — a
	 * wallet payment incurs no gateway cost, so the contribution simply stops being offered.
	 *
	 * The guard is what stops this looping: `applySession` adopts the first available provider when
	 * none is chosen, which would otherwise re-fire this effect on the answer to its own request. The
	 * key is seeded from the SSR paint, so the first render never triggers a redundant read.
	 */
	useEffect(() => {
		const key = `${chosenProvider.value ?? "-"}|${contributionOptedIn.value ? "1" : "0"}`;
		if (readKey.current === "") {
			readKey.current = `${initial.session.provider ?? chosenProvider.value ?? "-"}|${
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

		const provider = chosenProvider.value;
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

	// The footer band's Pay opens the confirmation rather than charging: an irreversible payment gets
	// the platform's established confirm grammar (the wallet's), not a single click in a toolbar.
	const openConfirm = useCallback(() => {
		if (submitting.value) return;
		confirmOpen.value = true;
	}, []);

	useEffect(() => {
		const handler = () => openConfirm();
		globalThis.addEventListener?.(CHECKOUT_SUBMIT_EVENT, handler);
		return () => globalThis.removeEventListener?.(CHECKOUT_SUBMIT_EVENT, handler);
	}, [openConfirm]);
	// #endregion

	// #region Render
	const savedCards = view.savedCards.length > 0 ? view.savedCards : props.cards;
	const card = savedCards.find((entry) => entry.id === chosenCardId.value) ?? null;
	const done = result?.status === "succeeded";
	/**
	 * Whether to show the instrument list at all.
	 *
	 * Keyed on the SERVER's offer rather than on what the buyer has chosen, so the cards paint in the
	 * first byte. `available` is the fat service's verdict from `availableProviders`; when it refused
	 * the card route, `ProviderChoice` above is already rendering that refusal WITH its reason, and a
	 * list of chargeable cards beneath it would contradict the sentence directly above them.
	 */
	const cardRouteOffered = view.providers.some(
		(entry) => entry.provider === "card" && entry.available,
	);
	const showsInvoicing = view.buyer.contextKind === "business" ||
		view.owner.ownerType === "business" || view.owner.ownerType === "organisation";
	const detailsHref = editDetailsHref(initial.owner);
	const buyLabel = submitting.value ? "Taking payment…" : `Buy Now · ${view.totals.total.display}`;

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
							<section class="cko__section" aria-labelledby="cko-pay-head">
								<div class="cko__headrow">
									<h2 class="cko__head" id="cko-pay-head">How you'll pay</h2>
									<p class="cko__sub">
										Paying from <strong>{view.owner.name}</strong>
										{view.owner.handle && <span class="cko__handle">@{view.owner.handle}</span>}
									</p>
								</div>

								<ProviderChoice
									providers={view.providers}
									chosen={chosenProvider.value}
									wallet={view.wallet}
									// The wallet card prints the account it belongs to. It comes from the
									// session's resolved owner rather than the viewer's own name, because on a
									// team or business basket the balance being spent is the ENTITY's.
									ownerName={view.owner.name}
									labelledBy="cko-pay-head"
									onChoose={(provider: PaymentProvider) => {
										chosenProvider.value = provider;
									}}
								/>

								{
									/*
									 * The saved cards are always on screen, not revealed by first choosing the
									 * "card" route.
									 *
									 * The design puts the wallet and the cards in one list of instruments, and a
									 * buyer picks the THING they want to pay with — the route is a consequence of
									 * that choice, not a question asked before it. Gating the list behind
									 * `chosenProvider === "card"` also meant it was absent from the first byte,
									 * since nothing is chosen server-side: the page painted a wallet and no cards
									 * at all, which reads as an account with none saved.
									 *
									 * Choosing a card therefore selects the card route with it. The list is
									 * withheld only when the server has actually refused that route — in which
									 * case `ProviderChoice` above is already showing the refusal and its reason,
									 * and offering the instruments beneath it would contradict that.
									 */
								}
								{cardRouteOffered && (
									<div class="cko__cards">
										<h3 class="cko__subhead" id="cko-cards-head">Card to charge</h3>
										<CardChooser
											cards={savedCards}
											chosen={chosenCardId.value}
											onChoose={(id) => {
												chosenCardId.value = id;
												chosenProvider.value = "card";
											}}
											onAddCard={() => {
												addMethodOpen.value = true;
											}}
										/>
									</div>
								)}

								<div class="cko-pstep__acts">
									<div class="cko-pstep__acts-primary">
										<Button
											class="cko-pstep__buy"
											variant="filled"
											severity="warning"
											rounded
											disabled={blocked}
											loading={submitting.value}
											aria-describedby={blocked ? "cko-buy-gate" : undefined}
											// The SERVER's formatted total, and the SAME words the footer rig's
											// control uses. Two names for one action is worse than two places to
											// press it.
											label={buyLabel}
											onClick={openConfirm}
										/>
										{showsInvoicing && (
											<InvoicingAction
												invoicing={view.invoicing}
												href={detailsHref}
												id="cko-inv-main"
											/>
										)}
									</div>

									{cardRouteOffered && (
										<Button
											class="cko-pstep__addcard"
											variant="outlined"
											size="sm"
											rounded
											icon={<Icon name="plus" />}
											label="Add Card"
											onClick={() => {
												addMethodOpen.value = true;
											}}
										/>
									)}
								</div>
							</section>
						</div>

						<div class="cko-pstep__aside">
							<SummaryRail
								view={view}
								items={paying}
								card={card}
								provider={chosenProvider.value}
								optedIn={contributionOptedIn}
								reading={reading.value}
								onToggleContribution={(next) => {
									contributionOptedIn.value = next;
								}}
								detailsHref={detailsHref}
								showsInvoicing={showsInvoicing}
								blocked={blocked}
								blockerMessage={blockers[0]?.message ?? null}
								submitting={submitting.value}
								buyLabel={buyLabel}
								onBuy={openConfirm}
							/>
						</div>
					</div>
				</>
			)}

			<ConfirmPayDialog
				open={confirmOpen}
				session={{ ...view, provider: chosenProvider.value }}
				lineCount={paying.length}
				card={card}
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
	/** Stretch to the rail's width. */
	fluid?: boolean;
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
					fluid={props.fluid}
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
				class={`ui-button ui-button--outlined ui-button--rounded${
					props.fluid ? " ui-button--fluid" : ""
				} cko-invact__btn`}
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

// #region The summary rail
/**
 * One detail row beneath a basket line: what the money is for, and the per-unit figure it is priced
 * at. Both come straight from the server's projection — the label is a pre-formatted string and the
 * price is a `MoneyView`, so nothing here is derived.
 */
interface RailDetail {
	key: string;
	label: string;
	price: MoneyView;
	/** Whether {@link price} is a per-unit figure rather than what the line costs. */
	perUnit: boolean;
}

/**
 * The detail rows for one basket line.
 *
 * A session's booked slot, a ticket's routed stage and a product's licence are the same thing at this
 * scale — the fact that says WHICH instance of the purchasable this is — so one resolution order
 * covers all three and falls back to the kind's own noun rather than to an empty row.
 *
 * The server sends **one** slot per line, so this returns one row. It is shaped as a list because the
 * design shows a booked session with several sittings, and a line that grows a real `slots[]`
 * projection should extend this function rather than replace the markup around it.
 */
function detailsOf(item: BasketItem): RailDetail[] {
	const base = item.scheduledLabel ?? item.stageLabel ?? item.subtitle ?? itemKindLabel(item);
	const seats = item.seats !== null && item.seats > 1 ? ` · ${item.seats} seats` : "";
	return [{
		key: `${item.id}-detail`,
		label: `${base}${seats}`,
		price: item.unitPrice,
		perUnit: item.quantity > 1,
	}];
}

/**
 * A postal address as at most three printed lines: street, locality, country.
 *
 * Empty parts are dropped rather than printed blank, so a partially-filled record reads as short
 * instead of broken. Nothing is invented — an address with nothing in it returns no lines at all and
 * the caller says so in words.
 */
function addressLines(address: PostalAddress): string[] {
	const street = [address.line1, address.line2].map((part) => part.trim()).filter(Boolean).join(
		", ",
	);
	const locality = [address.city, address.state, address.postcode]
		.map((part) => part.trim())
		.filter(Boolean)
		.join(", ");
	return [street, locality, address.country.trim()].filter(Boolean);
}

/** Props for {@link SummaryRail}. */
interface SummaryRailProps {
	view: CheckoutSessionContext;
	/** The lines this payment covers, already narrowed to what is included. */
	items: readonly BasketItem[];
	/** The card a card payment will charge; `null` for every other route. */
	card: SavedCard | null;
	provider: PaymentProvider | null;
	/** Controlled opt-in for the voluntary gateway contribution. */
	optedIn: Signal<boolean>;
	/** Whether a session read is in flight, so the contribution cannot be toggled mid-recompute. */
	reading: boolean;
	onToggleContribution: (next: boolean) => void;
	detailsHref: string;
	showsInvoicing: boolean;
	blocked: boolean;
	/** The first obstacle's own sentence, repeated beside the money; `null` when nothing blocks. */
	blockerMessage: string | null;
	submitting: boolean;
	/** The commit label, identical to the main column's and the footer rig's. */
	buyLabel: string;
	onBuy: () => void;
}

/**
 * The order summary: who it goes to, who is billed, what is charged, and the arithmetic.
 *
 * **Every figure is the server's.** The rail prints `MoneyView`s and never sums, formats or converts
 * one — which is also why the contribution's toggle re-reads the session instead of adding to a total
 * on the client.
 *
 * **The blocks are separated by spacing, a tonal ground and ONE hairline** (§B.4). Nothing here is
 * interactive except the two commits, the "Change Details" link and the contribution checkbox, so
 * nothing here is boxed.
 */
function SummaryRail(props: SummaryRailProps): JSX.Element {
	const { view, items, card, provider, blocked } = props;
	const { buyer, totals } = view;

	const fee = feeDisclosure(totals);
	const hasTax = totals.taxes.minor > 0 || totals.taxNote !== null;
	const showsContribution = view.processingOffer.offered ||
		totals.processingContribution.minor > 0;

	const deliveryName = `${buyer.delivery.firstName} ${buyer.delivery.lastName}`.trim();
	const business = buyer.contextKind === "business";
	const billingName = business ? buyer.business.companyName.trim() : buyer.personal.name.trim();
	const billingEmail = business
		? buyer.business.corporateEmail.trim()
		: buyer.personal.email.trim();
	const billingPhone = business ? buyer.business.phone.trim() : buyer.personal.phone.trim();
	const billingAddress = addressLines(business ? buyer.business.address : buyer.personal.address);

	return (
		<section class="cko-rail" aria-labelledby="cko-rail-head">
			<h2 class="ui-visually-hidden" id="cko-rail-head">Order summary</h2>

			<p class="cko-rail__changerow">
				<a class="cko-rail__change" href={props.detailsHref}>Change Details</a>
			</p>

			<section class="cko-rail__sec" aria-labelledby="cko-rail-delivery">
				<h3 class="cko-rail__head" id="cko-rail-delivery">Delivery Details</h3>
				<div class="cko-rail__pair">
					<span class="cko-rail__name">{deliveryName || "No name saved"}</span>
					<span class="cko-rail__stack">
						{buyer.delivery.email
							? <span class="cko-rail__line">{buyer.delivery.email}</span>
							: <span class="cko-rail__line" data-empty="true">No email saved</span>}
					</span>
				</div>
			</section>

			<section class="cko-rail__sec" aria-labelledby="cko-rail-billing">
				<h3 class="cko-rail__head" id="cko-rail-billing">Billing Details</h3>
				<div class="cko-rail__pair">
					<span class="cko-rail__name">{billingName || "No billing name saved"}</span>
					<span class="cko-rail__stack">
						{billingEmail && <span class="cko-rail__line">{billingEmail}</span>}
						{billingPhone && <span class="cko-rail__line">{billingPhone}</span>}
						{billingAddress.map((line) => <span key={line} class="cko-rail__line">{line}</span>)}
						{!billingEmail && !billingPhone && billingAddress.length === 0 && (
							<span class="cko-rail__line" data-empty="true">No billing details saved</span>
						)}
					</span>
				</div>
			</section>

			<section class="cko-rail__sec" aria-labelledby="cko-rail-card">
				<h3 class="cko-rail__head" id="cko-rail-card">Card</h3>
				<div class="cko-rail__pair">
					<InstrumentFace
						class="cko-rail__face"
						provider={provider}
						card={card}
						ownerName={view.owner.name}
					/>
					<span class="cko-rail__stack">
						<span class="cko-rail__line">{instrumentLabel(provider, card)}</span>
						{provider === "card" && card?.last4 && (
							<span class="cko-rail__line" data-quiet="true">
								<span aria-hidden="true">••••</span>
								<span class="ui-visually-hidden">ending</span>
								{card.last4}
							</span>
						)}
					</span>
				</div>
			</section>

			<hr class="cko-rail__divider" />

			<section class="cko-rail__sec" aria-labelledby="cko-rail-basket">
				<h3 class="cko-rail__head" id="cko-rail-basket">Your Basket</h3>

				{items.length === 0
					? (
						<p class="cko-rail__empty" role="status">
							Nothing is selected for this payment yet.
						</p>
					)
					: (
						<ul class="cko-rail__items">
							{items.map((item) => (
								<li key={item.id} class="cko-rail__item">
									<span class="cko-rail__thumb" aria-hidden="true">
										{item.thumbnail
											? (
												<img
													class="cko-rail__thumbimg"
													src={item.thumbnail}
													alt=""
													loading="lazy"
												/>
											)
											: <Icon name={groupIconName(itemKindMeta(item.itemType).group)} />}
									</span>

									<span class="cko-rail__itembody">
										<span class="cko-rail__itemtitle">{item.title}</span>

										<ul class="cko-rail__slots">
											{detailsOf(item).map((detail) => (
												<li key={detail.key} class="cko-rail__slot">
													<span class="cko-rail__slotlabel">
														{detail.label}
														{item.quantity > 1 && (
															<span class="cko-rail__qty">{`× ${item.quantity}`}</span>
														)}
													</span>
													<Amount
														value={detail.price}
														size="micro"
														tone="muted"
														hideOrigin
														srLabel={detail.perUnit ? `${detail.price.display} each` : undefined}
													/>
												</li>
											))}
										</ul>

										<span class="cko-rail__linetotal">
											<Amount value={item.lineTotal} size="lead" />
										</span>
									</span>
								</li>
							))}
						</ul>
					)}
			</section>

			<ProcessingContribution
				offer={view.processingOffer}
				optedIn={props.optedIn}
				busy={props.reading}
				onToggle={props.onToggleContribution}
			/>

			{
				/*
				 * The arithmetic, as a polite live region: a promo landing or a contribution being
				 * accepted changes what the buyer will be charged, and a total that changes silently is a
				 * total nobody re-reads. `#cko-summary` is also where a `price_changed` refusal points.
				 */
			}
			<div class="cko-rail__totals" id="cko-summary" role="status" aria-live="polite">
				<dl class="cko-rail__rows">
					<div class="cko-rail__row">
						<dt class="cko-rail__label">Items</dt>
						<dd class="cko-rail__value">
							<Amount value={totals.subtotal} hideOrigin />
						</dd>
					</div>

					{totals.creatorDiscounts.minor > 0 && (
						<div class="cko-rail__row" data-kind="discount">
							<dt class="cko-rail__label">Seller discounts</dt>
							<dd class="cko-rail__value">
								<Amount value={totals.creatorDiscounts} tone="credit" sign="−" hideOrigin />
							</dd>
						</div>
					)}

					{view.promo?.valid && (
						<div class="cko-rail__row" data-kind="discount">
							<dt class="cko-rail__label">{view.promo.label}</dt>
							<dd class="cko-rail__value">
								<Amount value={totals.promoDiscount} tone="credit" sign="−" hideOrigin />
							</dd>
						</div>
					)}

					{
						/*
						 * The one line that can be presented dishonestly. Under the platform's documented
						 * default the fee comes out of the seller's release, so showing it as an addition
						 * would overstate what the buyer pays by exactly the fee. `feeDisclosure` owns the
						 * branch; the note says in words what the tone says in colour.
						 */
					}
					<div class="cko-rail__row" data-kind="fee" data-charged={fee.charged ? "true" : "false"}>
						<dt class="cko-rail__label">
							{fee.label}
							<span class="cko-rail__note">{fee.note}</span>
						</dt>
						<dd class="cko-rail__value">
							<Amount
								value={totals.platformFee}
								tone={fee.charged ? "default" : "muted"}
								hideOrigin
								srLabel={fee.charged
									? undefined
									: `${totals.platformFee.display}, paid by the seller, not added to your total`}
							/>
						</dd>
					</div>

					{hasTax && (
						<div class="cko-rail__row" data-kind="tax">
							<dt class="cko-rail__label">
								Tax
								{totals.taxNote && <span class="cko-rail__note">{totals.taxNote}</span>}
							</dt>
							<dd class="cko-rail__value">
								<Amount value={totals.taxes} hideOrigin />
							</dd>
						</div>
					)}

					{showsContribution && (
						<div class="cko-rail__row" data-kind="contribution">
							<dt class="cko-rail__label">Processing fee</dt>
							<dd class="cko-rail__value">
								<Amount
									value={totals.processingContribution}
									tone={props.optedIn.value ? "default" : "muted"}
									hideOrigin
								/>
							</dd>
						</div>
					)}
				</dl>

				<p class="cko-rail__grand">
					<span class="cko-rail__grand-label">Order Total</span>
					<Amount value={totals.total} size="hero" />
				</p>
			</div>

			{
				/*
				 * The reason, repeated next to the money. The blocker list is at the top of the body and
				 * the Pay control is also pinned in the footer band, so on a long checkout the two can be
				 * a screen apart — and a disabled control whose explanation is off-screen is
				 * indistinguishable from a broken one. Both Buy Now controls describe themselves by it.
				 */
			}
			{blocked && props.blockerMessage && (
				<p class="cko__gate" id="cko-buy-gate" role="status">
					<Icon name="lock" />
					<span>Pay is off until this is sorted: {props.blockerMessage}</span>
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
					loading={props.submitting}
					aria-describedby={blocked ? "cko-buy-gate" : undefined}
					label={props.buyLabel}
					onClick={props.onBuy}
				/>
				<p class="cko-rail__reassure">
					<Icon name="lock" />
					<span>You'll confirm the amount before anything is charged.</span>
				</p>
			</div>

			{props.showsInvoicing && (
				<>
					<p class="cko-rail__or">
						<span class="cko-rail__or-word">OR</span>
					</p>
					<InvoicingAction
						invoicing={view.invoicing}
						href={props.detailsHref}
						id="cko-inv-rail"
						fluid
					/>
				</>
			)}
		</section>
	);
}
// #endregion
