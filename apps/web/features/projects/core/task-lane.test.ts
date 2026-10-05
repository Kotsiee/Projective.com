import { assert, assertEquals } from "@std/assert";
import {
	ALL_TASK_LISTS,
	buildTaskLane,
	filterTaskItems,
	taskLaneProgress,
	visibleTaskLists,
} from "./task-lane.ts";
import type {
	BoardCard,
	BoardPage,
	BoardStageRef,
	ProjectDetail,
	ProjectParty,
	TicketTask,
} from "../types/projects-types.ts";

/**
 * The Task lane states facts a reader acts on — when the Task is due, what is left to do, who is doing
 * it — and none of them fails loudly when wrong. A due date read from the wrong field, a task list
 * built from a cancelled ticket, a board link offered to a freelancer the Tasks tab withholds: each
 * renders a plausible lane. These pin the rules instead.
 */

// #region Fixtures
const JUNO: ProjectParty = { name: "Juno Park", handle: "juno", avatar: null };

function task(id: string, done: boolean): TicketTask {
	return { id, text: `Step ${id}`, done, completedBy: [] };
}

function stageRef(over: Partial<BoardStageRef> = {}): BoardStageRef {
	return {
		id: "row-1",
		slug: "stg-aaaaaaaaaa",
		name: "Delivery",
		order: 0,
		status: "active",
		endAt: "2026-10-02T00:00:00.000Z",
		...over,
	} as unknown as BoardStageRef;
}

function card(over: Partial<BoardCard> = {}): BoardCard {
	return {
		id: "t1",
		slug: "tkt-aaaaaaaaaa",
		title: "Launch teardown",
		status: "in_progress",
		stageId: "row-1",
		assignee: JUNO,
		frozen: false,
		dueDate: "2026-09-30T00:00:00.000Z",
		dueLabel: "Sep 30",
		tasks: [task("a", true), task("b", false)],
		stages: [{ stageId: "row-1", name: "Delivery", order: 0, tasks: [task("c", false)] }],
		...over,
	} as unknown as BoardCard;
}

function board(over: Partial<BoardPage> = {}): BoardPage {
	return {
		viewerIsClient: true,
		viewerStageIds: [],
		stages: [stageRef()],
		cards: [card()],
		...over,
	} as unknown as BoardPage;
}

function detail(over: Partial<ProjectDetail> = {}): ProjectDetail {
	return {
		slug: "prj-abcdefghij",
		format: "one_off",
		structure: "single_task",
		viewerIsClient: true,
		channels: { general: [], stages: [], teams: [], dms: [] },
		...over,
	} as unknown as ProjectDetail;
}
// #endregion

// #region The lane
Deno.test("the ticket's own due date wins over the stage's scheduled end", () => {
	const lane = buildTaskLane(detail(), board());
	assertEquals(lane.dueAt, "2026-09-30T00:00:00.000Z");
	assertEquals(lane.dueLabel, "Sep 30");
});

Deno.test("an undated ticket falls back to the stage's end, and with neither the lane says none", () => {
	const staged = buildTaskLane(
		detail(),
		board({ cards: [card({ dueDate: null, dueLabel: null })] }),
	);
	assertEquals(staged.dueAt, "2026-10-02T00:00:00.000Z");
	assert(staged.dueLabel?.startsWith("Oct 2"));

	const none = buildTaskLane(
		detail(),
		board({
			stages: [stageRef({ endAt: null })],
			cards: [card({ dueDate: null, dueLabel: null })],
		}),
	);
	assertEquals(none.dueAt, null);
	assertEquals(none.dueLabel, null);
});

Deno.test("the lists are the ticket's checklist first, then each stage's steps, empties omitted", () => {
	const lane = buildTaskLane(detail(), board());
	assertEquals(lane.lists.map((l) => [l.key, l.label, l.done, l.total]), [
		["ticket", "Checklist", 1, 2],
		["stage:row-1", "Delivery", 0, 1],
	]);

	const bare = buildTaskLane(detail(), board({ cards: [card({ tasks: [], stages: [] })] }));
	assertEquals(bare.lists, []);
});

Deno.test("a frozen report or a cancelled ticket is never read as the Task", () => {
	const frozen = card({ id: "f", title: "Frozen", frozen: true });
	const cancelled = card({ id: "c", title: "Cancelled", status: "cancelled" });
	const live = card({ id: "l", title: "The real one" });
	const lane = buildTaskLane(detail(), board({ cards: [frozen, cancelled, live] }));
	assertEquals(lane.ticket?.title, "The real one");
	assertEquals(lane.ticket?.statusLabel, "In progress");

	assertEquals(buildTaskLane(detail(), board({ cards: [frozen, cancelled] })).ticket, null);
});

Deno.test("the task board is offered to the client and to a seated provider — not to anyone else", () => {
	const href = "/projects/prj-abcdefghij/discussion/tasks";
	assertEquals(buildTaskLane(detail(), board()).boardHref, href);
	assertEquals(
		buildTaskLane(detail(), board({ viewerIsClient: false, viewerStageIds: ["row-1"] })).boardHref,
		href,
	);
	assertEquals(
		buildTaskLane(detail(), board({ viewerIsClient: false, viewerStageIds: [] })).boardHref,
		null,
	);
});

Deno.test("with no board the lane is empty but still knows where the board is", () => {
	// The unsaved-form case: a pipeline switched to Task before saving has no Task board read behind it.
	const withRoom = detail({
		channels: {
			general: [],
			stages: [{ slug: "stg-bbbbbbbbbb", order: 0 }],
			teams: [],
			dms: [],
		},
	} as unknown as Partial<ProjectDetail>);
	const lane = buildTaskLane(withRoom, null);
	assertEquals(lane.ticket, null);
	assertEquals(lane.lists, []);
	assertEquals(lane.boardHref, "/projects/prj-abcdefghij/discussion/tasks");
	assertEquals(buildTaskLane(detail({ viewerIsClient: false }), null).boardHref, null);
});
// #endregion

// #region Switching and filtering
Deno.test("the switcher shows the list it names, and every list for All or a key that has gone", () => {
	const lists = buildTaskLane(detail(), board()).lists;
	assertEquals(visibleTaskLists(lists, "ticket").map((l) => l.key), ["ticket"]);
	assertEquals(visibleTaskLists(lists, ALL_TASK_LISTS).length, 2);
	assertEquals(
		visibleTaskLists(lists, "stage:gone").length,
		2,
		"a stale key never blanks the section",
	);
});

Deno.test("the quick filter narrows to what is still open, and off shows everything", () => {
	const items = [task("a", true), task("b", false)];
	assertEquals(filterTaskItems(items, true).map((i) => i.id), ["b"]);
	assertEquals(filterTaskItems(items, false).map((i) => i.id), ["a", "b"]);
});

Deno.test("progress totals every list", () => {
	assertEquals(taskLaneProgress(buildTaskLane(detail(), board()).lists), { done: 1, total: 3 });
});
// #endregion
