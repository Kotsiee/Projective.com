import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useCallback, useMemo } from "preact/hooks";
import "../styles/checkout-details.css";
import { missingBuyerFields } from "@projective/types/finance";
import { Button } from "@projective/ui/fields";
import { Dialog, Message } from "@projective/ui/feedback";
import { currentCheckoutContext } from "../core/basket-state.ts";
import { applyRead, buyerDetails, detailsDirty } from "../core/checkout-state.ts";
import {
	createDetailsDraft,
	type DetailsDepartments,
	type DetailsDraft,
	detailsFieldId,
	detailsService,
	draftToSave,
	type SaveDetailsResult,
	seedDetailsDraft,
	touchMissing,
} from "../core/details-draft.ts";
import { BillingContextSwitcher } from "../components/BillingContextSwitcher.tsx";
import { BillingFields } from "../components/BillingFields.tsx";
import { DeliveryFields } from "../components/DeliveryFields.tsx";
import { InvoicingSetup } from "../components/InvoicingSetup.tsx";
import type { BillingContext, BuyerDetails, MonthlyInvoicing } from "../types/checkout-types.ts";

/**
 * SaveDetailsModal — the same delivery and billing form as step 2, inside a dialog, so "Change
 * details" from a later step edits in place instead of unwinding the flow.
 *
 * **It composes the step's components rather than restating them.** A second copy of these fields is
 * a second set of labels, a second validation discipline and a second idea of what is required — and
 * the two would drift on the first change to either. Everything below is the page form with a
 * different id scope so the two can be mounted at once without minting duplicate ids.
 *
 * **It owns no routing.** The dialog reports a successful save through {@link
 * SaveDetailsModalProps.onSaved} and closes; where the buyer goes next is the mounting surface's
 * decision, not a modal's. That is also why it takes its record as a prop instead of reading one: a
 * dialog that fetched its own would answer a question the page had already answered, and the two
 * would eventually differ.
 *
 * **Cancelling discards.** Closing without saving re-seeds the draft from the record it was given, so
 * a half-made edit never survives as a silent pending change on the surface behind it.
 */

// #region Props
/** Props for {@link SaveDetailsModal}. */
export interface SaveDetailsModalProps {
	/** Dialog visibility, owned by the mounting surface. */
	visible: Signal<boolean>;
	/** The record to edit — the server's, not one this dialog resolved for itself. */
	record: BuyerDetails;
	/** Every identity the viewer may bill through. */
	billingContexts: readonly BillingContext[];
	/** The monthly-invoicing offer for the active identity. */
	invoicing: MonthlyInvoicing;
	/** The departments each identity declares, keyed by `BillingContext.id`. */
	departments?: DetailsDepartments;
	/** Fired with the server's answer after a save lands. */
	onSaved?: (result: SaveDetailsResult) => void;
}
// #endregion

/** The dialog's own id scope, so its controls never collide with the page form's. */
const SCOPE = "cko-details-modal";

export default function SaveDetailsModal(props: SaveDetailsModalProps): JSX.Element {
	const { visible, record, billingContexts, invoicing } = props;

	const draft = useMemo<DetailsDraft>(() => createDetailsDraft(record), []);
	const saving = useSignal(false);
	const error = useSignal<string | null>(null);

	// Opening re-seeds from the record the surface currently holds: the dialog is an editor for that
	// record, not a place edits accumulate between visits.
	useSignalEffect(() => {
		if (visible.value) {
			seedDetailsDraft(draft, record);
			error.value = null;
		}
	});

	const close = useCallback(() => {
		seedDetailsDraft(draft, record);
		visible.value = false;
	}, [record]);

	const save = useCallback(async (): Promise<void> => {
		const missing = missingBuyerFields(draft.record.peek());
		if (missing.length > 0) {
			touchMissing(draft);
			error.value = `Still needed: ${missing.map((field) => field.label).join(", ")}.`;
			document.getElementById(detailsFieldId(missing[0].path, SCOPE))?.focus();
			return;
		}
		if (saving.peek()) return;
		saving.value = true;
		const res = await detailsService.saveDetails(draftToSave(draft), currentCheckoutContext());
		saving.value = false;
		const landed = applyRead(res, (data) => {
			seedDetailsDraft(draft, data.buyer);
			buyerDetails.value = data.buyer;
			detailsDirty.value = false;
			props.onSaved?.(data);
			visible.value = false;
		});
		if (!landed) {
			error.value = "That didn't save. Nothing has been charged — please try again.";
		}
	}, [props.onSaved]);

	const busy = saving.value;
	const departmentOptions = props.departments?.[draft.contextId.value] ?? [];

	return (
		<Dialog
			visible={visible}
			header="Delivery & billing details"
			class="ckod-modal"
			width="46rem"
			onVisibleChange={(open) => {
				if (!open) seedDetailsDraft(draft, record);
			}}
			footer={
				<div class="ckod-modal__foot">
					<Button variant="text" size="sm" disabled={busy} onClick={close}>Cancel</Button>
					<Button
						variant="filled"
						severity="warning"
						size="sm"
						loading={busy}
						onClick={() => void save()}
					>
						Save details
					</Button>
				</div>
			}
		>
			<div class="ckod ckod--modal">
				<BillingContextSwitcher
					draft={draft}
					contexts={billingContexts}
					disabled={busy}
					scope={SCOPE}
				/>

				{error.value ? <Message severity="warning" size="sm">{error.value}</Message> : null}

				<section class="ckod__section" aria-labelledby={`${SCOPE}-delivery`}>
					<h3 class="ckod__legend" id={`${SCOPE}-delivery`}>Delivery</h3>
					<DeliveryFields draft={draft} disabled={busy} scope={SCOPE} />
				</section>

				<section class="ckod__section" aria-labelledby={`${SCOPE}-billing`}>
					<h3 class="ckod__legend" id={`${SCOPE}-billing`}>Billing</h3>
					<BillingFields
						draft={draft}
						departments={departmentOptions}
						disabled={busy}
						scope={SCOPE}
					/>
				</section>

				<section class="ckod__section" aria-labelledby={`${SCOPE}-invoicing`}>
					<h3 class="ckod__legend" id={`${SCOPE}-invoicing`}>Invoicing</h3>
					<InvoicingSetup
						draft={draft}
						invoicing={invoicing}
						disabled={busy}
						scope={SCOPE}
					/>
				</section>
			</div>
		</Dialog>
	);
}
