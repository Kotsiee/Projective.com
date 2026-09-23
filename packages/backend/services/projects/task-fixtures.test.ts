import { assert, assertEquals } from "@std/assert";
import { isTaskProject } from "@projective/types/projects";
import { allProjects } from "./fixtures.ts";
import { findProjectDetail } from "./detail-fixtures.ts";
import { findBoardPage, findTicketProjectSlug } from "./board-fixtures.ts";
import { fixtureStructureOf } from "./structure-fixtures.ts";

/**
 * The stub corpus must hold the Task invariant the database enforces — `fn_enforce_structure_variation`
 * refuses a second stage or a second ticket on a `single_task` project — because the Task lane reads
 * its one ticket and its one room, and a fixture with several of each would be a Task the live path
 * could never have produced, drawn from data the lane has to choose among.
 */

const TASK_SLUG = "prj-cujw52gg3p";

Deno.test("the corpus declares its Task, and the detail and board both say so", () => {
	assertEquals(fixtureStructureOf(TASK_SLUG, "one_off"), "single_task");
	const detail = findProjectDetail(TASK_SLUG);
	assert(detail);
	assertEquals(detail.structure, "single_task");
	assert(isTaskProject(detail.format, detail.structure));

	const board = findBoardPage({ projectId: TASK_SLUG });
	assert(board);
	assertEquals(board.structure, "single_task");
});

Deno.test("the fixture Task has one stage, named as the create path names it, and one ticket", () => {
	const detail = findProjectDetail(TASK_SLUG);
	assert(detail);
	assertEquals(detail.channels.stages.map((s) => s.name), ["Delivery"]);

	const board = findBoardPage({ projectId: TASK_SLUG });
	assert(board);
	assertEquals(board.cards.length, 1);
	assertEquals(board.cards[0].stageId, detail.channels.stages[0].stageId);
	// The walker behind the `?tkv=` deep link reads the same cards, so the one ticket resolves and a
	// ticket the board does not contain does not.
	const slug = board.cards[0].slug;
	assert(slug);
	assertEquals(findTicketProjectSlug(slug), TASK_SLUG);
});

Deno.test("no other corpus engagement is read as a Task", () => {
	for (const row of allProjects()) {
		if (row.slug === TASK_SLUG) continue;
		const detail = findProjectDetail(row.slug);
		assert(detail, row.slug);
		assert(!isTaskProject(detail.format, detail.structure), `${row.slug} became a Task`);
	}
});
