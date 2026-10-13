import { assertEquals } from "@std/assert";
import {
	featureInRail,
	parseDismissed,
	promosAfter,
	promoVisible,
	type PromoVisibilityInput,
	withDismissed,
} from "./promo-model.ts";
import type { CtaPromo, EditorialPromo, PromoSlot, SponsoredPromo } from "../types/explore-types.ts";

function sponsored(itemId: string, rail: SponsoredPromo["rail"]): SponsoredPromo {
	return {
		variant: "sponsored",
		id: `sp-${itemId}`,
		rail,
		itemId,
		title: itemId,
		body: "",
		media: "",
		owner: { handle: "@a", name: "A", avatar: "", kind: "freelancer" },
		href: `/view/${itemId}`,
		cta: "View",
	};
}

function cta(id: string, after: CtaPromo["after"]): CtaPromo {
	return {
		variant: "cta",
		id,
		after,
		eyebrow: "",
		title: id,
		body: "",
		href: "/join",
		cta: "Go",
		audience: "everyone",
		dismissible: true,
	};
}

const editorial: EditorialPromo = {
	variant: "editorial",
	id: "ed-help",
	after: "products",
	lead: "New here?",
	tail: "Start with these",
	href: "/help",
	hrefLabel: "All help articles",
	articles: [],
};

function gate(over: Partial<PromoVisibilityInput> = {}): PromoVisibilityInput {
	return {
		id: "cta-freelancer",
		audience: "everyone",
		dismissible: true,
		dismissed: [],
		viewerFreelancer: false,
		viewerRestricted: false,
		mode: "auto",
		...over,
	};
}

Deno.test("a sponsored slot is featured in its own rail and removed from that rail's items", () => {
	const promos: PromoSlot[] = [sponsored("s2", "services"), sponsored("p1", "products")];
	const items = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];
	const { featured, rest } = featureInRail(items, promos, "services");
	assertEquals(featured.map((p) => p.itemId), ["s2"]);
	assertEquals(rest.map((it) => it.id), ["s1", "s3"]);
});

Deno.test("several sponsored slots in one rail keep feed order and are all de-duplicated", () => {
	const promos: PromoSlot[] = [sponsored("s3", "services"), sponsored("s1", "services")];
	const { featured, rest } = featureInRail([{ id: "s1" }, { id: "s2" }, { id: "s3" }], promos, "services");
	assertEquals(featured.map((p) => p.itemId), ["s3", "s1"]);
	assertEquals(rest.map((it) => it.id), ["s2"]);
});

Deno.test("a rail with no placement keeps every item", () => {
	const { featured, rest } = featureInRail([{ id: "p1" }], [sponsored("s1", "services")], "products");
	assertEquals(featured, []);
	assertEquals(rest.map((it) => it.id), ["p1"]);
});

Deno.test("promosAfter returns only the non-sponsored slots anchored to a section, in order", () => {
	const promos: PromoSlot[] = [
		sponsored("s1", "services"),
		cta("cta-a", "articles"),
		editorial,
		cta("cta-b", "articles"),
	];
	assertEquals(promosAfter(promos, "articles").map((p) => p.id), ["cta-a", "cta-b"]);
	assertEquals(promosAfter(promos, "products").map((p) => p.id), ["ed-help"]);
	assertEquals(promosAfter(promos, "services"), []);
});

Deno.test("a freelancer never sees a non-freelancer slot, whatever the dismissal mode", () => {
	const input = gate({ audience: "non_freelancers", viewerFreelancer: true });
	assertEquals(promoVisible(input), false);
	assertEquals(promoVisible({ ...input, mode: "visible" }), false);
	assertEquals(promoVisible({ ...input, viewerFreelancer: false }), true);
});

Deno.test("a restricted (13–17) viewer never sees a non-freelancer slot — they cannot become one", () => {
	const input = gate({ audience: "non_freelancers", viewerRestricted: true });
	assertEquals(promoVisible(input), false);
	assertEquals(promoVisible({ ...input, mode: "visible" }), false);
	assertEquals(promoVisible({ ...input, audience: "everyone" }), true);
});

Deno.test("a stored dismissal hides a dismissible slot only in auto mode", () => {
	const input = gate({ dismissed: ["cta-freelancer"] });
	assertEquals(promoVisible(input), false);
	assertEquals(promoVisible({ ...input, mode: "visible" }), true);
	assertEquals(promoVisible({ ...input, dismissed: ["cta-team"] }), true);
});

Deno.test("dismissed mode hides every dismissible slot and nothing else", () => {
	assertEquals(promoVisible(gate({ mode: "dismissed" })), false);
	assertEquals(promoVisible(gate({ mode: "dismissed", dismissible: false })), true);
});

Deno.test("the stored list decodes defensively and adds an id once", () => {
	assertEquals(parseDismissed(null), []);
	assertEquals(parseDismissed("not json"), []);
	assertEquals(parseDismissed('{"a":1}'), []);
	assertEquals(parseDismissed('["cta-team", 3]'), ["cta-team"]);
	assertEquals(withDismissed(["cta-team"], "cta-team"), ["cta-team"]);
	assertEquals(withDismissed(["cta-team"], "cta-freelancer"), ["cta-team", "cta-freelancer"]);
});
