import { assert, assertEquals } from "@std/assert";
import {
	type BoardCard,
	type CommitTicket,
	NEW_LANE_REFUSAL_MESSAGE,
	STAGE_NOT_INCLUDED_MESSAGE,
	STALE_MOVE_MESSAGE,
	ticketDeletable,
	ticketIncludesStage,
	ticketLeavesStage,
} from "@projective/types/projects";
import { ProjectBackendService } from "./ProjectBackendService.ts";
import { CLAIM_REFUSAL } from "./live-claim.ts";
import { resetWriteStore } from "./write-store.ts";
import type { ReadActor } from "../read-actor.ts";

/**
 * Stub parity (audit S9): the stub branch refuses what `claim_ticket`, `move_ticket` and the ticket
 * content guard refuse, with the same status, sentence and field error.
 */

const ALICE: ReadActor = { userId: "u-alice", contextId: "", contextType: "personal" };
const PROJECT = "prj-8mzxqqn6w8";
/** A funded, described, Ready ticket on an open-pull stage. */
const TICKET = `${PROJECT}-t26`;

// #region Helpers
async function cardOf(id: string): Promise<BoardCard> {
	const board = await ProjectBackendService.board({ projectId: PROJECT, view: "stages" }, ALICE);
	const card = board.data?.page.cards.find((c) => c.id === id);
	assert(card, `${id} is on the board`);
	return card;
}

async function claimed(): Promise<BoardCard> {
	const res = await ProjectBackendService.claimTicket(
		{ projectId: PROJECT, ticketId: TICKET },
		ALICE,
	);
	assert(res.ok && res.data, res.message);
	return res.data.card;
}

function commitOf(card: BoardCard, overrides: Partial<CommitTicket> = {}): CommitTicket {
	return {
		projectId: PROJECT,
		clientId: card.id,
		title: card.title,
		description: card.description ?? "",
		status: card.status,
		stageId: card.stageId,
		priority: card.priority,
		intensity: card.intensity,
		dueDate: null,
		ownerId: null,
		tasks: card.tasks,
		stages: card.stages,
		attachmentIds: [],
		...overrides,
	};
}
// #endregion

// #region claimTicket
Deno.test("claimTicket (stub): a ticket that is not Ready is refused as not open", async () => {
	resetWriteStore();
	const card = await cardOf(TICKET);
	const parked = await ProjectBackendService.moveTicket({
		projectId: PROJECT,
		ticketId: TICKET,
		status: "backlog",
		stageId: card.stageId,
		sortOrder: null,
	}, ALICE);
	assert(parked.ok, parked.message);
	const res = await ProjectBackendService.claimTicket(
		{ projectId: PROJECT, ticketId: TICKET },
		ALICE,
	);
	assertEquals([res.status, res.message, res.errors], [
		CLAIM_REFUSAL.notOpen.status,
		CLAIM_REFUSAL.notOpen.message,
		CLAIM_REFUSAL.notOpen.errors,
	]);
});
// #endregion

// #region moveTicket
Deno.test("moveTicket (stub): a move against a stale reading is refused 409; a chained move is not", async () => {
	resetWriteStore();
	const card = await cardOf(TICKET);
	const stale = await ProjectBackendService.moveTicket({
		projectId: PROJECT,
		ticketId: TICKET,
		status: "backlog",
		stageId: card.stageId,
		sortOrder: null,
		expectedUpdatedAt: "2000-01-01T00:00:00Z",
	}, ALICE);
	assertEquals([stale.status, stale.message, stale.errors], [409, STALE_MOVE_MESSAGE, {
		ticket: "stale",
	}]);

	const first = await ProjectBackendService.moveTicket({
		projectId: PROJECT,
		ticketId: TICKET,
		status: "backlog",
		stageId: card.stageId,
		sortOrder: null,
		expectedUpdatedAt: card.updatedAt,
	}, ALICE);
	assert(first.ok && first.data, first.message);
	const second = await ProjectBackendService.moveTicket({
		projectId: PROJECT,
		ticketId: TICKET,
		status: "todo",
		stageId: card.stageId,
		sortOrder: null,
		expectedUpdatedAt: first.data.card.updatedAt,
	}, ALICE);
	assertEquals(second.ok, true, second.message);
});

