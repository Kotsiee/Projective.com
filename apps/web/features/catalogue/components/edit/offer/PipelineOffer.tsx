import type { JSX } from "preact";
import { formatMoney } from "@projective/types/finance";
import type {
	ListingDetail,
	PipelineOffer as PipelineOfferValue,
} from "../../../types/catalogue-types.ts";
import { problemRow } from "../../../core/offer-model.ts";
import { minorOf, ticketRange } from "../../../core/pricing-model.ts";
import { checkOffer, commitOffer } from "../../../core/offer-commit.ts";
import { setWorkspaceUrl } from "../../../core/workspace-store.ts";
import { useGatedDraft } from "../../../hooks/useGatedDraft.ts";
import { revealSection } from "../EditSectionFrame.tsx";
import { OfferGroup } from "./OfferGroup.tsx";
import { StageBlueprintEditor } from "./StageBlueprintEditor.tsx";
import { StageFlowPreview } from "./StageFlowPreview.tsx";
import { RevisionFields } from "./RevisionFields.tsx";
import { TeamRolesEditor } from "./TeamRolesEditor.tsx";

function BaselineLine(props: { listing: ListingDetail; minor: number | null }): JSX.Element {
	const { listing, minor } = props;
	const go = () => {
		revealSection("pricing");
		setWorkspaceUrl({ section: "pricing" }, "replace");
	};
	const range = minor === null ? null : ticketRange(minor);
	return (
		<p class="cat-offer__baseline">
			{range
				? `Baseline ticket ${formatMoney(minor ?? 0, listing.currency)} · buyers see ${
					formatMoney(range.low, listing.currency)
				} – ${formatMoney(range.high, listing.currency)} · `
				: "No baseline ticket yet · "}
			<button type="button" class="cat-offer__link" onClick={go}>
				{range ? "Change in Pricing" : "Set it in Pricing"}
			</button>
		</p>
	);
}

/**
 * PipelineOffer — a Pipeline's stage blueprint: the baseline ticket every stage starts from (set in
 * Pricing, named here), the stages themselves, how buyers will see them, the revision allowance per
 * stage, and the team's roles.
 */
export function PipelineOffer(
	props: { listing: ListingDetail; offer: PipelineOfferValue },
): JSX.Element {
	const { listing } = props;
	const gated = useGatedDraft(props.offer, checkOffer, commitOffer);
	const offer = gated.value.value as PipelineOfferValue;
	const update = (patch: Partial<PipelineOfferValue>) => gated.set({ ...offer, ...patch });
	const baselineMinor = minorOf(listing.pricing.ticketPrice, listing.currency);

	return (
		<>
			<OfferGroup
				title="Stages"
				hint="Each stage is funded and approved on its own. Buyers hire you through them in order."
			>
				<BaselineLine listing={listing} minor={baselineMinor} />
				<StageBlueprintEditor
					stages={offer.stages}
					onChange={(stages) => update({ stages: [...stages] })}
					currency={listing.currency}
					baselineMinor={baselineMinor}
					problemAt={problemRow(gated.problem.value, "stages")}
				/>
			</OfferGroup>

			<OfferGroup title="How buyers see it">
				<StageFlowPreview
					stages={offer.stages}
					currency={listing.currency}
					baselineMinor={baselineMinor}
				/>
			</OfferGroup>

			<OfferGroup title="Revisions">
				<RevisionFields listing={listing} perStage />
			</OfferGroup>

			<OfferGroup title="Team" hint="The roles that staff these stages.">
				<TeamRolesEditor
					roles={offer.teamRoles}
					onChange={(teamRoles) => update({ teamRoles: [...teamRoles] })}
					problemAt={problemRow(gated.problem.value, "teamRoles")}
				/>
			</OfferGroup>
		</>
	);
}
