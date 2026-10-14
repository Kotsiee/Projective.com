import { assertEquals } from "@std/assert";
import { filterByScope, type ScopedListing, sellsSessions } from "./listing-scope.ts";

/** listing-scope_test — how a console scope selects the seller's listings. */

function listing(slug: string, kind: "product" | "service", model: string | null): ScopedListing {
	return {
		id: `id-${slug}`,
		slug,
		title: slug,
		kind,
		model,
		currency: "USD",
		createCategory: null,
		blueprintId: kind === "service" ? `bp-${slug}` : null,
		productId: kind === "product" ? `pr-${slug}` : null,
	};
}

const PIPE = listing("svc-pipe", "service", "pipeline");
const SESSION = listing("svc-session", "service", "session");
const COHORT = listing("svc-cohort", "service", "group_session");
const KIT = listing("prd-kit", "product", null);
const ALL = [PIPE, SESSION, COHORT, KIT];

const slugs = (list: readonly ScopedListing[]) => list.map((l) => l.slug);

Deno.test("all, product and service select by kind", () => {
	assertEquals(slugs(filterByScope(ALL, "all")), slugs(ALL));
	assertEquals(slugs(filterByScope(ALL, "product")), ["prd-kit"]);
	assertEquals(slugs(filterByScope(ALL, "service")), ["svc-pipe", "svc-session", "svc-cohort"]);
});

Deno.test("model:<delivery> selects by the database delivery model", () => {
	assertEquals(slugs(filterByScope(ALL, "model:group_session")), ["svc-cohort"]);
	assertEquals(slugs(filterByScope(ALL, "model:one_off")), []);
});

Deno.test("collection:<slug> selects the collection's members, and an unknown one selects nothing", () => {
	const members = new Set([KIT.id, PIPE.id]);
	assertEquals(slugs(filterByScope(ALL, "collection:starter-kits", members)), [
		"svc-pipe",
		"prd-kit",
	]);
	assertEquals(filterByScope(ALL, "collection:nope"), []);
});

Deno.test("only booked-time models count as selling sessions", () => {
	assertEquals(sellsSessions([PIPE, KIT]), false);
	assertEquals(sellsSessions([COHORT]), true);
});
