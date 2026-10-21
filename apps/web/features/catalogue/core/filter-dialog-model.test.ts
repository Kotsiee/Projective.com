import { assertEquals } from "@std/assert";
import { CONSOLE_DEFAULTS, EMPTY_FACET_COUNTS } from "@projective/types/catalogue";
import {
	appliedFilterCount,
	countLine,
	createOptions,
	defaultFacets,
	facetsFrom,
	facetsOf,
	filterButtonLabel,
	highlightOptions,
	modelOptions,
	nextStatuses,
	statusOptions,
} from "./filter-dialog-model.ts";

Deno.test("the default facets narrow nothing", () => {
	assertEquals(appliedFilterCount(defaultFacets()), 0);
	assertEquals(appliedFilterCount(facetsOf({ ...CONSOLE_DEFAULTS })), 0);
	assertEquals(filterButtonLabel(0), "Filter listings");
});

Deno.test("a status choice counts once; every other chosen value once each", () => {
	const facets = {
		...defaultFacets(),
		status: ["archived" as const, "draft" as const],
		highlights: ["promoted" as const],
		model: ["Session" as const, "Pipeline" as const],
	};
	assertEquals(appliedFilterCount(facets), 4);
	assertEquals(filterButtonLabel(4), "Filter listings, 4 active");
});

Deno.test("pressed values become canonical facets, dropping what is unknown", () => {
	assertEquals(
		facetsFrom({
			status: ["archived", "draft", "nope"],
			highlights: ["best-selling", "attention"],
			model: ["Session", "Pipeline"],
			create: ["test", "educate", "x"],
		}),
		{
			status: ["draft", "archived"],
			highlights: ["attention", "best-selling"],
			model: ["Pipeline", "Session"],
			create: ["educate", "test"],
		},
	);
	assertEquals(
		facetsFrom({ status: [], highlights: [], model: [], create: [] }).status,
		["draft", "published", "paused"],
	);
});

Deno.test("releasing the last status leaves the previous choice standing", () => {
	assertEquals(nextStatuses(["draft"], []), ["draft"]);
	assertEquals(nextStatuses(["draft"], ["draft", "paused"]), ["draft", "paused"]);
});

Deno.test("each option carries its count as its second line", () => {
	assertEquals(countLine(1), "1 listing");
	assertEquals(countLine(1200), "1,200 listings");
	const counts = {
		...EMPTY_FACET_COUNTS,
		model: { "Session": 3 },
		create: { run: 1 },
		promoted: 2,
	};
	assertEquals(statusOptions({ draft: 2, published: 5, paused: 0, archived: 1 })[0], {
		label: "Published",
		value: "published",
		description: "5 listings",
	});
	assertEquals(highlightOptions(counts).map((o) => o.description), [
		"0 listings",
		"2 listings",
		"0 listings",
	]);
	assertEquals(modelOptions(counts).find((o) => o.value === "Session")?.description, "3 listings");
	assertEquals(createOptions(counts).find((o) => o.value === "run")?.description, "1 listing");
});
