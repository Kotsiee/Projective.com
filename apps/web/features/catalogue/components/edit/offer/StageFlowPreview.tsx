import type { JSX } from "preact";
import "@features/view/styles/entity-view.css";
import { StageProgressLedger } from "@features/view/components/StageProgressLedger.tsx";
import type { Milestone } from "../../../types/catalogue-types.ts";
import { stagePreviewOf } from "../../../core/stage-preview.ts";

/**
 * StageFlowPreview — the stages as a buyer reads them on `/view`, drawn by that page's own stage
 * ledger from the editor's live state. Read-only: it shows what the seller is building, it is not a
 * second place to edit it.
 */
export function StageFlowPreview(
	props: { stages: readonly Milestone[]; currency: string; baselineMinor: number | null },
): JSX.Element | null {
	if (props.stages.length === 0) return null;
	return (
		<div class="cat-offer__preview" aria-label="How buyers see these stages" role="group">
			<StageProgressLedger
				stages={stagePreviewOf(props.stages, props.currency, props.baselineMinor)}
				currency={props.currency}
			/>
		</div>
	);
}
