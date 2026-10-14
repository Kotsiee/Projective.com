import { assertEquals } from "@std/assert";
import { ProjectStageSchema } from "@projective/types/explore";
import { newMilestone } from "./offer-model.ts";
import { stagePreviewOf } from "./stage-preview.ts";

Deno.test("stages map onto the buyer ledger's shape, priced as /view prices them", () => {
	const stages = [
		{
			...newMilestone(1, "Stage"),
			name: "Discovery",
			priceCents: 40_000,
			deliverables: ["Brief", " "],
		},
		{ ...newMilestone(2, "Stage"), name: "Build", skills: ["Figma"] },
	];
	const preview = stagePreviewOf(stages, "GBP", 30_000);
	for (const stage of preview) ProjectStageSchema.parse(stage);
	assertEquals(preview[0].price, { min: 200, max: 800, label: "£200 – £800 / ticket" });
	assertEquals(preview[1].price.min, 150, "an unpriced stage falls back to the baseline ticket");
	assertEquals(preview[0].deliverables, ["Brief"]);
	assertEquals(preview[1].dependency, "After Discovery");
	assertEquals(preview[1].skills, [{ label: "Figma", category: "technical" }]);
	assertEquals(stagePreviewOf(stages.slice(1), "GBP", null)[0].price.label, "Priced on scope");
});
