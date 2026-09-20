import { assertEquals } from "@std/assert";
import type { ServiceItem } from "../types/profile-types.ts";
import {
	consultationPriceLabel,
	estimatedSpendFor,
	hireProjectsFrom,
	isFastResponder,
	parseReviewStance,
	responseLabel,
	reviewsForStance,
	reviewStanceCounts,
	reviewStanceOf,
	rigFor,
} from "./profile-model.ts";

Deno.test("rigFor: a seller with something to hire for leads with Hire; Add-to-project is there for a member", () => {
	// A listing or a consultation is something the Hire popover can show.
	assertEquals(rigFor("freelancer", { hasServices: true, offersConsultation: false, authed: true }), {
		layout: "seller",
		hire: true,
		addToProject: true,
		primary: "hire",
	});
	assertEquals(rigFor("team", { hasServices: false, offersConsultation: true, authed: true }), {
		layout: "seller",
		hire: true,
		addToProject: true,
		primary: "hire",
	});
	// Neither: no Hire (an empty popover is not a control), and Add-to-project takes the primary.
	assertEquals(rigFor("freelancer", { hasServices: false, offersConsultation: false, authed: true }), {
		layout: "seller",
		hire: false,
		addToProject: true,
		primary: "add",
	});
	// A guest keeps Hire (the press is what opens the sign-in prompt) and never sees Add-to-project.
	assertEquals(rigFor("freelancer", { hasServices: true, offersConsultation: false, authed: false }), {
		layout: "seller",
		hire: true,
		addToProject: false,
		primary: "hire",
	});
	// A buyer entity cannot be hired or assigned, whatever it offers.
	for (const kind of ["client", "business", "organisation"] as const) {
		assertEquals(rigFor(kind, { hasServices: true, offersConsultation: true, authed: true }), {
			layout: "buyer",
			hire: false,
			addToProject: false,
			primary: "message",
		});
	}
});

Deno.test("consultationPriceLabel: Free whenever a courtesy call exists, else the paid fee", () => {
	assertEquals(consultationPriceLabel(null), null);
	assertEquals(
		consultationPriceLabel({
			courtesyEnabled: true,
			paidEnabled: true,
			feeAmountMinor: 7500,
			feeCurrency: "GBP",
		}),
		"Free",
	);
	assertEquals(
		consultationPriceLabel({
			courtesyEnabled: false,
			paidEnabled: true,
			feeAmountMinor: 7500,
			feeCurrency: "GBP",
		}),
		"£75.00",
	);
	assertEquals(
		consultationPriceLabel({
			courtesyEnabled: false,
			paidEnabled: false,
			feeAmountMinor: null,
			feeCurrency: null,
		}),
		null,
	);
});

Deno.test("hireProjectsFrom keeps only open engagements, published first, as slim rows", () => {
	const row = (slug: string, status: "draft" | "active" | "on_hold" | "completed" | "cancelled") =>
		({ slug, title: `Project ${slug}`, scopeLabel: "Personal", status }) as never;
	const rows = hireProjectsFrom([
		row("prj-c", "draft"),
		row("prj-a", "active"),
		row("prj-b", "completed"),
		row("prj-d", "cancelled"),
		row("prj-e", "on_hold"),
	]);
	// Published (active · on hold) lead in feed order; the draft follows rather than leading the list.
	assertEquals(rows.map((r) => r.slug), ["prj-a", "prj-e", "prj-c"]);
	assertEquals(rows[0], {
		slug: "prj-a",
		title: "Project prj-a",
		scopeLabel: "Personal",
		status: "active",
		published: true,
	});
	assertEquals(rows[2].published, false);
});

Deno.test("review stance is the author's role inverted", () => {
	// The author was the CLIENT → the profile was reviewed as a freelancer.
	assertEquals(reviewStanceOf({ role: "client" }), "freelancer");
	assertEquals(reviewStanceOf({ role: "freelancer" }), "client");

	const reviews = [
		{ id: "a", role: "client" as const },
		{ id: "b", role: "freelancer" as const },
		{ id: "c", role: "client" as const },
	];
	assertEquals(reviewsForStance(reviews, "all").map((r) => r.id), ["a", "b", "c"]);
	assertEquals(reviewsForStance(reviews, "freelancer").map((r) => r.id), ["a", "c"]);
	assertEquals(reviewsForStance(reviews, "client").map((r) => r.id), ["b"]);
	assertEquals(reviewStanceCounts(reviews), { all: 3, freelancer: 2, client: 1 });
});

Deno.test("parseReviewStance accepts only the two stances", () => {
	assertEquals(parseReviewStance("freelancer"), "freelancer");
	assertEquals(parseReviewStance("client"), "client");
	assertEquals(parseReviewStance("all"), "all");
	assertEquals(parseReviewStance("evil"), "all");
	assertEquals(parseReviewStance(null), "all");
});

Deno.test("responseLabel rounds to the unit a reader plans around", () => {
	assertEquals(responseLabel(45), "~45 min");
	assertEquals(responseLabel(60), "~1 hr");
	assertEquals(responseLabel(120), "~2 hrs");
	assertEquals(responseLabel(240), "~4 hrs");
	assertEquals(responseLabel(1440), "~1 day");
	assertEquals(responseLabel(4320), "~3 days");
});

Deno.test("isFastResponder is the card's threshold and never fires unmeasured", () => {
	assertEquals(isFastResponder(45), true);
	assertEquals(isFastResponder(60), true);
	assertEquals(isFastResponder(61), false);
	assertEquals(isFastResponder(null), false);
	assertEquals(isFastResponder(undefined), false);
});

const service = (over: Partial<ServiceItem>): ServiceItem => ({
	id: "sv-1",
	type: "services",
	title: "Service",
	owner: { handle: "@x", name: "X", avatar: "", kind: "freelancer" },
	price: "$500",
	delivery: "5 days",
	category: "design",
	serviceType: "One-Off",
	createdAt: "2026-01-01",
	...over,
} as ServiceItem);

Deno.test("estimatedSpendFor is the cheapest structured floor and its unit", () => {
	const spend = estimatedSpendFor([
		service({ id: "a", serviceType: "One-Off", priceMinor: 50_000, currency: "USD" }),
		service({
			id: "b",
			serviceType: "Pipeline",
			ticketPrice: 240,
			priceMinor: 24_000,
			currency: "USD",
		}),
		service({ id: "c", serviceType: "Session", sessionPrice: 180, currency: "USD" }),
	]);
	// The pipeline's floor is 0.5× its ticket price → $120 / ticket, the cheapest start.
	assertEquals(spend, { amount: { minor: 12_000, currency: "USD" }, unit: "ticket" });
});

Deno.test("estimatedSpendFor invents nothing for an unpriced catalogue", () => {
	assertEquals(estimatedSpendFor([]), null);
	assertEquals(estimatedSpendFor([service({ price: "Contact us" })]), null);
});
