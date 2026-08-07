import type { JSX } from "preact";
import { signal, useSignal } from "@preact/signals";
import type { Signal } from "@preact/signals";
import { useCallback, useEffect, useRef } from "preact/hooks";
import "../styles/checkout.css";
import { itemKindMeta } from "@projective/types/finance";
import { Icon } from "@projective/ui/icons";
import { BasketService } from "../core/BasketService.ts";
import { CheckoutService } from "../core/CheckoutService.ts";
import { basketHref, checkoutHref } from "../core/basket-model.ts";
import {
	applyBasket,
	applyResponse,
	applySession,
	BASKET_REFRESH_EVENT,
	beginLineWrite,
	CHECKOUT_SUBMIT_EVENT,
	checkoutError,
	chosenCardId,
	chosenProvider,
	clearDraft,
	clientBlockers,
	currentCheckoutContext,
	endLineWrite,
	lastResult,
	newAttemptKey,
	pendingLines,
	persistDraft,
	resetAttempt,
	restoreDraft,
	seedCheckoutContext,
	session as sessionSignal,
	submitting,
} from "../core/basket-state.ts";
import {
	attemptFingerprint,
	clientGatesFor,
	emailValid,
	includedNow,
	isStageLadder,
	needsSlotConfirmation,
	resultIcon,
	resultTitle,
	routeGatesFor,
	sectionsOf,
	slotKey,
	stageTally,
	suggestedEmails,
	viewerZone,
} from "../core/checkout-model.ts";
import { useCheckoutSeam } from "../core/checkout-seam.ts";
import { groupIconName } from "../components/checkout-glyphs.tsx";
import { Amount } from "../components/Amount.tsx";
import { CheckoutBlockers } from "../components/CheckoutBlockers.tsx";
import { CheckoutLine, LINE_ID_PREFIX } from "../components/CheckoutLine.tsx";
import { ConfirmPayDialog } from "../components/ConfirmPayDialog.tsx";
import { InvoiceSummary } from "../components/InvoiceSummary.tsx";
import { CardChooser, ProviderChoice } from "../components/PaymentChoice.tsx";
import type { BasketItem, CheckoutBootstrap, PaymentProvider } from "../types/checkout-types.ts";

/**
 * CheckoutScreen — the `/checkout` BODY: what is being paid for, from which account, by which route,
 * and what is currently in the way.
 *
 * Four things it establishes, each of which is a rule rather than a preference:
 *
 * 1. **Nothing here computes money.** Every figure on this surface is a server-computed `MoneyView`
 *    rendered by its `display` string. If this file ever sums, discounts, converts or formats an
 *    amount, it has introduced the second arithmetic path the whole contract exists to prevent.
 * 2. **`expectedTotalMinor` is a witness statement, not a calculation.** It is the total the buyer
 *    was SHOWN; the server recomputes and refuses on mismatch, which is what turns a price that moved
 *    between render and submit into a `price_changed` refusal instead of a silent overcharge.
 * 3. **The attempt key is minted once per attempt and dropped when the purchase changes.** A retry
 *    replays an outcome; a genuinely different purchase must never replay the previous one's.
 * 4. **A refused route is rendered, disabled, and carries its reason.** So is every blocker. Pay is
 *    disabled while any exists, and the reason is always on screen beside it.
 *
 * The Pay control lives in the footer band — the region contract puts every action there — so it
 * dispatches {@link CHECKOUT_SUBMIT_EVENT} and this body, which holds the composition and the
 * blockers, opens the confirmation and runs the charge. A footer that assembled its own idea of what
 * was being bought would be a second answer to the same question, and the two would eventually differ
 * by one line.
 */

// #region Props
/** Props for {@link CheckoutScreen}. */
export interface CheckoutScreenProps {
	/** The SSR-resolved checkout projection and the account's baskets. */
	initial: CheckoutBootstrap;
}
// #endregion

/**
 * Get-or-create a per-key signal.
 *
 * The field primitives are signal-first, and a RAW value seeds their internal signal exactly once
 * (`useControllable` memoises on `[]`) — so a raw prop would desync from the server the first time a
 * refetch corrected it. Controlled signals are the only way a checkbox can be told it was wrong.
 */
function keyedSignal<T>(store: Map<string, Signal<T>>, key: string, initial: T): Signal<T> {
	const found = store.get(key);
	if (found) return found;
	const created = signal<T>(initial);
	store.set(key, created);
	return created;
}

