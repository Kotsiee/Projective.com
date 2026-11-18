import { assert, assertEquals, assertFalse } from "@std/assert";
import { canCancelEngagement, type ProjectCancelPreview } from "@projective/types/projects";
import {
	canConfirmProjectCancel,
	defaultProjectCancelTiers,
	effectiveServiceRole,
	isSettleFirstRefusal,
	projectCancelBlockedText,
	projectCancelConsequences,
	projectCancelCopy,
	projectCancelMovesMoney,
	stageQuoteFor,
} from "./project-cancel-model.ts";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

function quote(tier: 25 | 50 | 75, paid: number) {
	return { tier, ticketCount: 1, freelancerPaidCents: paid, feeCents: 0, clientRefundedCents: 0 };
}

function preview(over: Partial<ProjectCancelPreview> = {}): ProjectCancelPreview {
	return {
		kind: "project",
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

Deno.test("a bought service's client, or a brief's owner side, may cancel before it ends", () => {
	assert(canCancelEngagement("service", "client", "draft"));
	assert(canCancelEngagement("service", "client", "active"));
	assert(canCancelEngagement("service", "client", "on_hold"));
	assertFalse(canCancelEngagement("service", "freelancer", "active"), "the seller never cancels");
	assertFalse(canCancelEngagement("service", "owner", "active"));
	for (const role of ["owner", "admin", "client"] as const) {
		assert(canCancelEngagement("project", role, "active"), `a brief's ${role} cancels`);
	}
	assertFalse(
		canCancelEngagement("project", "freelancer", "active"),
		"a hired freelancer never cancels",
	);
	assertFalse(canCancelEngagement("project", "member", "active"));
	for (const ended of ["completed", "cancelled", "archived"] as const) {
		assertFalse(canCancelEngagement("service", "client", ended), ended);
		assertFalse(canCancelEngagement("project", "owner", ended), ended);
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
		canCancelEngagement(
			"service",
			effectiveServiceRole("service", "freelancer", "client"),
			"active",
		),
	);
	assertFalse(
		canCancelEngagement("service", effectiveServiceRole("service", "client", "provider"), "active"),
	);
});

Deno.test("one dialog words a brief and a service", () => {
	assertEquals(projectCancelCopy("project").header, "Cancel this project?");
	assertEquals(projectCancelCopy("project").keep, "Keep project");
	assertEquals(projectCancelCopy("service").commit, "Cancel service");
	assertEquals(
		projectCancelCopy("service").settleCommit,
		projectCancelCopy("project").settleCommit,
	);
});

Deno.test("every stage holding claimed work opens on 50% and shows that tier's quote", () => {
	const p = preview();
	const tiers = defaultProjectCancelTiers(p);
	assertEquals(tiers, { [S1]: 50, [S2]: 50 });
	assertEquals(stageQuoteFor(p.stages[0], tiers)?.freelancerPaidCents, 15200);
	assertEquals(stageQuoteFor(p.stages[0], { ...tiers, [S1]: 75 })?.freelancerPaidCents, 22800);
	assertEquals(stageQuoteFor(p.stages[1], {}), null);
	assertEquals(defaultProjectCancelTiers(null), {});
});

Deno.test("the commit is the money-moving one only when cancelling moves money", () => {
	assert(projectCancelMovesMoney(preview()), "refunds and a settlement");
	assert(projectCancelMovesMoney(preview({ stages: [] })), "a refund alone moves money");
	assert(projectCancelMovesMoney(preview({ returnedCents: 0 })), "a settlement alone moves money");
	assertFalse(projectCancelMovesMoney(preview({ returnedCents: 0, stages: [] })), "nothing held");
	assertFalse(projectCancelMovesMoney(preview({ cancellable: false, blocked: "dispute" })));
	assertFalse(projectCancelMovesMoney(null));
});

Deno.test("the confirm needs a cancellable preview, a tier on every stage and nothing in flight", () => {
	const p = preview();
	const tiers = defaultProjectCancelTiers(p);
	assert(canConfirmProjectCancel(p, tiers, false));
	assertFalse(canConfirmProjectCancel(p, tiers, true), "in flight");
	assertFalse(canConfirmProjectCancel(p, { [S1]: 50 }, false), "stage 2 has no tier");
	assertFalse(canConfirmProjectCancel(null, tiers, false));
	for (const blocked of ["ended", "dispute", "sittings", "settling"] as const) {
		assertFalse(
			canConfirmProjectCancel(preview({ cancellable: false, blocked }), tiers, false),
			blocked,
		);
	}
	assert(
		canConfirmProjectCancel(preview({ stages: [] }), {}, false),
		"nothing claimed: refund only",
	);
});

Deno.test("a blocked engagement says why, in its own noun", () => {
	assert(projectCancelBlockedText("ended", "service").includes("This service has already ended"));
	assert(projectCancelBlockedText("ended").includes("This project has already ended"));
	assert(projectCancelBlockedText("dispute").includes("dispute is open"));
	assert(projectCancelBlockedText("sittings").includes("sittings"));
	assert(projectCancelBlockedText("settling").includes("paid out"));
});

Deno.test("the meta line counts the tickets it closes", () => {
	assertEquals(projectCancelConsequences(preview()), [
		"3 open tickets will be cancelled",
		"this cannot be undone",
	]);
	assertEquals(
		projectCancelConsequences(preview({ ticketsToCancel: 1 }))[0],
		"1 open ticket will be cancelled",
	);
	assertEquals(projectCancelConsequences(preview({ ticketsToCancel: 0 })), [
		"this cannot be undone",
	]);
});

Deno.test("a refused archive over held money hands over to Cancel", () => {
	assert(isSettleFirstRefusal({ status: "settle_first" }));
	assertFalse(isSettleFirstRefusal({ status: "not_allowed" }));
	assertFalse(isSettleFirstRefusal(undefined));
});
