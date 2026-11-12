import type { JSX } from "preact";
import { ToggleSwitch } from "@projective/ui/fields";
import { formatMoney } from "@projective/types/finance";
import { stagePriceSpan } from "@projective/types/catalogue";
import type {
	ListingDetail,
	PipelineOffer as PipelineOfferValue,
} from "../../../types/catalogue-types.ts";
import { problemRow, TIERED_INTENSITY_HINT } from "../../../core/offer-model.ts";
import { minorOf } from "../../../core/pricing-model.ts";
import { checkOffer, commitOffer } from "../../../core/offer-commit.ts";
import { setWorkspaceUrl } from "../../../core/workspace-store.ts";
import { useGatedDraft } from "../../../hooks/useGatedDraft.ts";
import { revealSection } from "../EditSectionFrame.tsx";
import { ToggleHint } from "../FieldHead.tsx";
import { OfferGroup } from "./OfferGroup.tsx";
import { StageBlueprintEditor } from "./StageBlueprintEditor.tsx";
import { StageFlowPreview } from "./StageFlowPreview.tsx";
import { RevisionFields } from "./RevisionFields.tsx";
import { TeamRolesEditor } from "./TeamRolesEditor.tsx";

const TIERED_LABEL = "Tiered intensity pricing";
const TIERED_HINT_ID = "cat-offer-tiered-hint";

function BaselineLine(
	props: { listing: ListingDetail; minor: number | null; tiered: boolean },
): JSX.Element {
	const { listing, minor } = props;
	const go = () => {
		revealSection("pricing");
		setWorkspaceUrl({ section: "pricing" }, "replace");
	};
	const span = minor === null ? null : stagePriceSpan({}, props.tiered, minor);
	return (
		<p class="cat-offer__baseline">
			{span
				? `Baseline ticket ${formatMoney(minor ?? 0, listing.currency)} · buyers see ${
					span.low === span.high
						? formatMoney(span.low, listing.currency)
						: `${formatMoney(span.low, listing.currency)} – ${
							formatMoney(span.high, listing.currency)
						}`
				} · `
				: "No baseline ticket yet · "}
			<button type="button" class="cat-offer__link" onClick={go}>
				{span ? "Change in Pricing" : "Set it in Pricing"}
			</button>
		</p>
	);
}

/**
 * PipelineOffer — a Pipeline's stage blueprint: the baseline ticket every stage starts from (set in
 * Pricing, named here), how the stages sell (one fixed intensity and price each, or tiered), the
 * stages themselves, how buyers will see them, the revision allowance per stage, and the team's roles.
 */
export function PipelineOffer(
	props: { listing: ListingDetail; offer: PipelineOfferValue },
): JSX.Element {
	const { listing } = props;
	const gated = useGatedDraft(props.offer, checkOffer, commitOffer);
	const offer = gated.value.value as PipelineOfferValue;
	const update = (patch: Partial<PipelineOfferValue>) => gated.set({ ...offer, ...patch });
	const baselineMinor = minorOf(listing.pricing.ticketPrice, listing.currency);
	const tiered = offer.allowTieredIntensity;

	return (
		<>
			<OfferGroup
				title="Stages"
				hint="Each stage is funded and approved on its own. Buyers hire you through them in order."
			>
				<BaselineLine listing={listing} minor={baselineMinor} tiered={tiered} />
				<div class="cat-sec__field">
					<ToggleHint label={TIERED_LABEL} hint={TIERED_INTENSITY_HINT} hintId={TIERED_HINT_ID}>
						<ToggleSwitch
							value={tiered}
							onValueChange={(allowTieredIntensity) => update({ allowTieredIntensity })}
							label={TIERED_LABEL}
							aria-describedby={TIERED_HINT_ID}
						/>
					</ToggleHint>
				</div>
				<StageBlueprintEditor
					stages={offer.stages}
					onChange={(stages) => update({ stages: [...stages] })}
					currency={listing.currency}
					baselineMinor={baselineMinor}
					tiered={tiered}
					problemAt={problemRow(gated.problem.value, "stages")}
				/>
			</OfferGroup>

			<OfferGroup title="How buyers see it">
				<StageFlowPreview
					stages={offer.stages}
					currency={listing.currency}
					baselineMinor={baselineMinor}
					tiered={tiered}
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
