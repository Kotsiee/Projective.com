import type { JSX } from "preact";
import "../../styles/offer.css";
import "../../styles/intake.css";
import { listingSubPageHref } from "@projective/types/catalogue";
import type { ListingDetail } from "../../types/catalogue-types.ts";
import { intakeLocked, intakeNodes, intakeSummary } from "../../core/intake-model.ts";
import { EditSectionFrame } from "./EditSectionFrame.tsx";
import { SubPageLink } from "./SubPageLink.tsx";

const SUMMARY_ID = "cat-intake-summary";

/**
 * IntakeSection — the Edit page's summary of the questions a buyer answers before hiring
 * (ServiceCreation.md §1.1): how many there are, how many must be answered, how many follow up on an
 * earlier answer, and the questions everyone is asked, in order. They are written in the listing's
 * own builder (`/catalogue/[id]/questions`, Decision #525), which this section links to.
 */
export function IntakeSection(props: { listing: ListingDetail; team?: string }): JSX.Element {
	const { listing } = props;
	const fields = listing.intake;
	const summary = intakeSummary(fields);
	const roots = intakeNodes(fields).filter((n) => n.parentId === null);

	return (
		<EditSectionFrame
			section="questions"
			intro="What you need to know before you start. Buyers answer these on the way to paying."
		>
			<div class="cat-offer__summary">
				<p class="cat-sec__value cat-offer__summary-line" id={SUMMARY_ID}>
					{summary.length > 0
						? summary.join(" · ")
						: "No questions. Buyers can hire you straight away."}
					{intakeLocked(listing) && summary.length > 0 && " · Wording only, since publishing"}
				</p>
				<SubPageLink
					href={listingSubPageHref(listing.id, "questions", props.team)}
					label={fields.length > 0 ? "Edit buyer questions" : "Add buyer questions"}
					icon="list"
					describedBy={SUMMARY_ID}
				/>
			</div>
			{roots.length > 0 && (
				<ol class="cat-intake__digest" aria-label="Questions every buyer is asked">
					{roots.map((node) => (
						<li key={node.field.id} class="cat-intake__digest-item">
							{node.field.label.trim() || "Untitled question"}
						</li>
					))}
				</ol>
			)}
		</EditSectionFrame>
	);
}
