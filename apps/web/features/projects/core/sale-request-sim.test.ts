import { assertEquals } from "@std/assert";
import { ProjectSaleRequestsSchema } from "@projective/types/catalogue";
import { applySaleRequestSim, parseSaleRequestSim } from "./sale-request-sim.ts";

const EMPTY = { grantsEnabled: false, royaltyMaxBp: 5000, stages: [], requests: [] };

Deno.test("sale-request sim: an unknown cookie value invents no state", () => {
	assertEquals(parseSaleRequestSim("granted"), "granted");
	assertEquals(parseSaleRequestSim("approved"), null);
	assertEquals(parseSaleRequestSim(undefined), null);
});

Deno.test("sale-request sim: no simulation passes the read through", () => {
	assertEquals(applySaleRequestSim(EMPTY, null), EMPTY);
});

Deno.test("sale-request sim: every state is a valid read, seen from the right side", () => {
	for (
		const sim of ["can_request", "requested", "granted", "declined", "client_pending"] as const
	) {
		const read = applySaleRequestSim(EMPTY, sim, 0);
		assertEquals(ProjectSaleRequestsSchema.safeParse(read).success, true, sim);
		const request = read.requests[0];
		if (sim === "can_request") assertEquals(read.requests.length, 0);
		if (sim === "client_pending") {
			assertEquals(read.stages.length, 0);
			assertEquals([request.role, request.canDecide], ["client", true]);
		}
		if (sim === "requested") {
			assertEquals([request.canWithdraw, read.stages[0].openRequest], [
				true,
				true,
			]);
		}
		if (sim === "granted") {
			assertEquals([request.status, request.productSlug], [
				"approved",
				"prd-preview493",
			]);
		}
	}
});
