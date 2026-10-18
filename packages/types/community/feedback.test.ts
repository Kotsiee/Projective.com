import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	canSeeFeedbackIdea,
	FEEDBACK_FILTER_STATE,
	FEEDBACK_MOVES,
	FEEDBACK_STATE_LABEL,
	FEEDBACK_STATES,
	FEEDBACK_STATUS_FILTERS,
	FeedbackBoardQuerySchema,
	feedbackFilterOf,
	FeedbackIdeaCreateSchema,
	FeedbackIdeaSlugSchema,
	FeedbackModerationSchema,
	isFeedbackVotable,
	isLegalFeedbackMove,
} from "./feedback.ts";

// #region States and labels
Deno.test("the board's labels are the owner's words for the unified states", () => {
	assertEquals(FEEDBACK_STATE_LABEL, {
		backlog: "Under review",
		ready: "Planned",
		in_progress: "In progress",
		complete: "Shipped",
		archived: "Archived",
	});
});

Deno.test("every tab maps to one stored state and back; Archived has no tab", () => {
	for (const filter of FEEDBACK_STATUS_FILTERS) {
		assertEquals(feedbackFilterOf(FEEDBACK_FILTER_STATE[filter]), filter);
	}
	assertEquals(feedbackFilterOf("archived"), null);
	assertEquals(new Set(Object.values(FEEDBACK_FILTER_STATE)).size, FEEDBACK_STATUS_FILTERS.length);
});

Deno.test("legal moves: Archived is terminal, Shipped only archives, nothing moves to itself", () => {
	assertEquals(FEEDBACK_MOVES.archived, []);
	assertEquals(FEEDBACK_MOVES.complete, ["archived"]);
	assert(isLegalFeedbackMove("backlog", "ready"));
	assertFalse(isLegalFeedbackMove("backlog", "complete"));
	assertFalse(isLegalFeedbackMove("archived", "ready"));
	for (const state of FEEDBACK_STATES) assertFalse(isLegalFeedbackMove(state, state));
	for (const state of FEEDBACK_STATES) {
		if (state !== "archived") assert(isLegalFeedbackMove(state, "archived"), state);
	}
});

Deno.test("voting is open under review, planned and in progress, closed once shipped or archived", () => {
	assert(isFeedbackVotable("backlog"));
	assert(isFeedbackVotable("ready"));
	assert(isFeedbackVotable("in_progress"));
	assertFalse(isFeedbackVotable("complete"));
	assertFalse(isFeedbackVotable("archived"));
});
// #endregion

// #region Visibility
const AUTHOR = "6ce1906f-caab-4708-a19e-df3d8960666e";
const OTHER = "1fee216e-a637-4619-a90a-4ae03bb1ed8b";

Deno.test("public states are visible to a guest; Backlog only to its author; Archived to nobody but operators", () => {
	const guest = { userId: null, isOperator: false };
	const author = { userId: AUTHOR, isOperator: false };
	const other = { userId: OTHER, isOperator: false };
	const operator = { userId: OTHER, isOperator: true };
	for (const status of ["ready", "in_progress", "complete"] as const) {
		assert(canSeeFeedbackIdea({ status, authorId: AUTHOR }, guest), status);
	}
	assertFalse(canSeeFeedbackIdea({ status: "backlog", authorId: AUTHOR }, guest));
	assertFalse(canSeeFeedbackIdea({ status: "backlog", authorId: AUTHOR }, other));
	assert(canSeeFeedbackIdea({ status: "backlog", authorId: AUTHOR }, author));
	assert(canSeeFeedbackIdea({ status: "backlog", authorId: AUTHOR }, operator));
	assertFalse(canSeeFeedbackIdea({ status: "archived", authorId: AUTHOR }, author));
	assert(canSeeFeedbackIdea({ status: "archived", authorId: AUTHOR }, operator));
	// An erased author's idea under review is nobody's but the operators'.
	assertFalse(canSeeFeedbackIdea({ status: "backlog", authorId: null }, guest));
});
// #endregion

// #region Request shapes
Deno.test("an idea address is an fbk- slug", () => {
	assert(FeedbackIdeaSlugSchema.safeParse("fbk-kbyrph7gdt").success);
	assertFalse(FeedbackIdeaSlugSchema.safeParse("prj-kbyrph7gdt").success);
	assertFalse(FeedbackIdeaSlugSchema.safeParse("fbk-KBYRPH7GDT").success);
	assertFalse(FeedbackIdeaSlugSchema.safeParse("6ce1906f-caab-4708-a19e-df3d8960666e").success);
});

Deno.test("the create body trims, bounds and requires the problem it solves", () => {
	const ok = FeedbackIdeaCreateSchema.safeParse({
		title: "  Export my invoices  ",
		category: "escrow_payments",
		impact: "My accountant wants all of them at once.",
	});
	assert(ok.success);
	assertEquals(ok.data?.title, "Export my invoices");
	assertFalse(
		FeedbackIdeaCreateSchema.safeParse({
			title: "Short",
			category: "other",
			impact: "x".repeat(20),
		})
			.success,
	);
	assertFalse(
		FeedbackIdeaCreateSchema.safeParse({
			title: "x".repeat(91),
			category: "other",
			impact: "x".repeat(20),
		})
			.success,
	);
	assertFalse(
		FeedbackIdeaCreateSchema.safeParse({
			title: "A fine title",
			category: "wallets",
			impact: "x".repeat(20),
		})
			.success,
	);
	assertFalse(
		FeedbackIdeaCreateSchema.safeParse({
			title: "A fine title",
			category: "other",
			impact: "Too short",
		})
			.success,
	);
});

Deno.test("the board query defaults to Top and 60, and refuses an unknown tab", () => {
	assertEquals(FeedbackBoardQuerySchema.parse({}), { sort: "top", limit: 60 });
	assertEquals(FeedbackBoardQuerySchema.parse({ status: "shipped", sort: "new", limit: "5" }), {
		status: "shipped",
		sort: "new",
		limit: 5,
	});
	assertFalse(FeedbackBoardQuerySchema.safeParse({ status: "archived" }).success);
	assertFalse(FeedbackBoardQuerySchema.safeParse({ limit: "500" }).success);
});

Deno.test("a moderation asks for a move, a response or both", () => {
	assert(FeedbackModerationSchema.safeParse({ status: "ready" }).success);
	assert(FeedbackModerationSchema.safeParse({ response: "" }).success);
	assertFalse(FeedbackModerationSchema.safeParse({ note: "Only a note" }).success);
});
// #endregion
