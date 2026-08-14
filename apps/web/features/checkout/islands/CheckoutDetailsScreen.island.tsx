import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useCallback, useEffect, useMemo } from "preact/hooks";
import "../styles/checkout.css";
import { missingBuyerFields } from "@projective/types/finance";
import { Button } from "@projective/ui/fields";
import { Message } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { CheckoutService } from "../core/CheckoutService.ts";
import { basketHref, checkoutStepHref } from "../core/basket-model.ts";
import { currentCheckoutContext } from "../core/basket-state.ts";
import { includedNow } from "../core/checkout-model.ts";
import { useCheckoutSeam } from "../core/checkout-seam.ts";
import {
	applyRead,
	billingContextKind,
	buyerDetails,
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
import { BillingFields } from "../components/BillingFields.tsx";
import { DeliveryFields } from "../components/DeliveryFields.tsx";
import { InvoicingSetup } from "../components/InvoicingSetup.tsx";
import { OrderSummaryRail } from "../components/OrderSummaryRail.tsx";
import type { CheckoutSessionContext } from "../types/checkout-types.ts";

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
 * ## One commitment, in the rail
 *
 * The step runs in focus chrome and carries no footer band, so the summary rail's Continue is the
 * page's single `filled` action (§B.8.2) — placed beside the figure it commits to. The form's own
 * foot keeps only the quiet `outlined` Save details, which saves and stays. Two Continues that did
 * the same thing left a reader working out whether they did.
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

						{
							/*
							 * The identity chip row belongs in the header because it governs everything
							 * beneath it: it decides which billing block the form even renders. Placed after
							 * the first section it would be a control the reader meets only once they have
							 * started filling in the wrong one.
							 */
						}
						<BillingContextSwitcher
							draft={draft}
							contexts={contexts.value}
							disabled={busy}
							addBusinessHref={props.addBusinessHref}
						/>
					</header>

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
						<BillingFields
							draft={draft}
							departments={departmentOptions}
							disabled={busy}
						/>
					</section>

					<section class="ckod__section" aria-labelledby="ckod-invoicing">
						<h2 class="ckod__legend" id="ckod-invoicing">Invoicing</h2>
						<InvoicingSetup draft={draft} invoicing={invoicing.value} disabled={busy} />
					</section>

					{
						/*
						 * The form's foot carries the quiet action ONLY (§B.8.2). It used to hold a second
						 * `filled` Continue, identical to the rail's, so the page offered two primaries and a
						 * reader had to work out whether they did the same thing. The step now has exactly one
						 * commitment anywhere on it — in the summary rail, beside the figure it commits to —
						 * because the footer band this step used to share it with is not constructed at all
						 * under focus chrome (§D.6).
						 */
					}
					<div class="ckod__actions">
						<Button
							variant="outlined"
							size="md"
							rounded
							disabled={busy}
							loading={busy}
							icon={<Icon name="check" size="xs" />}
							onClick={() => void save()}
						>
							Save details
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
					</div>
				</div>

				<div class="cko-pstep__aside">
					<OrderSummaryRail
						view={projection}
						items={lines}
						// No route has been chosen yet on this step, and the gateway contribution only exists
						// once one has been — a wallet payment touches no card scheme, so there is no
						// third-party cost to help with. Asking here would be asking the buyer to answer for a
						// payment method they have not picked.
						contribution={null}
						optedIn={contributionOptedIn}
						reading={reading.value}
						onToggleContribution={() => {}}
						basketHref={basketHref(projection.basketId || null, owner)}
					>
						<div class="cko-rail__commit">
							<Button
								class="cko-rail__buy"
								variant="filled"
								severity="warning"
								size="lg"
								fluid
								rounded
								loading={busy}
								icon={<Icon name="arrow-right" size="xs" />}
								iconPos="right"
								onClick={() => void advance()}
							>
								Continue
							</Button>
							<p class="cko-rail__reassure">
								<Icon name="lock" />
								<span>Nothing is charged until you review the total on the next step.</span>
							</p>
						</div>
					</OrderSummaryRail>
				</div>
			</div>
		</div>
	);
}
