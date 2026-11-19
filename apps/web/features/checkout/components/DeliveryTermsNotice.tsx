import type { Signal } from "@preact/signals";
import type { JSX } from "preact";
import { Checkbox } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import { DELIVERY_TERMS_COPY } from "@projective/types/catalogue";

/**
 * DeliveryTermsNotice — the required disclosure on `/checkout/payment` for a basket that delivers
 * files (ruling A8, Decision #488): a digital file is not refundable once it has downloaded in full,
 * unless it is defective or never arrives. The buyer must tick it before Pay, and the tick travels
 * with the payment (`deliveryTermsAccepted`) to be recorded on each product line.
 *
 * A notice plus an unticked box whose sentence is its label, so a press on the words ticks it. The
 * words are `DELIVERY_TERMS_COPY`, the same text `PRODUCT_SPEC.md` §Digital Marketplace 6 holds,
 * pending counsel. Contained because it is a required disclosure (§B.11), never decoration.
 */
export function DeliveryTermsNotice(props: { accepted: Signal<boolean>; id: string }): JSX.Element {
	const boxId = `${props.id}-box`;
	return (
		<div class="cko-terms" id={props.id}>
			<InlineNotice text={`${DELIVERY_TERMS_COPY.title}. ${DELIVERY_TERMS_COPY.body}`} />
			<div class="cko-terms__row">
				<Checkbox id={boxId} value={props.accepted} required />
				<label class="cko-terms__label" for={boxId}>{DELIVERY_TERMS_COPY.accept}</label>
			</div>
		</div>
	);
}
