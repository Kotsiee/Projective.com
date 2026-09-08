import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	type BoardCard,
	BoardCardSchema,
	type BoardPage,
	BoardPageSchema,
	type BoardStageRef,
	BoardStageRefSchema,
	type TicketStageRef,
} from "./board.ts";
import {
	buildProjectTimeline,
	buildTicketTimeline,
	stageAccentFor,
	ticketAccentFor,
	TimelinePageSchema,
} from "./timeline.ts";

/*
 * Every rule below is a CLAIM the timeline makes about a plan — "this stage runs from here to
 * there", "this ticket is overdue", "these two start together" — and the failure mode of a wrong
 * claim is a confident, plausible bar rather than a broken layout. So the builders are pinned
 * directly, with a hand-built board rather than the fixtures, because a fixture corpus that
 * happened to contain no undated ticket would let the "drawn nowhere" rule rot unnoticed.
 */

const NOW = Date.parse("2026-07-17T16:20:00Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW + days * DAY).toISOString();

function stage(over: Partial<BoardStageRef> & { id: string; order: number }): BoardStageRef {
	return BoardStageRefSchema.parse({
		// A well-formed `stg-…` address derived from the id, so a factory-built stage is routable in
		// exactly the way a real one is.
		slug: `stg-${`${over.id}`.replace(/[^a-z0-9]/g, "").padEnd(10, "x").slice(0, 10)}`,
		name: `Stage ${over.order + 1}`,
		status: "active",
		locked: false,
		description: "",
		unitPriceCents: 10_000,
		categoryWeight: 1,
		members: [],
		ticketCount: 0,
		assignmentMode: "open_pull",
		maxConcurrentIntensity: null,
		...over,
	});
}

function card(over: Partial<BoardCard> & { id: string }): BoardCard {
	return BoardCardSchema.parse({
		title: `Ticket ${over.id}`,
		description: "A brief.",
		hasDescription: true,
		status: "todo",
		stageId: null,
		assignee: null,
		claimed: false,
		escrowHeld: false,
		priority: "normal",
		intensity: "standard",
		workload: 1,
		dueDate: null,
		dueLabel: null,
		budgetCents: null,
		budgetLabel: null,
		frozen: false,
		commentCount: 0,
		attachmentCount: 0,
		checklistDone: 0,
		checklistTotal: 0,
		stages: [],
		updatedAt: at(0),
		dateLabel: "Jul 17",
		sortOrder: 0,
		...over,
	});
}

function ref(
	stageId: string,
	name: string,
	order: number,
	status: TicketStageRef["status"],
	parallel = false,
): TicketStageRef {
	return {
		stageId,
		name,
		order,
		status,
		required: true,
		brief: "",
		intensity: "standard",
		tasks: [],
		parallel,
		costCents: null,
		unitPriceCents: null,
	};
}

function board(
	over: Partial<BoardPage> & { stages: BoardStageRef[]; cards: BoardCard[] },
): BoardPage {
	return BoardPageSchema.parse({
		scope: "project",
		kind: "project",
		projectId: "prj-test000001",
		channelId: null,
		format: "pipeline",
		title: "Pipeline",
		view: "stages",
		viewerIsClient: true,
		columns: [],
		assignees: [],
		viewerId: "viewer",
		total: over.cards.length,
		...over,
	});
}

// #region Project scope
Deno.test("project scope: a scheduled stage is a bar, an unscheduled one is an empty lane", () => {
	const page = buildProjectTimeline(
		board({
			stages: [
				stage({ id: "s1", order: 0, startAt: at(-10), endAt: at(-2) }),
				stage({ id: "s2", order: 1 }),
			],
			cards: [],
		}),
		{ nowMs: NOW },
	);
	assertEquals(page.lanes.map((l) => l.id), ["stage:s1", "stage:s2", "backlog"]);
	const bars = page.items.filter((i) => i.subject === "stage");
	assertEquals(bars.length, 1, "only the dated stage is drawn");
	assertEquals(bars[0].kind, "bar");
	assertEquals(bars[0].laneId, "stage:s1");
	assertEquals(page.items.filter((i) => i.laneId === "stage:s2").length, 0);
	// The page parses against its own schema — the builder cannot emit a shape the wire refuses.
	TimelinePageSchema.parse(page);
});

Deno.test("project scope: a stage with only one date is a milestone named for which date it is", () => {
	const page = buildProjectTimeline(
		board({
			stages: [
				stage({ id: "s1", order: 0, name: "Research", endAt: at(3) }),
				stage({ id: "s2", order: 1, name: "Build", startAt: at(5) }),
			],
			cards: [],
		}),
		{ nowMs: NOW },
	);
	const [due, starts] = page.items;
	assertEquals(due.kind, "milestone");
	assertEquals(due.label, "Research due");
	assertEquals(due.start, due.end);
	assertEquals(starts.kind, "milestone");
	assertEquals(starts.label, "Build starts");
});

Deno.test("project scope: a stage dependency becomes a link only when the predecessor is drawn", () => {
	const page = buildProjectTimeline(
		board({
			stages: [
				stage({ id: "s1", order: 0, startAt: at(0), endAt: at(4) }),
				stage({ id: "s2", order: 1, startAt: at(4), endAt: at(8), dependsOnStageId: "s1" }),
				// Depends on a stage that has no window, so there is nothing to draw a link TO.
				stage({ id: "s3", order: 2, startAt: at(8), endAt: at(9), dependsOnStageId: "s4" }),
				stage({ id: "s4", order: 3 }),
			],
			cards: [],
		}),
		{ nowMs: NOW },
	);
	const byId = new Map(page.items.map((i) => [i.id, i]));
	assertEquals(byId.get("stage-item:s2")?.dependsOn, ["stage-item:s1"]);
	assertEquals(byId.get("stage-item:s3")?.dependsOn, []);
});

Deno.test("project scope: a ticket's item follows its dates, and an undated one is counted, not drawn", () => {
	const page = buildProjectTimeline(
		board({
			stages: [stage({ id: "s1", order: 0 })],
			cards: [
				card({
					id: "t-span",
					stageId: "s1",
					status: "in_progress",
					claimedAt: at(-3),
					dueDate: at(2),
				}),
				card({ id: "t-due", stageId: "s1", dueDate: at(4) }),
				card({ id: "t-claim", stageId: "s1", status: "claimed", claimedAt: at(-1) }),
				card({ id: "t-none", stageId: "s1" }),
				card({ id: "t-backlog", stageId: null, dueDate: at(6) }),
			],
		}),
		{ nowMs: NOW },
	);
	const byId = new Map(page.items.map((i) => [i.id, i]));
	assertEquals(byId.get("ticket-item:t-span")?.kind, "bar");
	assertEquals(byId.get("ticket-item:t-due")?.kind, "milestone");
	assertEquals(byId.get("ticket-item:t-claim")?.kind, "milestone");
	assertEquals(
		byId.get("ticket-item:t-claim")?.start,
		at(-1),
		"a claim-only ticket sits at its claim",
	);
	assertFalse(byId.has("ticket-item:t-none"), "an undated ticket is drawn nowhere");
	assertEquals(page.undatedCount, 1);
	assertEquals(byId.get("ticket-item:t-backlog")?.laneId, "backlog");
	const lane = page.lanes.find((l) => l.id === "stage:s1");
	assertEquals(lane?.meta, "4 tickets · 1 undated");
});

Deno.test("a due date before the claim collapses to the deadline milestone, never a negative span", () => {
	const page = buildProjectTimeline(
		board({
			stages: [stage({ id: "s1", order: 0 })],
			cards: [
				card({ id: "t", stageId: "s1", status: "in_progress", claimedAt: at(2), dueDate: at(-1) }),
			],
		}),
		{ nowMs: NOW },
	);
	const item = page.items[0];
	assertEquals(item.kind, "milestone");
	assertEquals(item.start, at(-1));
	assertEquals(item.end, item.start);
});

Deno.test("overdue is derived from the instant given, and never claimed of finished work", () => {
	const page = buildProjectTimeline(
		board({
			stages: [
				stage({ id: "late", order: 0, startAt: at(-9), endAt: at(-1) }),
				stage({ id: "done", order: 1, status: "completed", startAt: at(-9), endAt: at(-1) }),
			],
			cards: [
				card({ id: "t-late", stageId: "late", dueDate: at(-1) }),
				card({
					id: "t-done",
					stageId: "done",
					status: "completed",
					claimedAt: at(-5),
					dueDate: at(-1),
				}),
			],
		}),
		{ nowMs: NOW },
	);
	const byId = new Map(page.items.map((i) => [i.id, i]));
	assertEquals(byId.get("stage-item:late")?.status, "Overdue");
	assertEquals(byId.get("stage-item:late")?.accent, "--warning");
	assertEquals(byId.get("stage-item:done")?.status, "Completed");
	assertEquals(byId.get("ticket-item:t-late")?.status, "Overdue");
	assertEquals(byId.get("ticket-item:t-done")?.status, "Completed");
	// The same board an hour earlier is not overdue yet.
	const earlier = buildProjectTimeline(
		board({ stages: [stage({ id: "late", order: 0, startAt: at(-9), endAt: at(-1) })], cards: [] }),
		{ nowMs: NOW - 2 * DAY },
	);
	assertEquals(earlier.items[0].status, "Active");
});

Deno.test("stage progress is completed tickets over all, and null for a stage with none", () => {
	const page = buildProjectTimeline(
		board({
			stages: [
				stage({ id: "s1", order: 0, startAt: at(0), endAt: at(4) }),
				stage({ id: "s2", order: 1, startAt: at(0), endAt: at(4) }),
			],
			cards: [
				card({ id: "a", stageId: "s1", status: "completed" }),
				card({ id: "b", stageId: "s1", status: "in_progress" }),
				card({ id: "c", stageId: "s1", status: "cancelled" }),
				card({ id: "d", stageId: "s1", status: "todo" }),
			],
		}),
		{ nowMs: NOW },
	);
	const byId = new Map(page.items.map((i) => [i.id, i]));
	assertEquals(
		byId.get("stage-item:s1")?.progress,
		1 / 3,
		"cancelled tickets are not in the denominator",
	);
	assertEquals(byId.get("stage-item:s2")?.progress, null);
});

Deno.test("only a client may move a ticket, and a claim milestone is never movable", () => {
	const make = (viewerIsClient: boolean) =>
		buildProjectTimeline(
			board({
				viewerIsClient,
				stages: [stage({ id: "s1", order: 0 })],
				cards: [
					card({ id: "due", stageId: "s1", dueDate: at(1) }),
					card({ id: "claim", stageId: "s1", status: "claimed", claimedAt: at(-1) }),
				],
			}),
			{ nowMs: NOW },
		);
	const client = new Map(make(true).items.map((i) => [i.id, i]));
	assertEquals(client.get("ticket-item:due")?.movable, true);
	assertEquals(client.get("ticket-item:claim")?.movable, false);
	const freelancer = make(false);
	assert(freelancer.items.every((i) => !i.movable));
	assert(freelancer.lanes.every((l) => !l.creatable));
	assert(make(true).lanes.every((l) => l.creatable));
});

Deno.test("the range spans every drawn item and is null when nothing is dated", () => {
	const page = buildProjectTimeline(
		board({
			stages: [stage({ id: "s1", order: 0, startAt: at(-3), endAt: at(2) })],
			cards: [card({ id: "t", stageId: "s1", dueDate: at(9) })],
		}),
		{ nowMs: NOW },
	);
	assertEquals(page.range, { start: at(-3), end: at(9) });
	const empty = buildProjectTimeline(
		board({ stages: [stage({ id: "s1", order: 0 })], cards: [card({ id: "t", stageId: "s1" })] }),
		{ nowMs: NOW },
	);
	assertEquals(empty.range, null);
});
// #endregion

// #region Channel scope
Deno.test("channel scope: the stage leads, then one lane per ticket carrying the assignee", () => {
	const page = buildProjectTimeline(
		board({
			scope: "channel",
			kind: "stage",
			channelId: "s1",
			stages: [
				stage({ id: "s1", order: 0, name: "Design", startAt: at(-2), endAt: at(5) }),
				stage({ id: "s2", order: 1 }),
			],
			cards: [
				card({
					id: "b",
					stageId: "s1",
					sortOrder: 1,
					dueDate: at(3),
					assignee: { name: "Ivy Chen", avatar: null, handle: "ivy" },
				}),
				card({ id: "a", stageId: "s1", sortOrder: 0 }),
			],
		}),
		{ nowMs: NOW },
	);
	assertEquals(page.title, "Stage timeline");
	assertEquals(page.lanes.map((l) => l.id), ["stage:s1", "ticket:a", "ticket:b"]);
	assertEquals(page.lanes[0].kind, "stage");
	assertEquals(page.lanes[2].avatar?.name, "Ivy Chen");
	assertEquals(page.lanes[2].depth, 1);
	assertEquals(page.lanes[1].meta, "Undated");
	assertEquals(page.items.map((i) => i.laneId), ["stage:s1", "ticket:b"]);
	assertEquals(page.undatedCount, 1);
});

Deno.test("channel scope: with no cards there is no stage lane, because none can be identified", () => {
	const page = buildProjectTimeline(
		board({
			scope: "channel",
			kind: "stage",
			channelId: "s1",
			stages: [stage({ id: "s1", order: 0, startAt: at(0), endAt: at(1) })],
			cards: [],
		}),
		{ nowMs: NOW },
	);
	assertEquals(page.lanes, []);
	assertEquals(page.items, []);
});
// #endregion

// #region Ticket timeline
Deno.test("ticket timeline: one lane per required stage, steps from the execution bands, links band to band", () => {
	const stages = [
		stage({ id: "s1", order: 0, name: "Research", startAt: at(0), endAt: at(3) }),
		stage({ id: "s2", order: 1, name: "Design", startAt: at(3), endAt: at(7) }),
		stage({ id: "s3", order: 2, name: "Build", startAt: at(3), endAt: at(9) }),
		stage({ id: "s4", order: 3, name: "QA" }),
	];
	const ticket = card({
		id: "t",
		stageId: "s1",
		status: "in_progress",
		claimedAt: at(0),
		dueDate: at(10),
		dueLabel: "Jul 27",
		stages: [
			ref("s1", "Research", 0, "active"),
			ref("s2", "Design", 1, "active"),
			ref("s3", "Build", 2, "active", true),
			ref("s4", "QA", 3, "draft"),
		],
	});
	const tl = buildTicketTimeline(ticket, stages, { nowMs: NOW });
	assertEquals(tl.lanes.map((l) => l.id), [
		"stage:s1",
		"stage:s2",
		"stage:s3",
		"stage:s4",
		"ticket:t",
	]);
	assertEquals(tl.lanes.map((l) => l.sublabel), [
		"Step 1",
		"Step 2 · together",
		"Step 2 · together",
		"Step 3",
		"In progress",
	]);
	const byId = new Map(tl.items.map((i) => [i.id, i]));
	assertEquals(byId.get("stage-item:s1")?.dependsOn, []);
	assertEquals(byId.get("stage-item:s2")?.dependsOn, ["stage-item:s1"]);
	assertEquals(byId.get("stage-item:s3")?.dependsOn, ["stage-item:s1"]);
	assertFalse(byId.has("stage-item:s4"), "an unscheduled stage keeps its lane and draws nothing");
	assertEquals(byId.get("ticket-item:t")?.kind, "bar");
	assertEquals(byId.get("ticket-item:t")?.movable, false, "the modal's run is read-only");
	assertEquals(tl.lanes[4].meta, "Due Jul 27");
	assertEquals(tl.range, { start: at(0), end: at(10) });
});

Deno.test("ticket timeline: a stage the board no longer has keeps its lane from the ticket's own record", () => {
	const ticket = card({
		id: "t",
		stages: [ref("gone", "Removed stage", 0, "cancelled")],
	});
	const tl = buildTicketTimeline(ticket, [], { nowMs: NOW });
	assertEquals(tl.lanes[0].label, "Removed stage");
	assertEquals(tl.lanes[0].meta, "Cancelled");
	assertEquals(tl.items, []);
	assertEquals(tl.range, null);
});
// #endregion

// #region Accents
Deno.test("accents are token NAMES, never colours", () => {
	const all = [
		...(["draft", "active", "on_hold", "completed", "cancelled"] as const).map(stageAccentFor),
		...(
			[
				"backlog",
				"todo",
				"claimed",
				"in_progress",
				"in_review",
				"completed",
				"cancelled",
				"reported_hidden",
			] as const
		).map(ticketAccentFor),
	];
	for (const token of all) assert(/^--[a-z-]+$/.test(token), token);
});
// #endregion