Deno.test("moveTicket (stub): the client cannot relocate a ticket a freelancer is working", async () => {
	resetWriteStore();
	const board = await ProjectBackendService.board({ projectId: PROJECT, view: "stages" }, ALICE);
	assert(board.data?.page.viewerIsClient, "the fixture viewer is the client");
	const card = await claimed();
	const res = await ProjectBackendService.moveTicket({
		projectId: PROJECT,
		ticketId: TICKET,
		status: "todo",
		stageId: card.stageId,
		sortOrder: null,
	}, ALICE);
	assertEquals([res.status, res.errors], [403, { status: "not_permitted" }]);
	assertEquals(
		res.message,
		"A freelancer is working this ticket — it can be moved once the work is handed back.",
	);
});

Deno.test("moveTicket (stub): claimed work keeps its stage; a funded unclaimed ticket goes to New", async () => {
	resetWriteStore();
	const funded = await cardOf(TICKET);
	assert(funded.stageId && !ticketDeletable(funded), "the fixture ticket is staged and funded");
	assert(ticketLeavesStage(funded), "and nobody has claimed it");
	const moved = await ProjectBackendService.moveTicket({
		projectId: PROJECT,
		ticketId: TICKET,
		status: "backlog",
		stageId: null,
		sortOrder: 0,
	}, ALICE);
	assert(moved.ok && moved.data, moved.message);
	assertEquals([moved.data.card.status, moved.data.card.stageId], ["backlog", null]);

	const board = await ProjectBackendService.board({ projectId: PROJECT, view: "stages" }, ALICE);
	const handedBackCard = board.data?.page.cards.find((c) =>
		c.claimed && c.stageId !== null && (c.status === "in_review" || c.status === "completed")
	);
	assert(handedBackCard, "the fixture board carries claimed work handed back");
	const handedBack = await ProjectBackendService.moveTicket({
		projectId: PROJECT,
		ticketId: handedBackCard.id,
		status: "backlog",
		stageId: null,
		sortOrder: 0,
	}, ALICE);
	assertEquals([handedBack.status, handedBack.message, handedBack.errors], [
		422,
		NEW_LANE_REFUSAL_MESSAGE,
		{ status: "not_allowed" },
	]);
});

Deno.test("moveTicket (stub): a ticket enters only the stages it lists (Decision #428)", async () => {
	resetWriteStore();
	const board = await ProjectBackendService.board({ projectId: PROJECT, view: "stages" }, ALICE);
	const page = board.data?.page;
	assert(page, "the fixture board reads");
	const listed = page.cards.find((c) =>
		!c.claimed && c.stages.length > 0 &&
		page.stages.some((s) => !c.stages.some((own) => own.stageId === s.id))
	);
	assert(listed, "the fixture board has an unclaimed ticket that leaves some stage out");
	const outside = page.stages.find((s) => !listed.stages.some((own) => own.stageId === s.id));
	assert(outside && !ticketIncludesStage(listed, outside.id));
	const refused = await ProjectBackendService.moveTicket({
		projectId: PROJECT,
		ticketId: listed.id,
		status: "todo",
		stageId: outside.id,
		sortOrder: null,
	}, ALICE);
	assertEquals([refused.status, refused.message, refused.errors], [
		422,
		STAGE_NOT_INCLUDED_MESSAGE,
		{ stageId: "not_allowed" },
	]);
});
// #endregion

// #region commitTicket
Deno.test("commitTicket (stub): a claimed ticket's terms are locked; an unchanged save passes", async () => {
	resetWriteStore();
	const card = await claimed();
	for (
		const change of [
			{ title: `${card.title} (edited)` },
			{ description: "A different brief entirely." },
			{ stages: [] },
		] satisfies Partial<CommitTicket>[]
	) {
		const res = await ProjectBackendService.commitTicket(commitOf(card, change), ALICE);
		assertEquals(
			[res.status, res.errors],
			[403, { title: "not_permitted" }],
			JSON.stringify(change),
		);
	}
	const same = await ProjectBackendService.commitTicket(commitOf(card), ALICE);
	assertEquals(same.ok, true, same.message);
});
// #endregion
