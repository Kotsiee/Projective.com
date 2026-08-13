import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useCallback, useEffect, useMemo, useRef } from "preact/hooks";
import "../styles/checkout.css";
import { missingBuyerFields } from "@projective/types/finance";
import { Button } from "@projective/ui/fields";
import { Message } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { CheckoutService } from "../core/CheckoutService.ts";
import { basketHref, checkoutStepHref, itemKindLabel } from "../core/basket-model.ts";
import { currentCheckoutContext } from "../core/basket-state.ts";
import { includedNow } from "../core/checkout-model.ts";
import { useCheckoutSeam } from "../core/checkout-seam.ts";
import {
	applyRead,
	billingContextKind,
	buyerDetails,
	CHECKOUT_STEP_EVENT,
	contributionOptedIn,
	detailsDirty,
	seedStep,
	stepError,
} from "../core/checkout-state.ts";
import {
	createDetailsDraft,
	type DetailsDepartments,
	type DetailsDraft,
	detailsFieldId,
	detailsService,
	draftIsDirty,
	draftToSave,
	seedDetailsDraft,
	touchMissing,
} from "../core/details-draft.ts";
import {
	activeBillingContext,
	BillingContextSwitcher,
} from "../components/BillingContextSwitcher.tsx";
import { BillingFields, BillingKindTabs } from "../components/BillingFields.tsx";
import { DeliveryFields } from "../components/DeliveryFields.tsx";
import { InvoicingSetup } from "../components/InvoicingSetup.tsx";
import { Amount } from "../components/Amount.tsx";
import { ProcessingContribution } from "../components/ProcessingContribution.tsx";
import type {
	BasketItem,
	CheckoutSessionContext,
	CheckoutStep,
	CheckoutTotals,
} from "../types/checkout-types.ts";

/**
 * CheckoutDetailsScreen — step 2 of the checkout: where the work goes, and who is invoiced for it.
 *
 * Five rules govern this surface, each of which is a defect this codebase has shipped before:
 *
 * 1. **Completeness is asked once, of the SSOT.** `missingBuyerFields` decides what is outstanding —
 *    the same function the auto-skip redirect, the payment gate and the server all call. A second
 *    test here is how a buyer comes to be skipped past a form that the next step then refuses them
 *    for.
 * 2. **Nothing is painted invalid before the reader has had a turn.** Fields commit on blur and only
 *    then can show a verdict; pressing Continue on an incomplete form touches exactly the paths the
 *    SSOT reports missing, so the refusal always has a visible cause.
 * 3. **Switching billing identity discards nothing.** Both blocks live in the draft, so the tabs are
 *    a view over one record rather than a mode that empties the half they stop showing.
 * 4. **Dirtiness is measured against the record the SERVER last returned**, never against the
 *    immutable SSR prop — the defect both workspace policy screens shipped, where a successful save
 *    left the footer permanently dirty because the baseline could not move.
 * 5. **A failed read is never silent.** Every server round trip goes through `applyRead`, whose
 *    `else` branch is the point: a refetch that fails must say so rather than leaving the previous
 *    answer on screen indistinguishable from a fresh one.
 *
 * ## The summary rail computes nothing
 *
 * The rail beside the form reads the SAME server projection the page was rendered from — the session
 * this step already holds. Every figure on it is a server-computed `MoneyView` rendered through
 * {@link Amount}; there is no subtotal added up here, no fee derived, no currency converted. Opting
 * into the voluntary gateway contribution therefore does not add anything client-side: it re-reads
 * the session with `contribute`, and the whole totals block comes back recomputed. That is also what
 * keeps the total the buyer is shown on this step identical to the one the payment step submits.
 *
 * The step's commit action also lives in the middle-nav footer rig (the region contract), so this
 * body listens for {@link CHECKOUT_STEP_EVENT} and runs the same advance the in-form Continue does.
 * The rig holds the button; the body holds the record being committed, and a rig that assembled its
 * own idea of what was being saved would be a second answer to the same question.
 */

// #region Props
/** Props for {@link CheckoutDetailsScreen}. */
export interface CheckoutDetailsScreenProps {
	/** The SSR-resolved checkout projection, whose `buyer` block seeds the form. */
	session: CheckoutSessionContext;
	/** The `?owner=` scope this read resolved against, carried into every step link. */
	owner: string;
	/** The display currency the server formatted every figure in. */
	display: string;
	/** The departments each billing identity declares, keyed by `BillingContext.id`. */
	departments: DetailsDepartments;
	/** Where a buyer with no company goes to create one; omitted hides the affordance. */
	addBusinessHref?: string;
}
// #endregion

/**
 * Move focus and the viewport to the first control the SSOT reports as missing.
 *
 * Best-effort by construction: the control may be inside the billing block the tabs are not
 * currently showing, in which case there is nothing to focus and the summary above still names it.
 */
