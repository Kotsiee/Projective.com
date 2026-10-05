import { assert, assertEquals, assertNotStrictEquals, assertStrictEquals } from "@std/assert";
import {
	type BoardCard,
	BoardCardSchema,
	type BoardColumn,
	type BoardStageRef,
	buildBoardColumns,
	COMPLETED_COLUMN_ID,
	NEW_COLUMN_ID,
	type ProjectStatus,
	stageColumnId,
	statusColumnId,
	type TicketPriority,
	type TicketStatus,
} from "@projective/types/projects";
import {
	assigneeOptions,
	boardCardColumn,
	classifyMove,
	filterCards,
	priorityLabel,
	priorityTone,
	sortCards,
	statusLabel,
	statusTone,
} from "./board-model.ts";

/**
 * The board's pure model, pinned. Two of its answers carry money: the column a card is drawn in, and
 * the class of a drop (`free` · `claimed` · `revision`), which picks the warning modal that stands
 * between a client and a stage charge or an escrow release. A wrong answer in either renders a
 * perfectly plausible board — so these state the rules instead of trusting the picture.
 *
 * The module holds no index/position maths: manual order is the backend's `sortOrder`, and an empty
 * sort key hands that order back untouched (pinned below).
 */

// #region Fixtures
const ALL_STATUSES: TicketStatus[] = [
	"backlog",
	"todo",
	"claimed",
	"in_progress",
	"in_review",
	"completed",
	"cancelled",
	"reported_hidden",
];

function card(over: Partial<BoardCard> = {}): BoardCard {
	return BoardCardSchema.parse({
		id: "tkt-1",
		title: "Ship the icon set",
		description: null,
		hasDescription: false,
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
		updatedAt: "2026-10-01T00:00:00.000Z",
		dateLabel: "Oct 1",
		sortOrder: 0,
		...over,
	});
}

function stage(id: string, status: ProjectStatus, order: number): BoardStageRef {
	return {
		id,
		slug: `stg-${id}`,
		name: `Stage ${id}`,
		order,
		status,
		locked: false,
		description: "",
		unitPriceCents: 10_000,
		categoryWeight: 1,
		members: [],
		ticketCount: 0,
		assignmentMode: "open_pull",
		maxConcurrentIntensity: null,
		startAt: null,
		endAt: null,
		dependsOnStageId: null,
	};
}

/** A pipeline whose first stage is already finished — the only place a drop re-opens work. */
const STAGES = [stage("a", "completed", 0), stage("b", "active", 1), stage("c", "draft", 2)];
const PIPELINE: BoardColumn[] = buildBoardColumns(STAGES, "stages", "project");
const STATUS_LANES: BoardColumn[] = buildBoardColumns(STAGES, "statuses", "project");
const STAGE_BOARD: BoardColumn[] = buildBoardColumns([], "stages", "stage");
// #endregion

// #region Column derivation
Deno.test("the pipeline is New, every stage in order, then Completed", () => {
	assertEquals(PIPELINE.map((c) => c.id), [
		NEW_COLUMN_ID,
		stageColumnId("a"),
		stageColumnId("b"),
		stageColumnId("c"),
		COMPLETED_COLUMN_ID,
	]);
	assertEquals(PIPELINE.map((c) => c.order), [0, 1, 2, 3, 4]);
});

Deno.test("an engagement with no stages still has both bookends, and nothing between", () => {
	const empty = buildBoardColumns([], "stages", "project");
	assertEquals(empty.map((c) => c.id), [NEW_COLUMN_ID, COMPLETED_COLUMN_ID]);
});

Deno.test("the Statuses view and a stage board both draw the five frozen status lanes", () => {
	const lanes = ["backlog", "todo", "in_progress", "in_review", "completed"].map((s) =>
		statusColumnId(s as "backlog")
	);
	assertEquals(STATUS_LANES.map((c) => c.id), lanes);
	assertEquals(STAGE_BOARD.map((c) => c.id), lanes);
});
// #endregion

// #region Placement
Deno.test("on the pipeline a done card sits in Completed whatever stage it was routed to", () => {
	assertEquals(
		boardCardColumn(card({ status: "completed", stageId: "b" }), "stages", "project"),
		COMPLETED_COLUMN_ID,
	);
});

Deno.test("on the pipeline a routed card sits in its stage, an unrouted one in New", () => {
	for (const status of ALL_STATUSES.filter((s) => s !== "completed")) {
		assertEquals(
			boardCardColumn(card({ status, stageId: "b" }), "stages", "project"),
			stageColumnId("b"),
			status,
		);
		assertEquals(
			boardCardColumn(card({ status, stageId: null }), "stages", "project"),
			NEW_COLUMN_ID,
			status,
		);
	}
});

