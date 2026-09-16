import { assertEquals } from "@std/assert";
import type { ServiceItem } from "../types/profile-types.ts";
import {
	ctaFor,
	estimatedSpendFor,
	hireProjectsFrom,
	isFastResponder,
	parseReviewStance,
	responseLabel,
	reviewsForStance,
	reviewStanceCounts,
	reviewStanceOf,
} from "./profile-model.ts";

Deno.test("ctaFor leads a seller with Hire and a buyer with Message", () => {
	const hire = (target: "projects" | "services" | "signin") => ({
		layout: "hire" as const,
		primary: "Hire" as const,
		target,
	});
	const message = { layout: "message" as const, primary: "Message" as const, target: null };
	const viewer = (authed: boolean, hasServices: boolean, openProjectCount: number) => ({
		authed,
		hasServices,
		openProjectCount,
	});

	// A guest is intercepted whatever the seller has — the prompt decides what happens next.
	assertEquals(ctaFor("freelancer", viewer(false, true, 0)), hire("signin"));
	assertEquals(ctaFor("team", viewer(false, false, 0)), hire("signin"));
	// Case A — open projects win over listings: the client picks where to bring the seller in.
	assertEquals(ctaFor("freelancer", viewer(true, true, 2)), hire("projects"));
	assertEquals(ctaFor("freelancer", viewer(true, false, 1)), hire("projects"));
	// Case B — nothing to hire into, something to buy.
	assertEquals(ctaFor("team", viewer(true, true, 0)), hire("services"));
	// Case C — nothing to hire into and nothing to buy: no Hire, the text pair instead.
	assertEquals(ctaFor("freelancer", viewer(true, false, 0)), message);
	// A buyer entity cannot be hired, whatever the viewer holds.
	for (const kind of ["client", "business", "organisation"] as const) {
		assertEquals(ctaFor(kind, viewer(true, true, 3)), message);
		assertEquals(ctaFor(kind, viewer(false, true, 0)), message);
	}
});

Deno.test("hireProjectsFrom keeps only open engagements, as slim rows", () => {
	const row = (slug: string, status: "draft" | "active" | "on_hold" | "completed" | "cancelled") =>
		({ slug, title: `Project ${slug}`, scopeLabel: "Personal", status }) as never;
	const rows = hireProjectsFrom([
		row("prj-a", "active"),
		row("prj-b", "completed"),
		row("prj-c", "draft"),
		row("prj-d", "cancelled"),
		row("prj-e", "on_hold"),
	]);
	assertEquals(rows.map((r) => r.slug), ["prj-a", "prj-c", "prj-e"]);
	assertEquals(rows[0], {
		slug: "prj-a",
		title: "Project prj-a",
		scopeLabel: "Personal",
		status: "active",
	});
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
