import { assertEquals } from "@std/assert";
import { firstMissingSection, readinessItems } from "./readiness-items.ts";

const labels = (items: { label: string; done: boolean }[]) =>
	items.map((i) => `${i.done ? "✓" : "○"} ${i.label}`);

Deno.test("a session lists availability and a bookable window as explicit lines", () => {
	assertEquals(
		labels(
			readinessItems({ kind: "service", serviceType: "Session" }, { ready: true, missing: [] }),
		),
		[
			"✓ Add a title",
			"✓ Choose a delivery model",
			"✓ Set a price",
			"✓ Choose availability",
			"✓ Open a bookable time in the next 30 days",
			"✓ Add a cover image",
		],
	);
});

Deno.test("the bookable window is never ticked before availability is chosen", () => {
	const items = readinessItems(
		{ kind: "service", serviceType: "Group Session" },
		{ ready: false, missing: ["Choose availability"] },
	);
	assertEquals(labels(items).slice(-3, -1), [
		"○ Choose availability",
		"○ Open a bookable time in the next 30 days",
	]);
});

Deno.test("a pipeline lists its stage before its price; a product lists no delivery model", () => {
	assertEquals(
		labels(readinessItems({ kind: "service", serviceType: "Pipeline" }, {
			ready: false,
			missing: ["Add at least one stage"],
		})).slice(2, 4),
		["○ Add at least one stage", "✓ Set a price"],
	);
	assertEquals(
		labels(readinessItems({ kind: "product", serviceType: null }, { ready: true, missing: [] })),
		["✓ Add a title", "✓ Attach a file to deliver", "✓ Set a price", "✓ Add a cover image"],
	);
});

Deno.test("a locked Publish leads to the section that fixes the first missing line", () => {
	assertEquals(firstMissingSection([]), null);
	assertEquals(firstMissingSection(["Add a cover image", "Set a price"]), "media");
	assertEquals(firstMissingSection(["Add a title"]), "basics");
	assertEquals(firstMissingSection(["Add at least one stage"]), "offer");
	assertEquals(firstMissingSection(["Attach a file to deliver"]), "offer");
	assertEquals(firstMissingSection(["Open a bookable time in the next 30 days"]), "availability");
	assertEquals(firstMissingSection(["Something new", "Set a price"]), "pricing");
});