function focusPath(path: string): void {
	const el = document.getElementById(detailsFieldId(path));
	if (!el) return;
	el.scrollIntoView({ block: "center", behavior: "smooth" });
	el.focus();
}

export default function CheckoutDetailsScreen(props: CheckoutDetailsScreenProps): JSX.Element {
	const { session, owner, display, departments } = props;

	// Built once: the field primitives seed their internal signal from a raw value exactly once, so a
	// draft rebuilt per render would hand every control a signal it then ignores.
	const draft = useMemo<DetailsDraft>(() => createDetailsDraft(session.buyer), []);
	/** The live server projection — the rail's only source of lines and figures. */
	const view = useSignal<CheckoutSessionContext>(session);
	const contexts = useSignal(session.billingContexts);
	const invoicing = useSignal(session.invoicing);
	const saving = useSignal(false);
	const reading = useSignal(false);
	const saved = useSignal(false);

	// #region Shared state
	useEffect(() => {
		seedStep("details");
		buyerDetails.value = session.buyer;
		billingContextKind.value = session.buyer.contextKind;
		contributionOptedIn.value = session.processingOffer.optedIn;
		return () => {
			stepError.value = null;
		};
	}, []);

	// Dirtiness is published for the footer rig, which cannot see the draft.
	useEffect(() => {
		const stop = draft.record.subscribe(() => {
			detailsDirty.value = draftIsDirty(draft);
			billingContextKind.value = draft.contextKind.peek();
			if (saved.peek()) saved.value = false;
		});
		return stop;
	}, []);
	// #endregion

	// #region Reads
	/**
	 * Re-read the session — after a dev-seam change, or after the contribution offer is answered.
	 *
	 * An in-flight edit is never overwritten: a developer flipping an axis mid-form, or a buyer
	 * ticking the contribution box halfway through the address, would otherwise lose what they had
	 * typed, and the corrected record would look like the form silently reverting.
	 */
	const readSession = useCallback(async (contribute?: boolean): Promise<void> => {
		reading.value = true;
		const res = await CheckoutService.session({
			...currentCheckoutContext(),
			contribute: contribute ?? contributionOptedIn.peek(),
		});
		reading.value = false;
		applyRead(res, (data) => {
			view.value = data.session;
			contexts.value = data.session.billingContexts;
			invoicing.value = data.session.invoicing;
			buyerDetails.value = data.session.buyer;
			if (!draftIsDirty(draft)) seedDetailsDraft(draft, data.session.buyer);
		});
	}, []);

	useCheckoutSeam({
		basketId: session.basketId || null,
		owner,
		display,
		projectId: session.preselect.projectId,
		serviceId: session.preselect.serviceId,
		onRefetch: () => void readSession(),
	});
	// #endregion

	// #region Writes
	/** Persist the whole record as one atomic edit. Returns whether it landed. */
	const save = useCallback(async (): Promise<boolean> => {
		if (saving.peek()) return false;
		saving.value = true;
		const res = await detailsService.saveDetails(draftToSave(draft), currentCheckoutContext());
		saving.value = false;
		return applyRead(res, (data) => {
			// Adopting the server's answer as the new baseline is what lets the dirty flag come down.
			seedDetailsDraft(draft, data.buyer);
			view.value = data.session;
			contexts.value = data.billingContexts;
			invoicing.value = data.invoicing;
			buyerDetails.value = data.buyer;
			detailsDirty.value = false;
			saved.value = true;
		});
	}, []);

	/**
	 * Save, then move to Payment.
	 *
	 * The save is unconditional even for an unchanged record: `buyerDetailsComplete` requires a save
	 * STAMP as well as the fields, so a buyer who edits nothing must still confirm what was pre-filled
	 * for them — which is the rule that stops an order being delivered to a stale address the buyer
	 * never actually looked at.
	 */
	const advance = useCallback(async (): Promise<void> => {
		const missing = missingBuyerFields(draft.record.peek());
		if (missing.length > 0) {
			touchMissing(draft);
			stepError.value = null;
			focusPath(missing[0].path);
			return;
		}
		if (!await save()) return;
		globalThis.location.assign(checkoutStepHref("payment", session.basketId || null, owner));
	}, []);

	// The rig's commit action dispatches rather than submitting, so the body stays the single owner of
	// what is being saved. A ref keeps the listener bound to the current closure without rebinding it.
	const advanceRef = useRef(advance);
	advanceRef.current = advance;
	useEffect(() => {
		const onStep = (event: Event) => {
			const step = (event as CustomEvent<{ step?: CheckoutStep }>).detail?.step;
			if (step === "payment" || step === "details") void advanceRef.current();
		};
		globalThis.addEventListener(CHECKOUT_STEP_EVENT, onStep);
		return () => globalThis.removeEventListener(CHECKOUT_STEP_EVENT, onStep);
	}, []);
	// #endregion

	// #region Derived
	const record = draft.record.value;
	const projection = view.value;
	const missing = missingBuyerFields(record);
	const shownMissing = missing.filter((field) => draft.touched.value[field.path]);
	const activeContext = activeBillingContext(contexts.value, draft.contextId.value);
	const departmentOptions = departments[draft.contextId.value] ?? [];
	const busy = saving.value;
	const lines = projection.items.filter((item) => includedNow(item, item.isSelectedForCheckout));
	// #endregion

	return (
		<div class="ckod">
			<div class="ckod__cols">
				<div class="ckod__form">
					<header class="ckod__head">
						<h1 class="ckod__title">Delivery &amp; billing</h1>
						<p class="ckod__lede">
							Supplied once and kept — the next order will not ask again. You can change any of it
							before you pay.
						</p>
					</header>

					<BillingContextSwitcher
						draft={draft}
						contexts={contexts.value}
						disabled={busy}
						addBusinessHref={props.addBusinessHref}
						onChange={() => {
							// A different identity has a different department list; a stale selection would
							// attribute the spend to a budget the new identity does not have.
							draft.business.departmentId.value = "";
						}}
					/>

					{stepError.value
						? (
							<Message severity="danger" size="sm">
								{stepError.value}
							</Message>
						)
						: null}

					{shownMissing.length > 0
						? (
							<Message severity="warning" size="sm">
								<span class="ckod-missing__lede">Still needed before you can pay:</span>
								<ul class="ckod-missing__list">
									{shownMissing.map((field) => (
										<li key={field.path}>
											<button
												type="button"
												class="ckod-missing__jump"
												onClick={() => focusPath(field.path)}
											>
												{field.label}
											</button>
										</li>
									))}
								</ul>
							</Message>
						)
						: null}

					<section class="ckod__section" aria-labelledby="ckod-delivery">
						<h2 class="ckod__legend" id="ckod-delivery">Delivery</h2>
						<p class="ckod__hint">
							Digital work is delivered in the platform and to this address. Nothing is posted, so
							no street is asked for here.
						</p>
						<DeliveryFields draft={draft} disabled={busy} />
					</section>

					<section class="ckod__section" aria-labelledby="ckod-billing">
						<h2 class="ckod__legend" id="ckod-billing">
							Billing Details{activeContext
								? <span class="ckod__legend-sub">{activeContext.label}</span>
								: null}
						</h2>
						<p class="ckod__hint">
							What appears on the invoice, and where you are for tax purposes.
						</p>
						<BillingKindTabs draft={draft} disabled={busy} />
						<BillingFields
							draft={draft}
							departments={departmentOptions}
							disabled={busy}
							tabbed
						/>
					</section>

					<section class="ckod__section" aria-labelledby="ckod-invoicing">
						<h2 class="ckod__legend" id="ckod-invoicing">Invoicing</h2>
						<InvoicingSetup draft={draft} invoicing={invoicing.value} disabled={busy} />
					</section>

					<div class="ckod__actions">
						<Button
							variant="filled"
							severity="warning"
							size="md"
							rounded
							loading={busy}
							icon={<Icon name="arrow-right" size="xs" />}
							iconPos="right"
							onClick={() => void advance()}
						>
							Continue
						</Button>
						<span class="ckod__actionnote" role="status">
							{busy
								? "Saving…"
								: saved.value
								? "Saved."
								: detailsDirty.value
								? "Unsaved changes."
								: record.savedAt
								? "Saved to your account."
								: "Not saved yet."}
						</span>
						<Button
							class="ckod__save"
							variant="outlined"
							size="sm"
							rounded
							disabled={busy}
							onClick={() => void save()}
						>
							Save details
						</Button>
					</div>
				</div>

				<DetailsSummaryRail
					lines={lines}
					totals={projection.totals}
					session={projection}
					owner={owner}
					busy={busy}
					reading={reading.value}
					onContribute={(next) => {
						contributionOptedIn.value = next;
						void readSession(next);
					}}
					onContinue={() => void advance()}
				/>
			</div>
		</div>
	);
}

