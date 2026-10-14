import { assertEquals } from "@std/assert";
import {
	type ActionReason,
	type ClientEngagementRow,
	ClientPipelineSchema,
	type EngagementKind,
} from "@projective/types/catalogue";
import { buildPipeline, grossLabelOf, toClientKey, toEngagements } from "./client-pipeline.ts";

/**
 * client-pipeline_test — RPC rows to the board: which rows survive the mapping, the lanes (derived,
 * never stored), the severity order of action-required work, and the buyer's gross.
 */

// #region Harness
const LISTING = "00000000-0000-4000-8000-0000000c0001";
const OTHER = "00000000-0000-4000-8000-0000000c0002";
const LISTINGS = new Map([
	[LISTING, { slug: "svc-brandpipe01", title: "Brand sprint" }],
	[OTHER, { slug: "prd-dashkit001", title: "Dash kit" }],
]);

let seq = 0;
function row(
	handle: string | null,
	kind: EngagementKind,
	status: string,
	hoursAgo: number,
	extra: Partial<ClientEngagementRow> & { reasons?: ActionReason[] } = {},
): ClientEngagementRow {
	seq++;
	const { reasons, ...rest } = extra;
	return {
		engagement_kind: kind,
		engagement_id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
		listing_id: LISTING,
		buyer_user_id: null,
		buyer_handle: handle,
		status,
		opened_at: new Date(Date.UTC(2026, 9, 1)).toISOString(),
		last_activity_at: new Date(Date.UTC(2026, 9, 13) - hoursAgo * 3_600_000).toISOString(),
		amount_minor: null,
		currency: null,
		next_event_at: null,
		action_reasons: reasons ?? [],
		href: "/messages",
		...rest,
	};
}

const map = (rows: ClientEngagementRow[]) => toEngagements(rows, LISTINGS, new Map());
// #endregion

// #region Mapping
Deno.test("handles become client keys; an invalid or missing handle is no client", () => {
	assertEquals(toClientKey("Ada_Lin"), "@ada_lin");
	assertEquals(toClientKey("@kofi"), "@kofi");
	assertEquals(toClientKey("a"), null);
	assertEquals(toClientKey(null), null);
});

Deno.test("rows outside the scope, without a buyer, or malformed are dropped", () => {
	const kept = map([
		row("ada", "inquiry", "primary", 1),
		row(null, "order", "confirmed", 2),
		row("kofi", "quote", "sent", 3, { listing_id: "00000000-0000-4000-8000-0000000c0009" }),
		{ ...row("noor", "quote", "sent", 4), engagement_id: "not-a-uuid" },
	]);
	assertEquals(kept.map((e) => [e.client.handle, e.listingId, e.client.name]), [
		["@ada", "svc-brandpipe01", "ada"],
	]);
});

Deno.test("a pre-sale engagement is active once the same buyer orders the same listing", () => {
	const [inquiry, , elsewhere] = map([
		row("ada", "inquiry", "primary", 1),
		row("ada", "order", "confirmed", 2, { amount_minor: 5_000, currency: "usd" }),
		row("ada", "quote", "sent", 3, { listing_id: OTHER }),
	]);
	assertEquals([inquiry.hasOrder, elsewhere.hasOrder], [true, false]);
});
// #endregion

// #region Board
Deno.test("lanes group buyers; action-required leads, by severity, then recency", () => {
	const engagements = map([
		row("inquirer", "inquiry", "primary", 1),
		row("buyer", "order", "confirmed", 2),
		row("caller", "discovery_call", "confirmed", 3, { reasons: ["reschedule_open"] }),
		row("disputer", "session_booking", "active", 40, { reasons: ["dispute_open"] }),
		row("reviser", "pipeline_project", "active", 5, {
			reasons: ["submission_pending", "revision_requested"],
		}),
		row("asker", "quote", "sent", 1, { reasons: ["inquiry_unanswered"] }),
		row("gone", "order", "refunded", 9),
	]);
	const board = buildPipeline(engagements, "USD", null, false);
	ClientPipelineSchema.parse(board);
	assertEquals(board.clients.map((c) => [c.client.handle, c.lane]), [
		["@disputer", "action_required"],
		["@reviser", "action_required"],
		["@caller", "action_required"],
		["@asker", "action_required"],
		["@buyer", "active"],
		["@inquirer", "inquiries"],
		["@gone", "closed"],
	]);
	assertEquals(board.counts, { inquiries: 1, active: 1, action_required: 4, closed: 1 });
	const reviser = board.clients[1].engagements[0];
	assertEquals(reviser.actionReasons, ["revision_requested", "submission_pending"]);
});

Deno.test("one buyer's engagements fold into one card at their most urgent lane", () => {
	const board = buildPipeline(
		map([
			row("ada", "order", "refunded", 50),
			row("ada", "inquiry", "primary", 1, { reasons: ["inquiry_unanswered"] }),
			row("ada", "order", "confirmed", 3),
		]),
		"USD",
		null,
		false,
	);
	assertEquals(board.clients.length, 1);
	assertEquals(board.clients[0].lane, "action_required");
	assertEquals(board.clients[0].engagements.map((e) => e.kind), ["inquiry", "order", "order"]);
});

Deno.test("a truncated read says so", () => {
	assertEquals(buildPipeline([], "USD", null, true).hasMore, true);
	assertEquals(buildPipeline([], "USD", null, false).hasMore, false);
});
// #endregion

// #region Gross
Deno.test("gross counts paid orders and sittings, never refunds or project budgets", () => {
	const engagements = map([
		row("ada", "order", "confirmed", 1, { amount_minor: 5_000, currency: "EUR" }),
		row("ada", "session_booking", "active", 2, { amount_minor: 2_000, currency: "EUR" }),
		row("ada", "order", "refunded", 3, { amount_minor: 9_000, currency: "EUR" }),
		row("ada", "pipeline_project", "active", 4, { amount_minor: 90_000, currency: "EUR" }),
	]);
	assertEquals(grossLabelOf(engagements, "USD", null), "€70");
});

Deno.test("mixed currencies convert into the display currency", () => {
	const engagements = map([
		row("ada", "order", "confirmed", 1, { amount_minor: 5_000, currency: "EUR" }),
		row("ada", "order", "confirmed", 2, { amount_minor: 5_000, currency: "USD" }),
	]);
	const convert = (minor: number, from: string) => from === "EUR" ? minor * 2 : null;
	assertEquals(grossLabelOf(engagements, "USD", convert), "$150");
});
// #endregion
