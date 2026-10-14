import { assertEquals } from "@std/assert";
import { fixtureClient, fixturePipeline } from "@server/services/catalogue/clients-fixtures.ts";
import { CONSOLE_DEFAULTS, LANE_ORDER, WORKSPACE_DEFAULTS } from "../types/catalogue-types.ts";
import type { ClientPipeline } from "../types/catalogue-types.ts";
import {
	boardLanes,
	clientDetailPath,
	clientPipelinePath,
	clientRowId,
	closeFocusTarget,
	consolePanelOf,
	moveBoardFocus,
	nextEventAt,
	primaryReason,
	rovingStop,
	rowMeta,
	statusLabel,
} from "./client-model.ts";
import { workspacePanelOf } from "./workspace-model.ts";
import { counterpartyAcceptRefusal } from "@projective/types/scheduling";

const NOW = Date.parse("2026-10-14T12:00:00Z");

function busy(): ClientPipeline {
	const board = fixturePipeline({ filter: "all" }, "busy", "GBP", NOW);
	if (!board) throw new Error("the fixture catalogue has a board");
	return board;
}

// #region Grouping and order
Deno.test("the board lays the service's lanes out in urgency order with their counts", () => {
	const pipeline = busy();
	const lanes = boardLanes(pipeline);
	assertEquals(lanes.map((l) => l.lane), [...LANE_ORDER]);
	for (const lane of lanes) {
		assertEquals(lane.count, pipeline.counts[lane.lane]);
		assertEquals(lane.clients.every((c) => c.lane === lane.lane), true);
	}
	assertEquals(lanes.reduce((n, l) => n + l.clients.length, 0), pipeline.clients.length);
});

Deno.test("a lane keeps the service's order: severity first, then recency", () => {
	const lanes = boardLanes(busy());
	const needs = lanes.find((l) => l.lane === "action_required");
	const order = needs?.clients.map((c) => primaryReason(c));
	assertEquals(order?.[0], "dispute_open");
	assertEquals(order?.[1], "revision_requested");
	const service = busy().clients.filter((c) => c.lane === "action_required");
	assertEquals(needs?.clients.map((c) => c.client.handle), service.map((c) => c.client.handle));
});

Deno.test("an empty pipeline still draws every lane, each with nobody in it", () => {
	const empty = fixturePipeline({ filter: "all" }, "empty", "GBP", NOW);
	const lanes = boardLanes(empty as ClientPipeline);
	assertEquals(lanes.length, 4);
	assertEquals(lanes.every((l) => l.clients.length === 0 && l.count === 0), true);
});

Deno.test("only an actionable buyer carries a reason; the most severe one wins", () => {
	const pipeline = busy();
	for (const c of pipeline.clients) {
		const reason = primaryReason(c);
		assertEquals(reason !== null, c.engagements.some((e) => e.actionReasons.length > 0));
	}
	const kofi = pipeline.clients.find((c) => c.client.handle === "@kofi_mensah");
	assertEquals(kofi && primaryReason(kofi), "revision_requested");
});

Deno.test("row meta names the listing in console scope only, and counts the rest", () => {
	const ada = busy().clients.find((c) => c.client.handle === "@ada_lin");
	if (!ada) throw new Error("Ada is on the busy board");
	const lead = ada.engagements[0];
	assertEquals(rowMeta(ada, true).slice(0, 2), ["Session", lead.listingTitle]);
	assertEquals(rowMeta(ada, false)[0], "Session");
	assertEquals(rowMeta(ada, false).includes(lead.listingTitle), false);
	assertEquals(rowMeta(ada, true).at(-1), `+${ada.engagements.length - 1} more`);
});

Deno.test("status words read as a sentence", () => {
	assertEquals(statusLabel("cancelled_by_client"), "Cancelled by client");
	assertEquals(statusLabel(""), "");
});

Deno.test("the next event is the soonest one ahead", () => {
	const noor = fixtureClient("@noor_haddad", { filter: "all" }, "busy", "GBP", NOW);
	assertEquals(nextEventAt(noor?.engagements ?? []), "2026-10-15T14:00:00.000Z");
	assertEquals(nextEventAt([]), null);
});
// #endregion

// #region Roving focus
Deno.test("arrows move within a lane and clamp at its ends", () => {
	const sizes = [3, 0, 2, 1];
	assertEquals(moveBoardFocus(sizes, { lane: 0, row: 0 }, "ArrowDown"), { lane: 0, row: 1 });
	assertEquals(moveBoardFocus(sizes, { lane: 0, row: 2 }, "ArrowDown"), { lane: 0, row: 2 });
	assertEquals(moveBoardFocus(sizes, { lane: 0, row: 0 }, "ArrowUp"), { lane: 0, row: 0 });
	assertEquals(moveBoardFocus(sizes, { lane: 0, row: 1 }, "End"), { lane: 0, row: 2 });
	assertEquals(moveBoardFocus(sizes, { lane: 0, row: 2 }, "Home"), { lane: 0, row: 0 });
});