// #region Summary rail
/** Props for {@link DetailsSummaryRail}. */
interface DetailsSummaryRailProps {
	/** The lines this payment covers, already narrowed by the server's own selection. */
	lines: readonly BasketItem[];
	/** The server's totals block. Rendered, never summed. */
	totals: CheckoutTotals;
	/** The live projection, for the contribution offer and the way back to the basket. */
	session: CheckoutSessionContext;
	owner: string;
	/** Whether a save is in flight. */
	busy: boolean;
	/** Whether a session re-read is in flight, so the contribution cannot be toggled mid-recompute. */
	reading: boolean;
	onContribute: (next: boolean) => void;
	onContinue: () => void;
}

/**
 * The composition and what it will cost, beside the form.
 *
 * **Read-only, and computed nowhere.** Step 1 owns editing the basket and this rail links back to
 * it; every figure is a server-computed `MoneyView` printed through {@link Amount}, so the rail
 * cannot disagree with the payment step about what is owed.
 *
 * The intermediate lines — discounts, tax, the platform fee when the buyer is the one carrying it —
 * render only when the server sent a non-zero figure for them. That is a presence test on a value
 * the server computed, not arithmetic: it keeps the common case to the three rows the design asks
 * for while never showing Items + Processing that visibly fails to reach the total.
 */
