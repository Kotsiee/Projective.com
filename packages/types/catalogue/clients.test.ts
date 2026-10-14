import { assertEquals } from "@std/assert";
import {
	type ActionReason,
	type ClientEngagement,
	type ClientLane,
	clientLaneOf,
	CLOSED_STATUSES,
	type EngagementKind,
	laneOf,
} from "./clients.ts";
import { rateOrNull } from "./analytics.ts";

function engagement(
	kind: EngagementKind,
	status: string,
	extra: { hasOrder?: boolean; actionReasons?: ActionReason[] } = {},
): ClientEngagement {
	return {
		id: `${kind}-1`,
		kind,
		status,
		client: { handle: "@maris", name: "Maris Okafor", avatar: "" },
		listingId: "svc-23456789ab",
		listingTitle: "Brand identity sprint",
		hasOrder: extra.hasOrder ?? false,
		actionReasons: extra.actionReasons ?? [],
		amountMinor: null,
		currency: null,
		openedAt: "2026-10-01T00:00:00.000Z",
		lastActivityAt: "2026-10-02T00:00:00.000Z",
		nextEventAt: null,
		href: "/messages",
	};
}

const TABLE: ReadonlyArray<[ClientEngagement, ClientLane]> = [
	[engagement("inquiry", "open"), "inquiries"],
	[engagement("quote", "sent"), "inquiries"],
	[engagement("quote", "answered"), "inquiries"],
	[engagement("discovery_call", "proposed"), "inquiries"],
	[engagement("discovery_call", "confirmed"), "inquiries"],
	[engagement("inquiry", "open", { hasOrder: true }), "active"],
	[engagement("quote", "answered", { hasOrder: true }), "active"],
	[engagement("order", "confirmed"), "active"],
	[engagement("order", "invoiced"), "active"],
	[engagement("session_booking", "scheduled"), "active"],
	[engagement("pipeline_project", "active"), "active"],
	[engagement("inquiry", "archived"), "closed"],
	[engagement("quote", "withdrawn"), "closed"],
	[engagement("discovery_call", "no_show"), "closed"],
	[engagement("order", "refunded"), "closed"],
	[engagement("session_booking", "cancelled_by_client"), "closed"],
	[engagement("pipeline_project", "archived"), "closed"],
	[engagement("inquiry", "open", { actionReasons: ["inquiry_unanswered"] }), "action_required"],
	[engagement("order", "confirmed", { actionReasons: ["revision_requested"] }), "action_required"],
	[
		engagement("pipeline_project", "completed", { actionReasons: ["dispute_open"] }),
		"action_required",
	],
];

Deno.test("laneOf places every engagement by its recorded state", () => {
	for (const [e, lane] of TABLE) assertEquals(laneOf(e), lane, `${e.kind}/${e.status}`);
});

Deno.test("an action reason outranks a closed status", () => {
	for (const kind of Object.keys(CLOSED_STATUSES) as EngagementKind[]) {
		for (const status of CLOSED_STATUSES[kind]) {
			assertEquals(laneOf(engagement(kind, status)), "closed");
			assertEquals(
				laneOf(engagement(kind, status, { actionReasons: ["reschedule_open"] })),
				"action_required",
			);
		}
	}
});

Deno.test("a client sits in their most urgent lane", () => {
	const open = engagement("inquiry", "open");
	const order = engagement("order", "confirmed");
	const closed = engagement("order", "refunded");
	const urgent = engagement("order", "confirmed", { actionReasons: ["handshake_pending"] });
	assertEquals(clientLaneOf([closed, open]), "inquiries");
	assertEquals(clientLaneOf([open, order]), "active");
	assertEquals(clientLaneOf([order, urgent, closed]), "action_required");
	assertEquals(clientLaneOf([]), "closed");
});

Deno.test("rateOrNull withholds a rate below twenty in the denominator", () => {
	assertEquals(rateOrNull(3, 19), null);
	assertEquals(rateOrNull(5, 20), 0.25);
	assertEquals(rateOrNull(0, 0), null);
	assertEquals(rateOrNull(1, Number.NaN), null);
});
