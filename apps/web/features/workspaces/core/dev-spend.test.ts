import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import type { BusinessSpendPolicy } from "@projective/types/workspace";
import { isSimulatedRequest, simulateQueue } from "./dev-spend.ts";

/**
 * The Dev Context Switcher's `spendRequests` axis (Decision #246): each position draws one lifecycle
 * of the Spend queue from the viewer's own console, and every row it makes up is marked as such.
 */

const money = { minor: 500_000, currency: "USD", display: "US$5,000.00", origin: null };
const policy: BusinessSpendPolicy = {
	currency: "USD",
	approvalThresholdMinor: 500_000,
	approvalThreshold: money,
	platformThresholdMinor: null,
	platformThreshold: null,
	editableMemberIds: [],
	approverGap: false,
	limitsPlanGated: false,
	approverIds: [],
	approverHandles: [],
	limits: [{
		memberId: "m-hannah",
		handle: "hannahcole",
		name: "Hannah Cole",
		avatar: "",
		canSpend: true,
		limitMinor: null,
		limit: null,
		period: "monthly",
		spentMinor: 0,
		spent: { ...money, minor: 0, display: "US$0.00" },
		remainingMinor: null,
		remaining: null,
		usedFraction: 0,
		perTransactionMinor: null,
		perTransaction: null,
	}],
	readsAllEnvelopes: true,
	contributorIds: [],
	contributorHandles: [],
	entries: [],
	approvals: { pending: [], decided: [] },
	verification: "verified",
	verificationPrompt: null,
};
const viewer = { memberId: "m-priya", name: "Priya Raman" };

Deno.test("simulateQueue: auto is the server's queue, untouched", () => {
	const out = simulateQueue(policy, "auto", viewer);
	assertStrictEquals(out.approvals, policy.approvals);
	assertEquals([out.simulated, out.undecidable], [false, false]);
	assertStrictEquals(simulateQueue(policy, undefined, viewer).approvals, policy.approvals);
});

Deno.test("simulateQueue: each position draws its lifecycle, every made-up row marked", () => {
	assertEquals(simulateQueue(policy, "empty", viewer).approvals, { pending: [], decided: [] });

	const others = simulateQueue(policy, "others_pending", viewer);
	assertEquals(others.approvals.pending.map((r) => [r.memberId, r.name]), [
		["m-hannah", "Hannah Cole"],
		["m-hannah", "Hannah Cole"],
	]);
	assert(others.approvals.pending.every((r) => isSimulatedRequest(r.id)));

	assertEquals(
		simulateQueue(policy, "own_pending", viewer).approvals.pending[0].memberId,
		"m-priya",
	);

	assertEquals(
		simulateQueue(policy, "history", viewer).approvals.decided.map((r) => r.state),
		["approved", "declined", "withdrawn", "expired"],
	);

	const kyb = simulateQueue(policy, "kyb_approver", viewer);
	assertEquals([kyb.simulated, kyb.undecidable], [false, true]);
	assert(!isSimulatedRequest("8ea0bfc1-4e4b-4adc-ac60-07879e1f86aa"));
});
