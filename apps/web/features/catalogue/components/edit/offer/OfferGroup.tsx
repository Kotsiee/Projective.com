import type { ComponentChildren, JSX } from "preact";

/**
 * OfferGroup — one named group inside an Edit section ("Milestones", "Delivery"): a sub-heading a
 * step below the section's, an optional one-line hint, then its controls. Separated by spacing
 * alone; never boxed.
 */
export function OfferGroup(
	props: { title: string; hint?: string; children: ComponentChildren },
): JSX.Element {
	const id = `cat-offer-group-${props.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
	return (
		<div class="cat-offer__group" role="group" aria-labelledby={id}>
			<div class="cat-offer__group-head">
				<h3 class="cat-offer__subhead" id={id}>{props.title}</h3>
				{props.hint && <p class="cat-sec__hint">{props.hint}</p>}
			</div>
			{props.children}
		</div>
	);
}