Deno.test("every status lands in a lane that exists, on both status boards", () => {
	const expected: Record<TicketStatus, string> = {
		backlog: statusColumnId("backlog"),
		todo: statusColumnId("todo"),
		// There is no Claimed column on the product board (PRODUCT_MANAGEMENT §6, Decision #35).
		claimed: statusColumnId("in_progress"),
		in_progress: statusColumnId("in_progress"),
		in_review: statusColumnId("in_review"),
		completed: statusColumnId("completed"),
		// Overlays, never columns: they stay drawn in the backlog lane.
		cancelled: statusColumnId("backlog"),
		reported_hidden: statusColumnId("backlog"),
	};
	for (const status of ALL_STATUSES) {
		const c = card({ status, stageId: "b" });
		for (
			const [view, kind, cols] of [
				["statuses", "project", STATUS_LANES],
				["stages", "stage", STAGE_BOARD],
			] as const
		) {
			const id = boardCardColumn(c, view, kind);
			assertEquals(id, expected[status], `${status} on ${view}/${kind}`);
			assert(cols.some((col) => col.id === id), `${id} is a drawn column`);
		}
	}
});
// #endregion

// #region Move classification
const claimed = card({ claimed: true, escrowHeld: true, status: "claimed", stageId: "b" });
const free = card({ claimed: false, status: "todo", stageId: "b" });

Deno.test("a drop back into the column it came from is free, whatever the card or column", () => {
	for (const c of [claimed, free]) {
		for (const col of PIPELINE) {
			assertEquals(classifyMove(c, col.id, col.id, PIPELINE), "free", col.id);
		}
	}
});

Deno.test("a drop into an already-completed stage re-opens it as a revision, claimed or not", () => {
	const into = stageColumnId("a");
	assertEquals(classifyMove(free, NEW_COLUMN_ID, into, PIPELINE), "revision");
	// Revision outranks the claimed charge: the stage re-opens before anything is paid out.
	assertEquals(classifyMove(claimed, stageColumnId("b"), into, PIPELINE), "revision");
});

Deno.test("a claimed card crossing into another live stage incurs the stage charge", () => {
	assertEquals(classifyMove(claimed, stageColumnId("b"), stageColumnId("c"), PIPELINE), "claimed");
});

Deno.test("moving to the end: a claimed card into Completed releases escrow; an unclaimed one is free", () => {
	assertEquals(classifyMove(claimed, stageColumnId("b"), COMPLETED_COLUMN_ID, PIPELINE), "claimed");
	assertEquals(classifyMove(free, stageColumnId("b"), COMPLETED_COLUMN_ID, PIPELINE), "free");
	const done = statusColumnId("completed");
	assertEquals(classifyMove(claimed, statusColumnId("in_review"), done, STAGE_BOARD), "claimed");
	assertEquals(classifyMove(free, statusColumnId("in_review"), done, STAGE_BOARD), "free");
});

Deno.test("ordinary status progression inside a stage carries no charge, even when claimed", () => {
	const lanes = STAGE_BOARD.filter((c) => c.status !== "completed");
	for (const from of lanes) {
		for (const to of lanes) {
			assertEquals(
				classifyMove(claimed, from.id, to.id, STAGE_BOARD),
				"free",
				`${from.id}→${to.id}`,
			);
		}
	}
});

Deno.test("an unclaimed card moves between live stages freely", () => {
	assertEquals(classifyMove(free, NEW_COLUMN_ID, stageColumnId("b"), PIPELINE), "free");
	assertEquals(classifyMove(free, stageColumnId("b"), stageColumnId("c"), PIPELINE), "free");
});

Deno.test("a claimed card dragged back to New is classified free", () => {
	assertEquals(classifyMove(claimed, stageColumnId("b"), NEW_COLUMN_ID, PIPELINE), "free");
});

Deno.test("an unknown destination column is classified free (no warning modal)", () => {
	assertEquals(classifyMove(claimed, stageColumnId("b"), "stage-gone", PIPELINE), "free");
	assertEquals(classifyMove(claimed, stageColumnId("b"), COMPLETED_COLUMN_ID, []), "free");
});
// #endregion

// #region Labels + tones
Deno.test("status labels carry the product relabels (New = backlog, Ready = todo)", () => {
	const labels = Object.fromEntries(ALL_STATUSES.map((s) => [s, statusLabel(s)]));
	assertEquals(labels, {
		backlog: "New",
		todo: "Ready",
		claimed: "Claimed",
		in_progress: "In Progress",
		in_review: "Review",
		completed: "Completed",
		cancelled: "Cancelled",
		reported_hidden: "Frozen",
	});
});

Deno.test("every status has a tone, and only backlog falls through to neutral", () => {
	const tones = Object.fromEntries(ALL_STATUSES.map((s) => [s, statusTone(s)]));
	assertEquals(tones, {
		backlog: "neutral",
		todo: "info",
		claimed: "progress",
		in_progress: "progress",
		in_review: "review",
		completed: "success",
		cancelled: "muted",
		reported_hidden: "warning",
	});
});