Deno.test("left and right skip empty lanes and keep the row where they can", () => {
	const sizes = [3, 0, 2, 1];
	assertEquals(moveBoardFocus(sizes, { lane: 0, row: 2 }, "ArrowRight"), { lane: 2, row: 1 });
	assertEquals(moveBoardFocus(sizes, { lane: 2, row: 1 }, "ArrowRight"), { lane: 3, row: 0 });
	assertEquals(moveBoardFocus(sizes, { lane: 3, row: 0 }, "ArrowRight"), { lane: 3, row: 0 });
	assertEquals(moveBoardFocus(sizes, { lane: 2, row: 0 }, "ArrowLeft"), { lane: 0, row: 0 });
	assertEquals(moveBoardFocus(sizes, { lane: 0, row: 0 }, "Tab"), null);
});

Deno.test("the tab stop is the chosen buyer's row, else the first row on the board", () => {
	const lanes = boardLanes(busy());
	const first = lanes.findIndex((l) => l.clients.length > 0);
	assertEquals(rovingStop(lanes), { lane: first, row: 0 });
	const active = lanes.findIndex((l) => l.lane === "active");
	const chosen = lanes[active].clients[0].client.handle;
	assertEquals(rovingStop(lanes, chosen), { lane: active, row: 0 });
	assertEquals(rovingStop(lanes, "@nobody_here"), { lane: first, row: 0 });
	assertEquals(
		rovingStop(boardLanes({ clients: [], counts: busy().counts, hasMore: false })),
		null,
	);
});
// #endregion

// #region Drawer
Deno.test("closing returns focus to the buyer's row, else the first row, else the canvas", () => {
	const rows = [clientRowId("@ada_lin"), clientRowId("@kofi_mensah")];
	assertEquals(closeFocusTarget("@kofi_mensah", rows, "canvas"), "cat-cl-row-kofi_mensah");
	assertEquals(closeFocusTarget("@gone_away", rows, "canvas"), "cat-cl-row-ada_lin");
	assertEquals(closeFocusTarget(undefined, rows, "canvas"), "cat-cl-row-ada_lin");
	assertEquals(closeFocusTarget("@ada_lin", [], "canvas"), "canvas");
});

Deno.test("the console's panel is the drawer only on the clients view with a buyer", () => {
	const base = { ...CONSOLE_DEFAULTS };
	assertEquals(consolePanelOf({ ...base, view: "clients", client: "@ada_lin" }), "client");
	assertEquals(consolePanelOf({ ...base, view: "clients" }), null);
	assertEquals(consolePanelOf({ ...base, view: "listings", client: "@ada_lin" }), null);
	assertEquals(consolePanelOf({ ...base, view: "analytics", client: "@ada_lin" }), null);
});

Deno.test("the workspace's panel is the drawer whenever a buyer is chosen, except on Preview", () => {
	const base = { ...WORKSPACE_DEFAULTS };
	assertEquals(workspacePanelOf({ ...base, tab: "clients", client: "@ada_lin" }), "client");
	assertEquals(workspacePanelOf({ ...base, tab: "clients" }), null);
	assertEquals(workspacePanelOf({ ...base, tab: "preview", client: "@ada_lin" }), null);
});

Deno.test("the drawer reads one buyer in the board's scope, the @ dropped in the path", () => {
	assertEquals(
		clientDetailPath("@ada_lin", { listing: "svc-brand01" }),
		"/api/catalogue/clients/ada_lin?listing=svc-brand01",
	);
	assertEquals(
		clientDetailPath("@ada_lin", { filter: "model:session" }, "busy"),
		"/api/catalogue/clients/ada_lin?scope=model%3Asession&sim=busy",
	);
	assertEquals(clientPipelinePath({ filter: "all" }), "/api/catalogue/clients");
});
// #endregion

// #region Scheduling
Deno.test("a buyer's proposed time is the seller's to accept, through the calendar's own gate", () => {
	const noor = fixtureClient("@noor_haddad", { filter: "all" }, "busy", "GBP", NOW);
	const round = noor?.reschedules[0];
	if (!round) throw new Error("Noor has an open round");
	const negotiation = round.event.reschedule;
	if (!negotiation) throw new Error("the round travels on its event");
	assertEquals(negotiation.mode, "counterparty");
	const isHost = round.event.viewerIsHost === true;
	assertEquals(
		counterpartyAcceptRefusal(NOW, negotiation.status, negotiation.proposals[0], isHost),
		null,
	);
});
// #endregion
