import { assert, assertEquals } from "@std/assert";
import {
	BoardCardSchema,
	BoardPageSchema,
	providerCanSeeCard,
	providerVisibleCards,
	ticketPaidForStage,
	ticketPaidHere,
	ticketWorkLocked,
} from "./board.ts";

/*
 * Every rule here is a CLAIM the board makes about money and access — "this ticket is paid where it
 * sits", "this freelancer may see it", "the client may still move it" — and the failure mode of a
 * wrong claim is a card that is confidently shown to somebody who must never see it, or a badge that
 * says Paid over a stage nobody bought. So the rules are pinned directly, with hand-built inputs.
 */

const unpaid = { paymentScope: "unpaid" as const, paidStageIds: [] as string[] };
const perStage = { paymentScope: "per_stage" as const, paidStageIds: ["s1", "s3"] };
const full = { paymentScope: "full" as const, paidStageIds: [] as string[] };

// #region Paid-for-stage
Deno.test("a fully paid ticket is paid in every lane, the backlog included", () => {
	assert(ticketPaidForStage(full, "s1"));
	assert(ticketPaidForStage(full, "s9"));
	assert(ticketPaidForStage(full, null));
});

Deno.test("a per-stage ticket is paid exactly where its purchase says", () => {
	assert(ticketPaidForStage(perStage, "s1"));
	assert(!ticketPaidForStage(perStage, "s2"));
	assert(ticketPaidForStage(perStage, "s3"));
	// The New backlog is not a stage; a per-stage payment has nothing there to attach to.
	assert(!ticketPaidForStage(perStage, null));
});

Deno.test("an unpaid ticket is paid nowhere", () => {
	assert(!ticketPaidForStage(unpaid, "s1"));
	assert(!ticketPaidForStage(unpaid, null));
});

Deno.test("paid-here re-derives from the CURRENT stage, so a drag flips it without a write", () => {
	const card = { ...perStage, stageId: "s1" as string | null };
	assert(ticketPaidHere(card));
	// Moved into a stage nobody paid for → Unpaid, from the same purchase record.
	assert(!ticketPaidHere({ ...card, stageId: "s2" }));
	// Moved back → Paid again.
	assert(ticketPaidHere({ ...card, stageId: "s3" }));
	// A fully paid ticket does not care where it is moved.
	assert(ticketPaidHere({ ...full, stageId: "s2" }));
	assert(ticketPaidHere({ ...full, stageId: null }));
});
// #endregion

// #region Provider visibility
Deno.test("a provider sees a ticket only when it is paid for its stage AND they are onboarded there", () => {
	const onboarded = new Set(["s1", "s2"]);
	assert(providerCanSeeCard({ ...perStage, stageId: "s1" }, onboarded));
	// Onboarded, but the stage was not paid for.
	assert(!providerCanSeeCard({ ...perStage, stageId: "s2" }, onboarded));
	// Paid for, but not onboarded to that stage.
	assert(!providerCanSeeCard({ ...perStage, stageId: "s3" }, onboarded));
	// Fully paid still needs onboarding.
	assert(providerCanSeeCard({ ...full, stageId: "s2" }, onboarded));
	assert(!providerCanSeeCard({ ...full, stageId: "s3" }, onboarded));
	// Never an unpaid ticket, however well placed.
	assert(!providerCanSeeCard({ ...unpaid, stageId: "s1" }, onboarded));
});

Deno.test("the New backlog is never visible to a provider — nobody is onboarded to it", () => {
	assert(!providerCanSeeCard({ ...full, stageId: null }, new Set(["s1"])));
});

Deno.test("providerVisibleCards keeps order and drops nothing it should keep", () => {
	const cards = [
		{ id: "a", ...full, stageId: "s1" },
		{ id: "b", ...unpaid, stageId: "s1" },
		{ id: "c", ...perStage, stageId: "s3" },
		{ id: "d", ...perStage, stageId: "s2" },
		{ id: "e", ...full, stageId: null },
	];
	assertEquals(
		providerVisibleCards(cards, ["s1", "s3"]).map((c) => c.id),
		["a", "c"],
	);
	// An empty onboarding set hides everything — the safe side.
	assertEquals(providerVisibleCards(cards, []), []);
});
// #endregion

// #region Client drag lock
Deno.test("the client's drag locks only while somebody is actively working the ticket", () => {
	assert(ticketWorkLocked({ claimed: true, status: "claimed" }));
	assert(ticketWorkLocked({ claimed: true, status: "in_progress" }));
	// Handed back for review — the client's move, not locked.
	assert(!ticketWorkLocked({ claimed: true, status: "in_review" }));
	// Finished — dragging it back is the revision request the board warns about.
	assert(!ticketWorkLocked({ claimed: true, status: "completed" }));
	// Unclaimed tickets move freely whatever their status says.
	assert(!ticketWorkLocked({ claimed: false, status: "in_progress" }));
	assert(!ticketWorkLocked({ claimed: false, status: "todo" }));
});
// #endregion

// #region Schema defaults
Deno.test("a card with no funding fields parses as unpaid, and a page with no viewer stages as none", () => {
	const card = BoardCardSchema.parse({
		id: "t1",
		title: "T",
		description: null,
		hasDescription: false,
		status: "backlog",
		stageId: null,
		assignee: null,
		claimed: false,
		escrowHeld: false,
		priority: "normal",
		intensity: "standard",
		workload: 0,
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
		updatedAt: "2026-07-17T16:20:00Z",
		dateLabel: "Jul 17",
		sortOrder: 0,
	});
	assertEquals(card.paymentScope, "unpaid");
	assertEquals(card.paidStageIds, []);
	assert(!ticketPaidHere(card));

	const page = BoardPageSchema.parse({
		scope: "project",
		kind: "project",
		projectId: "prj-x",
		channelId: null,
		format: "pipeline",
		title: "Pipeline",
		view: "stages",
		viewerIsClient: true,
		columns: [],
		cards: [],
		stages: [],
		assignees: [],
		viewerId: "v",
		total: 0,
	});
	assertEquals(page.viewerStageIds, []);
});
// #endregion
