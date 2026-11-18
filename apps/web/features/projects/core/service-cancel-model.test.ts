import { assert, assertEquals, assertFalse } from "@std/assert";
import { canCancelService, type ServiceCancelPreview } from "@projective/types/projects";
import {
	canConfirmServiceCancel,
	defaultServiceCancelTiers,
	effectiveServiceRole,
	serviceCancelBlockedText,
	serviceCancelConsequences,
	stageQuoteFor,
} from "./service-cancel-model.ts";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

function quote(tier: 25 | 50 | 75, paid: number) {
	return { tier, ticketCount: 1, freelancerPaidCents: paid, feeCents: 0, clientRefundedCents: 0 };
}

function preview(over: Partial<ServiceCancelPreview> = {}): ServiceCancelPreview {
	return {
		currency: "USD",
		cancellable: true,
		blocked: null,
		returnedCents: 58000,
		ticketsToCancel: 3,
		stages: [
			{
				stageId: S1,
				stageName: "Discovery",
				tiers: [quote(25, 7600), quote(50, 15200), quote(75, 22800)],
			},
			{ stageId: S2, stageName: "Build", tiers: [quote(25, 100), quote(50, 200), quote(75, 300)] },
		],
		...over,
	};
}

Deno.test("only a bought service's client may cancel it, and only before it ends", () => {
	assert(canCancelService("service", "client", "draft"));
	assert(canCancelService("service", "client", "active"));
	assert(canCancelService("service", "client", "on_hold"));
	assertFalse(canCancelService("service", "freelancer", "active"), "the seller never cancels");
	assertFalse(canCancelService("service", "owner", "active"));
	assertFalse(canCancelService("project", "client", "active"), "a brief has no Cancel service");
	for (const ended of ["completed", "cancelled", "archived"] as const) {
		assertFalse(canCancelService("service", "client", ended), ended);
	}
});

Deno.test("a simulated service side stands in for the server's role, on a service only", () => {
	assertEquals(effectiveServiceRole("service", "freelancer", "client"), "client");
	assertEquals(effectiveServiceRole("service", "client", "provider"), "freelancer");
	assertEquals(effectiveServiceRole("service", "client", "auto"), "client");
	assertEquals(effectiveServiceRole("service", "freelancer", undefined), "freelancer");
	assertEquals(
		effectiveServiceRole("project", "owner", "client"),
		"owner",
		"a brief keeps its role",
	);
	assert(
		canCancelService("service", effectiveServiceRole("service", "freelancer", "client"), "active"),
	);
	assertFalse(
		canCancelService("service", effectiveServiceRole("service", "client", "provider"), "active"),
	);
});

Deno.test("every stage holding claimed work opens on 50% and shows that tier's quote", () => {
	const p = preview();
	const tiers = defaultServiceCancelTiers(p);
	assertEquals(tiers, { [S1]: 50, [S2]: 50 });
	assertEquals(stageQuoteFor(p.stages[0], tiers)?.freelancerPaidCents, 15200);
	assertEquals(stageQuoteFor(p.stages[0], { ...tiers, [S1]: 75 })?.freelancerPaidCents, 22800);
	assertEquals(stageQuoteFor(p.stages[1], {}), null);
	assertEquals(defaultServiceCancelTiers(null), {});
});

Deno.test("the confirm needs a cancellable preview, a tier on every stage and nothing in flight", () => {
	const p = preview();
	const tiers = defaultServiceCancelTiers(p);
	assert(canConfirmServiceCancel(p, tiers, false));
	assertFalse(canConfirmServiceCancel(p, tiers, true), "in flight");
	assertFalse(canConfirmServiceCancel(p, { [S1]: 50 }, false), "stage 2 has no tier");
	assertFalse(canConfirmServiceCancel(null, tiers, false));
	assertFalse(
		canConfirmServiceCancel(preview({ cancellable: false, blocked: "ended" }), tiers, false),
	);
	assert(
		canConfirmServiceCancel(preview({ stages: [] }), {}, false),
		"nothing claimed: refund only",
	);
});

Deno.test("a blocked service says why, and the meta line counts the tickets it closes", () => {
	assert(serviceCancelBlockedText("ended").includes("already ended"));
	assert(serviceCancelBlockedText("settling").includes("paid out"));
	assertEquals(serviceCancelConsequences(preview()), [
		"3 open tickets will be cancelled",
		"this cannot be undone",
	]);
	assertEquals(
		serviceCancelConsequences(preview({ ticketsToCancel: 1 }))[0],
		"1 open ticket will be cancelled",
	);
	assertEquals(serviceCancelConsequences(preview({ ticketsToCancel: 0 })), [
		"this cannot be undone",
	]);
});
