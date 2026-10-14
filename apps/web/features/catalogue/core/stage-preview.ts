import { toMajorUnits } from "@projective/types/finance";
import type { ProjectStage } from "@projective/types/explore";
import { type Milestone, money } from "@projective/types/catalogue";
import { cleanLines } from "./offer-model.ts";

/**
 * stage-preview — a Pipeline's stages as `/view`'s stage ledger reads them, so the workspace's
 * read-only preview renders through the buyer page's own component. The price follows the buyer
 * page's assembler (`live-view.ts#serviceViewFor`): a pipeline stage is quoted as its 0.5×–2.0×
 * ticket range, and a stage priced at nothing falls back to the listing's baseline ticket.
 */

const LOW = 0.5;
const HIGH = 2;

function slug(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/** The pipeline's stages as the buyer page's ledger reads them. */
export function stagePreviewOf(
	stages: readonly Milestone[],
	currency: string,
	baselineMinor: number | null,
): ProjectStage[] {
	return stages.map((stage, i) => {
		const minor = stage.priceCents ?? baselineMinor;
		const standard = minor === null ? null : toMajorUnits(minor, currency) ?? 0;
		const low = standard === null ? 0 : Math.round(standard * LOW);
		const high = standard === null ? 0 : Math.round(standard * HIGH);
		return {
			id: `stage-${i + 1}-${slug(stage.name)}`,
			index: i + 1,
			name: stage.name.trim() || `Stage ${i + 1}`,
			description: stage.description,
			status: "upcoming",
			seatKind: "seats",
			openSeats: 0,
			seatsTotal: 0,
			seatsFilled: 0,
			roles: [],
			price: {
				min: low,
				max: high,
				label: standard === null
					? "Priced on scope"
					: `${money(low, currency)} – ${money(high, currency)} / ticket`,
			},
			skills: cleanLines(stage.skills).map((label) => ({ label, category: "technical" as const })),
			deliverables: cleanLines(stage.deliverables),
			turnaround: stage.turnaround?.trim() || undefined,
			dependency: i > 0 ? `After ${stages[i - 1].name.trim() || `Stage ${i}`}` : undefined,
		};
	});
}
