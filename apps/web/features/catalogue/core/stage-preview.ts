import { toMajorUnits } from "@projective/types/finance";
import type { ProjectStage } from "@projective/types/explore";
import { type Milestone, money, stagePriceSpan } from "@projective/types/catalogue";
import { cleanLines } from "./offer-model.ts";

/**
 * stage-preview — a Pipeline's stages as `/view`'s stage ledger reads them, so the workspace's
 * read-only preview renders through the buyer page's own component. A stage is quoted as one ticket
 * price when the listing sells each stage at a fixed intensity, and as its Low–High span when it is
 * tiered (`stagePriceSpan`, Decision #417); a stage priced at nothing falls back to the listing's
 * baseline ticket. Figures are whole major units, as the buyer page rounds them.
 */

function slug(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/** The pipeline's stages as the buyer page's ledger reads them. */
export function stagePreviewOf(
	stages: readonly Milestone[],
	currency: string,
	baselineMinor: number | null,
	tiered: boolean,
): ProjectStage[] {
	return stages.map((stage, i) => {
		const span = stagePriceSpan(stage, tiered, baselineMinor);
		const low = span === null ? 0 : Math.round(toMajorUnits(span.low, currency) ?? 0);
		const high = span === null ? 0 : Math.round(toMajorUnits(span.high, currency) ?? 0);
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
				label: span === null
					? "Priced on scope"
					: low === high
					? `${money(low, currency)} / ticket`
					: `${money(low, currency)} – ${money(high, currency)} / ticket`,
			},
			skills: cleanLines(stage.skills).map((label) => ({ label, category: "technical" as const })),
			deliverables: cleanLines(stage.deliverables),
			turnaround: stage.turnaround?.trim() || undefined,
			dependency: i > 0 ? `After ${stages[i - 1].name.trim() || `Stage ${i}`}` : undefined,
		};
	});
}
