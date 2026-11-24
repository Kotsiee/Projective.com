/**
 * Manual assignment's pure rules (PROJECTS ST3, Decision #547): what review authority is offered a pin
 * on, and that a manual stage's ticket is claimable by the person it is pinned to and nobody else. The
 * doors (`assign_ticket_manual`, `claim_ticket`) enforce the same rules under
 * `supabase/probes/seat_lock_and_capacity.sql` region 4.
 */
import { assertEquals } from "@std/assert";
import {
	type BoardCard,
	isPinnable,
	isSelfClaimable,
	SetStageAssignmentModeSchema,
} from "./board.ts";

type Gate = Pick<
	BoardCard,
	"status" | "claimed" | "hasDescription" | "stageId" | "personal" | "frozen" | "pinnedToViewer"
>;

const ready: Gate = {
	status: "todo",
	claimed: false,
	hasDescription: true,
	stageId: "s1",
	personal: false,
	frozen: false,
};
const manual = { assignmentMode: "manual" as const };
const openPull = { assignmentMode: "open_pull" as const };

Deno.test("a Ready, described, unclaimed ticket on a manual stage is offered a pin", () => {
	assertEquals(isPinnable(ready, manual), true);
	assertEquals(isPinnable(ready, openPull), false);
	assertEquals(isPinnable(ready, { assignmentMode: "round_robin" }), false);
});

Deno.test("no pin is offered on held, undescribed, frozen, personal, stageless or New work", () => {
	for (
		const over of [
			{ claimed: true },
			{ hasDescription: false },
			{ frozen: true },
			{ personal: true },
			{ stageId: null },
			{ status: "backlog" as const },
			{ status: "in_progress" as const },
		]
	) {
		assertEquals(isPinnable({ ...ready, ...over }, manual), false, JSON.stringify(over));
	}
});

Deno.test("on a manual stage only the pinned freelancer may claim, and that claim is the acceptance", () => {
	assertEquals(isSelfClaimable(ready, manual), false);
	assertEquals(isSelfClaimable({ ...ready, pinnedToViewer: false }, manual), false);
	assertEquals(isSelfClaimable({ ...ready, pinnedToViewer: true }, manual), true);
	assertEquals(isSelfClaimable(ready, openPull), true);
});

Deno.test("a client routes a stage by open pull or by hand, never by a planned mode", () => {
	const base = { projectId: "prj-abcdefghjk", stageId: "s1" };
	assertEquals(SetStageAssignmentModeSchema.safeParse({ ...base, mode: "manual" }).success, true);
	assertEquals(
		SetStageAssignmentModeSchema.safeParse({ ...base, mode: "open_pull" }).success,
		true,
	);
	assertEquals(
		SetStageAssignmentModeSchema.safeParse({ ...base, mode: "round_robin" }).success,
		false,
	);
	assertEquals(
		SetStageAssignmentModeSchema.safeParse({ ...base, mode: "parallel_stream" }).success,
		false,
	);
});
