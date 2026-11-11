import { assertEquals } from "@std/assert";
import {
	type BoardCard,
	BoardCardSchema,
	type BoardColumn,
	type BoardStageRef,
	buildBoardColumns,
	NEW_COLUMN_ID,
	statusColumnId,
} from "@projective/types/projects";
import type { MenuItem } from "@ui/types/mod.ts";
import {
	columnMenuModel,
	type TicketMenuActions,
	type TicketMenuFacts,
	ticketMenuModel,
} from "./board-menus.ts";

// #region Fixtures
function card(over: Partial<BoardCard> = {}): BoardCard {
	return BoardCardSchema.parse({
		id: "t-1",
		slug: "tkt-abcdefghjk",
		title: "Ship the icon set",
		description: "Thirty glyphs.",
		hasDescription: true,
		status: "backlog",
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

function stage(id: string, order: number): BoardStageRef {
	return {
		id,
		slug: `stg-${id}`,
		name: `Stage ${id}`,
		order,
		status: "active",
		locked: false,
		description: "",
		unitPriceCents: 10_000,
		categoryWeight: 1,
		members: [],
		ticketCount: 0,
		funding: null,
		assignmentMode: "open_pull",
		maxConcurrentIntensity: null,
		chainReaction: true,
		startAt: null,
		endAt: null,
		dependsOnStageId: null,
	};
}

const PIPELINE: BoardColumn[] = buildBoardColumns(
	[stage("a", 0), stage("b", 1)],
	"stages",
	"project",
);
const LANES: BoardColumn[] = buildBoardColumns([], "statuses", "stage");

const noop: TicketMenuActions = {
	open: () => {},
	claim: () => {},
	startWork: () => {},
	submitWork: () => {},
	fund: () => {},
	moveTo: () => {},
	copied: () => {},
	remove: () => {},
};

function facts(over: Partial<TicketMenuFacts> = {}): TicketMenuFacts {
	return {
		card: card(),
		columns: PIPELINE,
		currentColumnId: NEW_COLUMN_ID,
		isClient: true,
		isFreelancer: false,
		boardHref: "/projects/prj-abcdefghjk/board",
		canClaim: false,
		canMove: true,
		dropRefusal: () => null,
		...over,
	};
}

const keys = (rows: MenuItem[]) => rows.filter((r) => !r.separator).map((r) => r.key);
const row = (rows: MenuItem[], key: string) => rows.find((r) => r.key === key);
// #endregion

Deno.test("a client's menu on a pristine ticket: open, copy link, move, delete", () => {
	const rows = ticketMenuModel(facts(), noop);
	assertEquals(keys(rows), ["ticket-open", "ticket-copy", "ticket-move", "ticket-delete"]);
	assertEquals(row(rows, "ticket-delete")?.disabled, false);
	assertEquals(row(rows, "ticket-delete")?.danger, true);
	assertEquals(row(rows, "ticket-open")?.url, undefined);
});

Deno.test("Move to lists every other column, never the card's own", () => {
	const targets = row(ticketMenuModel(facts(), noop), "ticket-move")?.items ?? [];
	assertEquals(
		targets.map((t) => t.label),
		PIPELINE.filter((c) => c.id !== NEW_COLUMN_ID).map((c) => c.title),
	);
});

Deno.test("a locked destination stays listed, disabled with its reason", () => {
	const lock = "Escrow isn't held for this ticket here yet. Fund it before work starts.";
	const rows = ticketMenuModel(
		facts({ columns: LANES, currentColumnId: statusColumnId("todo"), dropRefusal: () => lock }),
		noop,
	);
	const target = row(rows, "ticket-move")?.items?.[0];
	assertEquals([target?.disabled, target?.disabledReason], [true, lock]);
});

Deno.test("a claimed ticket cannot be deleted: the row says why", () => {
	const rows = ticketMenuModel(facts({ card: card({ claimed: true }), canMove: false }), noop);
	assertEquals(row(rows, "ticket-delete")?.disabled, true);
	assertEquals(keys(rows).includes("ticket-move"), false);
});

Deno.test("a provider gets Claim when eligible, and never Delete or Fund", () => {
	const rows = ticketMenuModel(
		facts({ isClient: false, isFreelancer: true, canClaim: true, canMove: false }),
		noop,
	);
	assertEquals(keys(rows), ["ticket-open", "ticket-copy", "ticket-claim"]);
});

Deno.test("an unsaved card has no link to open or copy", () => {
	const rows = ticketMenuModel(facts({ card: card({ slug: undefined }) }), noop);
	assertEquals(keys(rows).slice(0, 2), ["ticket-open", "ticket-move"]);
});

Deno.test("a column offers New ticket only where the viewer may create", () => {
	const column = PIPELINE[0];
	const run = { createTicket: () => {}, addStage: () => {} };
	assertEquals(
		keys(columnMenuModel({ column, canCreate: true, canAddStage: false, stageHref: null }, run)),
		[
			"column-new-ticket",
		],
	);
	assertEquals(
		columnMenuModel({ column, canCreate: false, canAddStage: false, stageHref: null }, run),
		[],
	);
});

Deno.test("a stage column links to its channel and the client may add a stage", () => {
	const run = { createTicket: () => {}, addStage: () => {} };
	const rows = columnMenuModel(
		{ column: PIPELINE[1], canCreate: true, canAddStage: true, stageHref: "/projects/prj-a/stg-a" },
		run,
	);
	assertEquals(keys(rows), ["column-new-ticket", "column-open-stage", "column-add-stage"]);
});
