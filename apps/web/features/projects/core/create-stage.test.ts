import { assertEquals } from "@std/assert";
import {
	createStagePayload,
	NO_STAGE_CATEGORY,
	STAGE_CATEGORY_OPTIONS,
	STAGE_NAME_MAX,
} from "./create-stage.ts";
import { CreateStageInputSchema } from "@projective/types/projects";

const DRAFT = { name: "Design review", category: NO_STAGE_CATEGORY, rateMinor: null, priced: true };

Deno.test("a draft without a name builds no payload", () => {
	assertEquals(createStagePayload({ ...DRAFT, name: "   " }), null);
});

Deno.test("the name is trimmed and clamped to what the write accepts", () => {
	assertEquals(createStagePayload({ ...DRAFT, name: "  Launch  " })?.name, "Launch");
	const long = createStagePayload({ ...DRAFT, name: "x".repeat(STAGE_NAME_MAX + 30) });
	assertEquals(long?.name.length, STAGE_NAME_MAX);
});

Deno.test("Not set leaves the stage untyped; a framework category is kept", () => {
	assertEquals(createStagePayload(DRAFT)?.createCategory, null);
	assertEquals(createStagePayload({ ...DRAFT, category: "advise" })?.createCategory, "advise");
	assertEquals(createStagePayload({ ...DRAFT, category: "marketing" })?.createCategory, null);
});

Deno.test("a rate is sent only where one is offered, and zero is a price", () => {
	assertEquals(createStagePayload({ ...DRAFT, rateMinor: 12_500 })?.unitPriceCents, 12_500);
	assertEquals(createStagePayload({ ...DRAFT, rateMinor: 0 })?.unitPriceCents, 0);
	assertEquals(createStagePayload({ ...DRAFT, rateMinor: null })?.unitPriceCents, null);
	assertEquals(createStagePayload({ ...DRAFT, rateMinor: 12_500, priced: false })?.unitPriceCents, null);
	assertEquals(createStagePayload({ ...DRAFT, rateMinor: -5 })?.unitPriceCents, null);
});

Deno.test("every payload is one the route's schema accepts as it is", () => {
	const payload = createStagePayload({ ...DRAFT, category: "test", rateMinor: 99 });
	assertEquals(CreateStageInputSchema.parse(payload), payload);
});

Deno.test("the category choices are the six CREATE categories, then Not set", () => {
	assertEquals(
		STAGE_CATEGORY_OPTIONS.map((o) => o.value),
		["create", "run", "educate", "advise", "test", "empower", NO_STAGE_CATEGORY],
	);
});
