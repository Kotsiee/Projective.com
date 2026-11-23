import type { JSX } from "preact";
import "../../styles/offer.css";
import { type FormArchetype, formArchetypeOf } from "@projective/types/catalogue";
import type { ListingDetail } from "../../types/catalogue-types.ts";
import { offerEditorFor } from "../../core/offer-model.ts";
import { EditSectionFrame } from "./EditSectionFrame.tsx";
import { ProductOffer } from "./offer/ProductOffer.tsx";
import { OneOffOffer } from "./offer/OneOffOffer.tsx";
import { PipelineOffer } from "./offer/PipelineOffer.tsx";
import { SessionOffer } from "./offer/SessionOffer.tsx";

const INTRO: Readonly<Record<FormArchetype, string>> = {
	product: "What the buyer downloads, and the terms they may use it on.",
	one_off: "What you deliver, by when, and what is included.",
	pipeline: "The stages a buyer hires you through, each priced and funded on its own.",
	session: "How long a session runs, what each one covers, and where it happens.",
	cohort: "How long a session runs, what each one covers, how many people join, and where.",
};

function OfferBody(
	props: { listing: ListingDetail; withTeam: boolean; team?: string },
): JSX.Element {
	const { listing } = props;
	const offer = listing.offer;
	switch (offer.archetype) {
		case "product":
			return <ProductOffer offer={offer} />;
		case "one_off":
			return <OneOffOffer listing={listing} offer={offer} withTeam={props.withTeam} />;
		case "pipeline":
			return <PipelineOffer listing={listing} offer={offer} />;
		case "session":
		case "cohort":
			return <SessionOffer listing={listing} offer={offer} team={props.team} />;
	}
}

/**
 * OfferSection — what the listing sells, in the form its delivery model edits with
 * (`formArchetypeOf`, plan §4.3): a product's format, licence and files; a One-Off's milestones,
 * turnaround and scope (a Direct Deliverable has no milestones, and names its team instead); a
 * Pipeline's stage blueprint; a session's length, plan summary, seats and meeting room. Revisions are
 * priced in Pricing (Decision #525). Each form edits locally and reaches the draft only once it would
 * save. After a delivery-model change the server re-derives the offer, so until that save lands the
 * section says so instead of showing the old form.
 */
export function OfferSection(props: { listing: ListingDetail; team?: string }): JSX.Element {
	const { listing } = props;
	const editor = offerEditorFor(listing.kind, listing.serviceType, listing.offer);

	return (
		<EditSectionFrame
			section="offer"
			intro={INTRO[formArchetypeOf(listing.kind, listing.serviceType)]}
		>
			{editor
				? (
					<OfferBody
						key={editor.archetype}
						listing={listing}
						withTeam={editor.withTeam}
						team={props.team}
					/>
				)
				: (
					<p class="cat-sec__hint" role="status">
						Saving the new delivery model. Its offer opens here once it's saved.
					</p>
				)}
		</EditSectionFrame>
	);
}
