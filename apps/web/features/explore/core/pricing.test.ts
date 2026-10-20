import { assertEquals } from "@std/assert";
import { freelancerFloorAmount, projectBudgetAmount, serviceStartingPrice } from "./pricing.ts";
import type { ProfileItem, ProjectItem, ServiceItem } from "../types/explore-types.ts";

/** The fields pricing reads; every other field is irrelevant to it. */
function service(over: Partial<ServiceItem>): ServiceItem {
	return { type: "services", price: "", serviceType: "One-Off", ...over } as ServiceItem;
}

Deno.test("a Pipeline starts at its Low-intensity ticket price, in its own currency", () => {
	const p = serviceStartingPrice(
		service({ serviceType: "Pipeline", ticketPrice: 240, currency: "GBP" }),
	);
	assertEquals(p.amount, { minor: 12000, currency: "GBP" });
	assertEquals(p.unit, "ticket");
	assertEquals(p.isFloor, true);
});

Deno.test("a One-Off quotes its whole price, never a floor", () => {
	const p = serviceStartingPrice(service({ priceMinor: 180000, currency: "EUR" }));
	assertEquals(p.amount, { minor: 180000, currency: "EUR" });
	assertEquals(p.isFloor, false);
});

Deno.test("a yen session is not scaled by a hundred", () => {
	const p = serviceStartingPrice(
		service({ serviceType: "Session", sessionPrice: 5000, currency: "JPY" }),
	);
	assertEquals(p.amount, { minor: 5000, currency: "JPY" });
});

Deno.test("a freelancer's floor is structured, and absent across currencies", () => {
	const fl = {
		type: "freelancers",
		servicePrices: [5, 120, 130, 140, 150, 160],
		serviceCurrency: "GBP",
	} as ProfileItem;
	assertEquals(freelancerFloorAmount(fl), { minor: 12000, currency: "GBP" });
	assertEquals(freelancerFloorAmount({ ...fl, serviceCurrency: undefined }), null);
});

Deno.test("a project budget is structured money, or nothing", () => {
	const pj = { type: "projects", budget: "€54,000", budgetMinor: 5400000, currency: "EUR" };
	assertEquals(projectBudgetAmount(pj as ProjectItem), { minor: 5400000, currency: "EUR" });
	assertEquals(projectBudgetAmount({ ...pj, budgetMinor: undefined } as ProjectItem), null);
});
