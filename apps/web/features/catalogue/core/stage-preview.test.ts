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
	const preview = stagePreviewOf(stages, "GBP", 30_000, true);
	for (const stage of preview) ProjectStageSchema.parse(stage);
	assertEquals(preview[0].price, { min: 300, max: 600, label: "£300 – £600 / ticket" });
	assertEquals(preview[1].price.min, 225, "an unpriced stage falls back to the baseline ticket");
	assertEquals(preview[0].deliverables, ["Brief"]);
	assertEquals(preview[1].dependency, "After Discovery");
	assertEquals(preview[1].skills, [{ label: "Figma", category: "technical" }]);
	assertEquals(stagePreviewOf(stages.slice(1), "GBP", null, true)[0].price.label, "Priced on scope");
});

Deno.test("a fixed-intensity stage is quoted at one price; a tiered one at the seller's own tier prices", () => {
	const stage = { ...newMilestone(1, "Stage"), name: "Build", priceCents: 40_000, highPriceCents: 70_000 };
	assertEquals(stagePreviewOf([stage], "GBP", null, false)[0].price, {
		min: 400,
		max: 400,
		label: "£400 / ticket",
	});
	assertEquals(stagePreviewOf([stage], "GBP", null, true)[0].price, {
		min: 300,
		max: 700,
		label: "£300 – £700 / ticket",
	});
});
