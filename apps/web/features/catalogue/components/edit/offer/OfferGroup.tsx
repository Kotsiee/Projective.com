import type { ComponentChildren, JSX } from "preact";
import { HintPopover } from "@projective/ui/feedback";

/**
 * OfferGroup — one named group inside an Edit section ("Milestones", "Delivery"): a sub-heading a
 * step below the section's with its optional hint behind a "?" (Decision #305), then its controls.
 * The hint also describes the group, and stays in the DOM under `hintId` when a control inside
 * points at it. Separated by spacing alone; never boxed.
 */
export function OfferGroup(
	props: { title: string; hint?: ComponentChildren; hintId?: string; children: ComponentChildren },
): JSX.Element {
	const id = `cat-offer-group-${props.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
	const hintId = props.hint ? props.hintId ?? `${id}-hint` : undefined;
	return (
		<div class="cat-offer__group" role="group" aria-labelledby={id} aria-describedby={hintId}>
			<div class="cat-offer__group-head">
				<h3 class="cat-offer__subhead" id={id}>{props.title}</h3>
				{props.hint && (
					<HintPopover label={`About ${props.title.toLowerCase()}`}>{props.hint}</HintPopover>
				)}
			</div>
			{props.hint && <span id={hintId} class="ui-visually-hidden">{props.hint}</span>}
			{props.children}
		</div>
	);
}