export default function CheckoutScreen(props: CheckoutScreenProps): JSX.Element {
	const { initial } = props;

	// #region Local state
	const selection = useRef(new Map<string, Signal<boolean>>());
	const slots = useRef(new Map<string, Signal<boolean>>());
	const emails = useRef(new Map<string, Signal<string>>());
	const resultRef = useRef<HTMLElement | null>(null);

	const zone = useSignal<string | null>(null);
	const noteDismissed = useSignal(false);
	const confirmOpen = useSignal(false);
	// #endregion

	// #region Reads
	const reload = useCallback(async () => {
		const res = await CheckoutService.session(currentCheckoutContext());
		applyResponse(res, applySession);
	}, []);

	useEffect(() => {
		seedCheckoutContext({
			basketId: initial.session.basketId || null,
			owner: initial.owner,
			display: initial.display,
			projectId: initial.session.preselect.projectId,
			serviceId: initial.session.preselect.serviceId,
		});
		applySession({ session: initial.session });
		restoreDraft(initial.session.basketId);
	}, [initial]);

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

	// The viewer's timezone is a CLIENT fact. Resolving it during SSR would name the server's zone and
	// state a time nobody is in, so the local rendering of a booked slot appears only after hydration.
	useEffect(() => {
		zone.value = viewerZone();
	}, []);
	// #endregion

	const view = sessionSignal.value ?? initial.session;
	const result = lastResult.value;

	// #region Derivations (all read signals, so a change re-renders)
	const selectedOf = (item: BasketItem): boolean =>
		keyedSignal(selection.current, item.id, item.isSelectedForCheckout).value;

	const sections = sectionsOf(view);
	const paying = view.items.filter((item) => includedNow(item, selectedOf(item)));

	const gates = [
		...routeGatesFor(view, chosenProvider.value, chosenCardId.value),
		...clientGatesFor(
			view.items,
			(item) => selectedOf(item),
			Object.fromEntries(
				view.items
					.filter(needsSlotConfirmation)
					.map((item) => [slotKey(item), keyedSignal(slots.current, slotKey(item), false).value]),
			),
		),
	];

	const blockers = [...view.blockers, ...gates];
	const blocked = blockers.length > 0;
	const fingerprint = attemptFingerprint(
		view,
		chosenProvider.value,
		chosenCardId.value,
		selectedOf,
	);
	// #endregion

	// #region Cross-region publication + attempt identity
	// The footer band's Pay control reads `clientBlockers`; publishing from render would be a write
	// during render, so the derived list is synced here instead. The key is what the footer's disabled
	// state actually depends on, so it re-publishes exactly when that changes.
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

	// Sync the controlled per-line signals back to the server's answer, except where a write is still
	// in flight — otherwise an unrelated refetch would stomp the checkbox the buyer just clicked.
	useEffect(() => {
		for (const item of view.items) {
			if (pendingLines.value.has(item.id)) continue;
			const sig = selection.current.get(item.id);
			if (sig && sig.peek() !== item.isSelectedForCheckout) sig.value = item.isSelectedForCheckout;
		}
	}, [view]);

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
	const toggleLine = async (item: BasketItem, next: boolean) => {
		beginLineWrite(item.id);
		const res = await BasketService.updateItem(
			{ basketItemId: item.id, isSelectedForCheckout: next },
			currentCheckoutContext(),
		);
		const applied = applyResponse(res, applyBasket);
		// A refused write must return the control to the truth, or the buyer is looking at a selection
		// the server does not hold and a total that does not match it.
		if (!applied) {
			const sig = selection.current.get(item.id);
			if (sig) sig.value = item.isSelectedForCheckout;
		}
		endLineWrite(item.id);
		// The basket write answers with a BASKET; the totals, the offer and the blockers live on the
		// SESSION, so the projection this page renders has to be re-read.
		await reload();
	};

	const commitEmail = async (item: BasketItem, raw: string) => {
		const value = raw.trim();
		if (value === (item.destinationEmail ?? "")) return;
		if (value.length > 0 && !emailValid(value)) return;
		beginLineWrite(item.id);
		const res = await BasketService.updateItem(
			{ basketItemId: item.id, destinationEmail: value.length > 0 ? value : null },
			currentCheckoutContext(),
		);
		applyResponse(res, applyBasket);
		endLineWrite(item.id);
		await reload();
	};

	const submit = useCallback(async () => {
		const current = sessionSignal.value;
		if (!current || submitting.value) return;

		const provider = chosenProvider.value;
		if (!provider) {
			checkoutError.value = "Choose how you'd like to pay first.";
			return;
		}
		const itemIds = current.items
			.filter((item) =>
				includedNow(
					item,
					keyedSignal(selection.current, item.id, item.isSelectedForCheckout).peek(),
				)
			)
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
			idempotencyKey: newAttemptKey(),
		}, currentCheckoutContext());
		submitting.value = false;
		confirmOpen.value = false;

		applyResponse(res, (data) => {
			lastResult.value = data.result;
			if (data.result.status === "succeeded") clearDraft();
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
	useEffect(() => {
		const handler = () => {
			if (submitting.value) return;
			confirmOpen.value = true;
		};
		globalThis.addEventListener?.(CHECKOUT_SUBMIT_EVENT, handler);
		return () => globalThis.removeEventListener?.(CHECKOUT_SUBMIT_EVENT, handler);
	}, []);
	// #endregion

	// #region Render
	const narrowedTo = view.preselect.projectId ?? view.preselect.serviceId;
	const card = view.savedCards.find((entry) => entry.id === chosenCardId.value) ?? null;
	const done = result?.status === "succeeded";

	return (
		<div class="cko" data-done={done ? "true" : undefined}>
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
								<a
									class="cko-result__cta"
									href={result.nextActionUrl}
									rel="noopener noreferrer"
								>
									<Icon name="external-link" />
									Continue to finish paying
								</a>
							)}
							{result.status === "succeeded" && (
								<>
									{result.walletDelta && (
										<a class="cko-result__link" href="/wallet/transactions">
											View it in your wallet
										</a>
									)}
									<a class="cko-result__link" href={basketHref(null, initial.owner)}>
										Back to your basket
									</a>
								</>
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
					{narrowedTo && !noteDismissed.value && (
						<aside class="cko-note" role="note">
							<span class="cko-note__icon" aria-hidden="true">
								<Icon name="filter" />
							</span>
							<div class="cko-note__body">
								<p class="cko-note__title">This payment covers part of your basket</p>
								<p class="cko-note__text">
									You arrived from a link scoped to one engagement, so only its lines are here.
									Everything else stays in your basket, untouched and uncharged.
								</p>
								<p class="cko-note__actions">
									<a class="cko-note__link" href={checkoutHref(view.basketId, initial.owner)}>
										Pay for everything in this basket instead
									</a>
									<a class="cko-note__link" href={basketHref(view.basketId, initial.owner)}>
										View the full basket
									</a>
								</p>
							</div>
							<button
								type="button"
								class="cko-note__dismiss"
								aria-label="Dismiss this explanation"
								onClick={() => {
									noteDismissed.value = true;
								}}
							>
								<Icon name="close" />
							</button>
						</aside>
					)}

					<CheckoutBlockers
						blockers={blockers}
						title={blockers.length === 1
							? "One thing to sort out first"
							: `${blockers.length} things to sort out first`}
						lineIdPrefix={LINE_ID_PREFIX}
					/>

					<div class="cko__cols">
						<div class="cko__main">
							<section class="cko__section" aria-labelledby="cko-lines-head">
								<div class="cko__headrow">
									<h2 class="cko__head" id="cko-lines-head">Paying for</h2>
									{narrowedTo && (
										<span class="cko__chip">
											<Icon name="filter" />
											Narrowed to one engagement
										</span>
									)}
								</div>

								{sections.length === 0
									? (
										<div class="cko__empty" role="status">
											<Icon name="basket" size="xl" />
											<p class="cko__empty-title">There's nothing to pay for</p>
											<p class="cko__empty-note">
												Add something to your basket, then come back here to pay for it.
											</p>
											<a class="cko__empty-link" href={basketHref(null, initial.owner)}>
												Go to your basket
											</a>
										</div>
									)
									: sections.map((section) => {
										const ladder = isStageLadder(section);
										const tally = ladder ? stageTally(section, selectedOf) : null;
										let step = 0;

										return (
											<section
												key={section.key}
												class="cko-group"
												data-group={section.group}
												data-ladder={ladder ? "true" : undefined}
												aria-labelledby={`cko-group-${section.key}`}
											>
												<div class="cko-group__head">
													<span class="cko-group__icon" aria-hidden="true">
														<Icon name={groupIconName(section.group)} />
													</span>
													<div class="cko-group__names">
														<h3 class="cko-group__label" id={`cko-group-${section.key}`}>
															{section.href
																? (
																	<a
																		class="cko-group__link"
																		href={section.href}
																		target="_blank"
																		rel="noopener noreferrer"
																	>
																		{section.label}
																		<Icon name="external-link" />
																		<span class="ui-visually-hidden">
																			(opens in a new tab)
																		</span>
																	</a>
																)
																: section.label}
														</h3>
														{section.caption && <p class="cko-group__caption">{section.caption}</p>}
													</div>
													{section.subtotal && (
														<span class="cko-group__total">
															<Amount value={section.subtotal} size="lead" />
														</span>
													)}
												</div>

												{
													/*
													 * The stage ladder. A pipeline is bought a stage at a time, so the
													 * block says how much of it this payment covers — a COUNT, which is
													 * the only kind of arithmetic this surface is allowed to do.
													 */
												}
												{tally && tally.total > 1 && (
													<p class="cko-group__ladder" role="status">
														<Icon name="stages" />
														Paying for {tally.now} of {tally.total}{" "}
														stages now. The rest stay in your basket for a later payment.
													</p>
												)}

												<ul class="cko-group__lines">
													{section.items.map((item) => {
														const needsStage = itemNeedsStage(item);
														if (ladder && needsStage) step += 1;
														return (
															<CheckoutLine
																key={item.id}
																item={item}
																selected={keyedSignal(
																	selection.current,
																	item.id,
																	item.isSelectedForCheckout,
																)}
																busy={pendingLines.value.has(item.id)}
																step={ladder && needsStage ? step : null}
																zone={zone.value}
																slotConfirmed={needsSlotConfirmation(item)
																	? keyedSignal(slots.current, slotKey(item), false)
																	: null}
																emailDraft={itemNeedsEmail(item)
																	? keyedSignal(
																		emails.current,
																		item.id,
																		item.destinationEmail ?? "",
																	)
																	: null}
																emailSuggestions={suggestedEmails(view.items, item.id)}
																onToggle={(next) => void toggleLine(item, next)}
																onEmailCommit={(value) => void commitEmail(item, value)}
															/>
														);
													})}
												</ul>
											</section>
										);
									})}
							</section>
						</div>

						<div class="cko__aside">
							<section class="cko__section" aria-labelledby="cko-pay-head">
								<h2 class="cko__head" id="cko-pay-head">How you'll pay</h2>
								<p class="cko__sub">
									Paying from <strong>{view.owner.name}</strong>
									{view.owner.handle && <span class="cko__handle">@{view.owner.handle}</span>}
								</p>

								<ProviderChoice
									providers={view.providers}
									chosen={chosenProvider.value}
									wallet={view.wallet}
									labelledBy="cko-pay-head"
									onChoose={(provider: PaymentProvider) => {
										chosenProvider.value = provider;
									}}
								/>

								{chosenProvider.value === "card" && (
									<div class="cko__cards">
										<h3 class="cko__subhead" id="cko-cards-head">Card to charge</h3>
										<CardChooser
											cards={view.savedCards}
											chosen={chosenCardId.value}
											onChoose={(id) => {
												chosenCardId.value = id;
											}}
										/>
									</div>
								)}
							</section>

							<InvoiceSummary
								totals={view.totals}
								promo={view.promo}
								lineCount={paying.length}
							/>

							{
								/*
								 * The reason, repeated next to the money. The blocker list is at the top of the
								 * body and the Pay control is pinned in the footer band, so on a long checkout
								 * the two can be a screen apart — and a disabled control whose explanation is
								 * off-screen is indistinguishable from a broken one.
								 */
							}
							{blocked && (
								<p class="cko__gate" role="status">
									<Icon name="lock" />
									<span>
										Pay is off until this is sorted: {blockers[0].message}
									</span>
								</p>
							)}
						</div>
					</div>
				</>
			)}

			{
				/*
				 * There is deliberately no second "back to your basket" here. A completed payment already
				 * carries its own onward links inside the result panel, and a duplicate control below it
				 * would be a second answer to "what now" — the same class of duplication the region
				 * contract keeps out of the body.
				 */
			}
			<ConfirmPayDialog
				open={confirmOpen}
				session={{ ...view, provider: chosenProvider.value }}
				lineCount={paying.length}
				card={card}
				busy={submitting.value}
				onConfirm={() => void submit()}
			/>
		</div>
	);
	// #endregion
}

// #region Kind predicates
/**
 * Whether a line's kind must resolve a stage.
 *
 * Reads the SSOT's contract rather than testing for a non-null `stageId`: a ticket that has NOT been
 * routed yet still needs the stage block — that absence is exactly what the block has to report.
 */
function itemNeedsStage(item: BasketItem): boolean {
	return itemKindMeta(item.itemType).needsStage;
}

/** Whether a line's kind must collect a delivery address. */
function itemNeedsEmail(item: BasketItem): boolean {
	return itemKindMeta(item.itemType).needsEmail;
}
// #endregion
