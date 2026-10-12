import { assertEquals } from "@std/assert";
import { discoveryHeading } from "./discovery-rails.ts";
import type { DiscoveryRail } from "@projective/types/explore";

/**
 * A discovery rail's heading follows what filled it: the anchor is named only when there is one, the
 * fallback says what it matched on, and only the activity path may call itself Trending.
 */

const rail = (extra: Partial<DiscoveryRail> & Pick<DiscoveryRail, "kind">): DiscoveryRail => ({
	items: [],
	...extra,
});

Deno.test("Because you viewed names its anchor", () => {
	const heading = discoveryHeading(
		rail({ kind: "because_viewed", anchor: { id: "svc-1", title: "Brand identity sprint" } }),
	);
	assertEquals(heading.lead, "Because you viewed");
	assertEquals(heading.tail, "Brand identity sprint");
	assertEquals(heading.label, "Because you viewed Brand identity sprint");
});

Deno.test("Picked for you says what it matched on", () => {
	assertEquals(
		discoveryHeading(rail({ kind: "for_you", basis: "activity" })).subtitle,
		"Matched to what you have been exploring",
	);
	assertEquals(
		discoveryHeading(rail({ kind: "for_you", basis: "interests" })).subtitle,
		"Matched to your skills and interests",
	);
});

Deno.test("only the activity path is Trending; its fallback is New", () => {
	assertEquals(discoveryHeading(rail({ kind: "trending" })).lead, "Trending");
	assertEquals(discoveryHeading(rail({ kind: "new" })).lead, "New");
	assertEquals(discoveryHeading(rail({ kind: "new" })).subtitle, undefined);
});

Deno.test("every kind has a distinct section id", () => {
	const ids = (["because_viewed", "for_you", "saved", "trending", "new"] as const)
		.map((kind) => discoveryHeading(rail({ kind })).id);
	assertEquals(new Set(ids).size, ids.length);
});