function DetailsSummaryRail(props: DetailsSummaryRailProps): JSX.Element {
	const { lines, totals, session, busy, reading } = props;
	const optedIn = contributionOptedIn.value;
	const feeOnBuyer = totals.platformFeeMode === "buyer_added" && totals.platformFee.minor !== 0;

	return (
		<aside class="ckod-rail" aria-labelledby="ckod-rail-head">
			<div class="ckod-rail__headrow">
				<h2 class="ckod-rail__head" id="ckod-rail-head">Your Basket</h2>
				<a class="ckod-rail__edit" href={basketHref(session.basketId || null, props.owner)}>
					Change
				</a>
			</div>

			{lines.length === 0
				? (
					<p class="ckod-rail__empty" role="status">
						Nothing is selected for this payment yet.
					</p>
				)
				: (
					<ul class="ckod-rail__list">
						{lines.map((item) => (
							<li key={item.id} class="ckod-rail__row">
								<span class="ckod-rail__body">
									<span class="ckod-rail__title">{item.title}</span>
									<span class="ckod-rail__meta">
										<span>
											{item.scheduledLabel ?? item.stageLabel ?? item.subtitle ??
												itemKindLabel(item)}
										</span>
										{item.quantity > 1
											? (
												<>
													<span class="ckod-rail__dot" aria-hidden="true">·</span>
													<span>{`× ${item.quantity}`}</span>
												</>
											)
											: null}
									</span>
								</span>
								<span class="ckod-rail__price">
									<Amount value={item.lineTotal} size="body" hideOrigin />
								</span>
							</li>
						))}
					</ul>
				)}

			<ProcessingContribution
				offer={session.processingOffer}
				optedIn={contributionOptedIn}
				busy={reading}
				onToggle={props.onContribute}
			/>

			<dl class="ckod-rail__totals">
				<div class="ckod-rail__total">
					<dt>Items</dt>
					<dd>
						<Amount value={totals.subtotal} size="body" hideOrigin />
					</dd>
				</div>

				{totals.creatorDiscounts.minor !== 0
					? (
						<div class="ckod-rail__total">
							<dt>Creator discounts</dt>
							<dd>
								<Amount
									value={totals.creatorDiscounts}
									size="body"
									tone="credit"
									sign="−"
									hideOrigin
								/>
							</dd>
						</div>
					)
					: null}

				{totals.promoDiscount.minor !== 0
					? (
						<div class="ckod-rail__total">
							<dt>Promotion</dt>
							<dd>
								<Amount
									value={totals.promoDiscount}
									size="body"
									tone="credit"
									sign="−"
									hideOrigin
								/>
							</dd>
						</div>
					)
					: null}

				{feeOnBuyer
					? (
						<div class="ckod-rail__total">
							<dt>Service fee</dt>
							<dd>
								<Amount value={totals.platformFee} size="body" hideOrigin />
							</dd>
						</div>
					)
					: null}

				{totals.taxes.minor !== 0
					? (
						<div class="ckod-rail__total">
							<dt>{totals.taxNote ?? "Tax"}</dt>
							<dd>
								<Amount value={totals.taxes} size="body" hideOrigin />
							</dd>
						</div>
					)
					: null}

				<div class="ckod-rail__total">
					<dt>Processing fee</dt>
					<dd>
						<Amount
							value={totals.processingContribution}
							size="body"
							tone={optedIn ? "default" : "muted"}
							hideOrigin
						/>
					</dd>
				</div>

				<div class="ckod-rail__total ckod-rail__total--grand">
					<dt>Order Total</dt>
					<dd>
						<Amount value={totals.total} size="lead" />
					</dd>
				</div>
			</dl>

			<Button
				class="ckod-rail__continue"
				variant="filled"
				severity="warning"
				size="lg"
				fluid
				rounded
				loading={busy}
				icon={<Icon name="arrow-right" size="xs" />}
				iconPos="right"
				onClick={props.onContinue}
			>
				Continue
			</Button>
		</aside>
	);
}
// #endregion
