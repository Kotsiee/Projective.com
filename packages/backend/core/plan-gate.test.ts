import { assertEquals } from "@std/assert";
import { parsePlanGatesOverride, readPlanGateDetails } from "@projective/types/finance";
import { isPlanGateRefusal, planGateHeaders, planGateRefusal } from "./plan-gate.ts";
import { refusalFrom } from "../services/workspace/live-support.ts";

Deno.test("planGateRefusal: a business gate's keyed message names the entitlement and keeps only the reason", () => {
	const res = planGateRefusal({
		code: "PK402",
		message:
			"entitlement: business_managers: this business's plan allows 2 managers (admins and roles that manage projects), and they are all taken or offered — upgrade to Business Pro for more",
		hint: "business_managers",
	});
	assertEquals(res.status, 402);
	assertEquals(
		res.message,
		"This business's plan allows 2 managers (admins and roles that manage projects), and they are all taken or offered — upgrade to Business Pro for more.",
	);
	assertEquals(res.details, { reason: "entitlement", entitlement: "business_managers" });
});

Deno.test("planGateRefusal: the team gate's unkeyed message reads the key from HINT", () => {
	const res = planGateRefusal({
		code: "PK402",
		message: "entitlement: this split template is part of Pro Team — upgrade the team to use it",
		hint: "split_template_finders_fee",
	});
	assertEquals(
		res.message,
		"This split template is part of Pro Team — upgrade the team to use it.",
	);
	assertEquals(res.details.entitlement, "split_template_finders_fee");
});

Deno.test("planGateRefusal: the keyed message wins over a missing HINT", () => {
	const res = planGateRefusal({
		code: "PK402",
		message:
			"entitlement: pooled_wallet_full: spending limits and an approval threshold are part of Business Pro",
		hint: null,
	});
	assertEquals(res.details, { reason: "entitlement", entitlement: "pooled_wallet_full" });
	assertEquals(readPlanGateDetails(res.details), res.details);
});

Deno.test("isPlanGateRefusal: only PK402", () => {
	assertEquals(
		isPlanGateRefusal({ code: "PK402", message: "entitlement: intervaled_invoicing: x" }),
		true,
	);
	assertEquals(isPlanGateRefusal({ code: "PK403", message: "payout_not_ready: x" }), false);
	assertEquals(isPlanGateRefusal(null), false);
});

Deno.test("refusalFrom: a business plan gate is a 402 carrying its key", () => {
	const res = refusalFrom({
		code: "PK402",
		message:
			"entitlement: intervaled_invoicing: monthly invoicing is part of Business Pro — upgrade the business to settle on a monthly statement",
		hint: "intervaled_invoicing",
	});
	assertEquals(res.status, 402);
	assertEquals(res.details, { reason: "entitlement", entitlement: "intervaled_invoicing" });
	assertEquals(res.errors, undefined);
});

Deno.test("planGateHeaders: only a recognised override becomes the header", () => {
	assertEquals(planGateHeaders("free"), { "x-pj-dev-plan-gates": "free" });
	assertEquals(planGateHeaders("enforced"), { "x-pj-dev-plan-gates": "enforced" });
	assertEquals(planGateHeaders(null), {});
	assertEquals(planGateHeaders(parsePlanGatesOverride("off")), {});
	assertEquals(parsePlanGatesOverride(" free "), "free");
});
