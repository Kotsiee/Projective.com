import type {
	BusinessSpendPolicy,
	SpendApprovals,
	SpendRequest,
} from "@projective/types/workspace";

/**
 * dev-spend — what the Dev Context Switcher's `spendRequests` axis substitutes on a business's Spend
 * module (BU2, Decision #246). A request's lifecycle — somebody else's waiting request, one's own, the
 * decided history (withdrawn included), an approver on a business still in KYB — takes real requests,
 * real approvers and a real verification to reach; the axis previews each from the viewer's own
 * console. Client-side only: simulated rows carry a `sim-` id and offer no control, and every write
 * still goes to the server.
 */

// #region Shapes
/**
 * The positions of the axis — `DevSpendRequests` in `@web/utils/dev-seam.ts`, spelled out here because
 * that module reads the DOM and cannot load under `deno test`. The island passes the seam's value
 * straight in.
 */
export type SpendRequestsSimulation =
	| "auto"
	| "empty"
	| "others_pending"
	| "own_pending"
	| "history"
	| "kyb_approver";

/** What the queue renders under a simulation. */
export interface SimulatedQueue {
	approvals: SpendApprovals;
	/** The rows are made up: they offer no control and say so. */
	simulated: boolean;
	/** Draw the viewer as an approver of a business still in KYB (no Approve, the KYB notice). */
	undecidable: boolean;
}
// #endregion

// #region Simulation
/** Whether a request row is one the axis made up. */
export function isSimulatedRequest(id: string): boolean {
	return id.startsWith("sim-");
}

/**
 * The queue under a simulation. Faces and amounts are borrowed from the viewer's own console — another
 * member's envelope row, a figure the server already formatted — so nothing is formatted or invented
 * on the client beyond the words.
 */
export function simulateQueue(
	policy: BusinessSpendPolicy,
	sim: SpendRequestsSimulation | undefined,
	viewer: { memberId: string; name: string },
): SimulatedQueue {
	const real = { approvals: policy.approvals, simulated: false, undecidable: false };
	if (!sim || sim === "auto") return real;
	if (sim === "kyb_approver") return { ...real, undecidable: true };
	if (sim === "empty") {
		return { approvals: { pending: [], decided: [] }, simulated: true, undecidable: false };
	}

	const other = policy.limits.find((l) => l.memberId !== viewer.memberId);
	const amount = policy.approvalThreshold ?? policy.platformThreshold ??
		policy.limits[0]?.spent ??
		{ minor: 0, currency: policy.currency, display: policy.currency, origin: null };
	const row = (id: string, who: "self" | "other", extra: Partial<SpendRequest>): SpendRequest => ({
		id: `sim-${id}`,
		memberId: who === "self" ? viewer.memberId : other?.memberId ?? "sim-member",
		handle: who === "self" ? "" : other?.handle ?? "",
		name: who === "self" ? viewer.name : other?.name ?? "A member",
		avatar: who === "self" ? "" : other?.avatar ?? "",
		amount,
		reason: "Simulated request",
		state: "pending",
		raisedAt: "Today",
		approvers: [],
		decidedBy: null,
		decidedAt: null,
		expiresLabel: "Expires in 7 days",
		ref: null,
		consumed: false,
		...extra,
	});

	switch (sim) {
		case "others_pending":
			return {
				approvals: { pending: [row("1", "other", {}), row("2", "other", {})], decided: [] },
				simulated: true,
				undecidable: false,
			};
		case "own_pending":
			return {
				approvals: { pending: [row("1", "self", {})], decided: [] },
				simulated: true,
				undecidable: false,
			};
		case "history": {
			const decided = (
				id: string,
				state: SpendRequest["state"],
				extra: Partial<SpendRequest> = {},
			) => row(id, "other", { state, expiresLabel: null, decidedAt: "Yesterday", ...extra });
			return {
				approvals: {
					pending: [],
					decided: [
						decided("1", "approved", { decidedBy: viewer.name, consumed: true }),
						decided("2", "declined", { decidedBy: viewer.name }),
						decided("3", "withdrawn"),
						decided("4", "expired", { decidedAt: null }),
					],
				},
				simulated: true,
				undecidable: false,
			};
		}
	}
}
// #endregion