Deno.test("priority labels and tones", () => {
	const ps: TicketPriority[] = ["urgent", "high", "normal", "low"];
	assertEquals(ps.map(priorityLabel), ["Urgent", "High", "Normal", "Low"]);
	assertEquals(ps.map(priorityTone), ["danger", "warning", "neutral", "muted"]);
});
// #endregion

// #region Filter
const JUNO = { name: "Juno Park", handle: "juno", avatar: null };
const ARI = { name: "Ari Vance", handle: null, avatar: null };

const DECK = [
	card({ id: "1", title: "Polish the Checkout flow", priority: "urgent", assignee: JUNO }),
	card({ id: "2", title: "Ship the icon set", priority: "low", assignee: ARI }),
	card({ id: "3", title: "Refine the motion pass", priority: "high", assignee: null }),
];

Deno.test("an empty column filters and sorts to an empty column", () => {
	assertEquals(filterCards([], { query: "x", priorities: ["high"], assignees: ["juno"] }), []);
	assertEquals(sortCards([], "priority", "asc"), []);
});

Deno.test("no filters keep every card", () => {
	assertEquals(filterCards(DECK, { query: "  ", priorities: [], assignees: [] }).length, 3);
});

Deno.test("the search is trimmed, case-insensitive and title-only", () => {
	const ids = (q: string) =>
		filterCards(DECK, { query: q, priorities: [], assignees: [] }).map((c) => c.id);
	assertEquals(ids("  CHECKOUT "), ["1"]);
	assertEquals(ids("the"), ["1", "2", "3"]);
	assertEquals(ids("nothing like it"), []);
});

Deno.test("priority and assignee filters intersect", () => {
	const ids = (priorities: string[], assignees: string[]) =>
		filterCards(DECK, { query: "", priorities, assignees }).map((c) => c.id);
	assertEquals(ids(["urgent", "high"], []), ["1", "3"]);
	// A handle-less assignee is matched by name; an unassigned card never matches an assignee filter.
	assertEquals(ids([], ["juno", "Ari Vance"]), ["1", "2"]);
	assertEquals(ids(["urgent", "high"], ["juno"]), ["1"]);
	assertEquals(ids(["low"], ["juno"]), []);
});

Deno.test("assignee options de-duplicate by handle, then by name for the handle-less", () => {
	const opts = assigneeOptions([JUNO, { ...JUNO, name: "Juno P." }, ARI, ARI]);
	assertEquals(opts, [
		{ value: "juno", label: "Juno Park" },
		{ value: "Ari Vance", label: "Ari Vance" },
	]);
	assertEquals(assigneeOptions([]), []);
});
// #endregion

// #region Sort
const SORTABLE = [
	card({ id: "a", title: "beta", priority: "low", updatedAt: "2026-10-02T00:00:00.000Z" }),
	card({ id: "b", title: "Alpha", priority: "urgent", updatedAt: "2026-10-01T00:00:00.000Z" }),
	card({ id: "c", title: "gamma", priority: "normal", updatedAt: "2026-10-03T00:00:00.000Z" }),
	card({ id: "d", title: "delta", priority: "normal", updatedAt: "2026-09-30T00:00:00.000Z" }),
];
const order = (cards: BoardCard[]) => cards.map((c) => c.id);

Deno.test("an empty sort key keeps the backend's manual order (the same array)", () => {
	assertStrictEquals(sortCards(SORTABLE, "", "desc"), SORTABLE);
});

Deno.test("a keyed sort returns a new array and leaves the input in manual order", () => {
	const sorted = sortCards(SORTABLE, "title", "asc");
	assertNotStrictEquals(sorted, SORTABLE);
	assertEquals(order(SORTABLE), ["a", "b", "c", "d"]);
});

Deno.test("priority sorts urgent-first ascending, and ties keep manual order", () => {
	assertEquals(order(sortCards(SORTABLE, "priority", "asc")), ["b", "c", "d", "a"]);
	assertEquals(order(sortCards(SORTABLE, "priority", "desc")), ["a", "c", "d", "b"]);
});

Deno.test("title sorts by locale compare, both directions", () => {
	assertEquals(order(sortCards(SORTABLE, "title", "asc")), ["b", "a", "d", "c"]);
	assertEquals(order(sortCards(SORTABLE, "title", "desc")), ["c", "d", "a", "b"]);
});

Deno.test("any other key sorts by last update", () => {
	assertEquals(order(sortCards(SORTABLE, "updated", "desc")), ["c", "a", "b", "d"]);
	assertEquals(order(sortCards(SORTABLE, "updated", "asc")), ["d", "b", "a", "c"]);
});

Deno.test("a single-card column sorts to itself", () => {
	assertEquals(order(sortCards([SORTABLE[0]], "priority", "desc")), ["a"]);
});
// #endregion
