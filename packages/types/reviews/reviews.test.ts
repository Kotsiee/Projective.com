import { assertEquals } from "@std/assert";
import {
	EditReviewInputSchema,
	type Reviewable,
	ReviewReplyInputSchema,
	reviewStateOf,
	SubmitReviewInputSchema,
} from "./mod.ts";

const COMMENT = "A clear brief, a handoff our team could build from, and every question answered inside a day.....";

function item(review: Reviewable["review"], open = true): Reviewable {
	return {
		anchor_kind: "project",
		anchor_id: "22222222-2222-4222-8222-222222222222",
		target_type: "freelancer",
		target_id: "33333333-3333-4333-8333-333333333333",
		target: null,
		opened_at: "2026-11-16T10:00:00Z",
		closes_at: "2026-12-16T10:00:00Z",
		open,
		review,
	};
}

function review(over: Partial<NonNullable<Reviewable["review"]>> = {}): NonNullable<Reviewable["review"]> {
	return {
		id: "44444444-4444-4444-8444-444444444444",
		rating: 5,
		title: null,
		comment: COMMENT,
		created_at: "2026-11-17T10:00:00Z",
		edited_at: null,
		withdrawn: false,
		hidden: false,
		reply: null,
		replied_at: null,
		window_closes_at: "2026-12-16T10:00:00Z",
		mine: true,
		editable: true,
		...over,
	};
}

Deno.test("reviews: a reviewable's state follows its review and its window", () => {
	assertEquals(reviewStateOf(item(null)), "open");
	assertEquals(reviewStateOf(item(null, false)), "closed");
	assertEquals(reviewStateOf(item(review())), "reviewed");
	assertEquals(reviewStateOf(item(review({ editable: false, reply: "Thanks" }))), "locked");
	assertEquals(reviewStateOf(item(review({ withdrawn: true, editable: false }))), "withdrawn");
});

Deno.test("reviews: a submission needs 100 characters, half stars, and drops an empty headline", () => {
	const base = {
		anchorKind: "project",
		anchorId: "22222222-2222-4222-8222-222222222222",
		targetType: "freelancer",
		targetId: "33333333-3333-4333-8333-333333333333",
		rating: 4.5,
		title: "  ",
		comment: COMMENT.padEnd(100, "."),
	};
	const ok = SubmitReviewInputSchema.safeParse(base);
	assertEquals(ok.success, true);
	assertEquals(ok.success && ok.data.title, null);
	assertEquals(SubmitReviewInputSchema.safeParse({ ...base, comment: "Too short." }).success, false);
	assertEquals(SubmitReviewInputSchema.safeParse({ ...base, rating: 4.3 }).success, false);
	assertEquals(SubmitReviewInputSchema.safeParse({ ...base, rating: 6 }).success, false);
	assertEquals(SubmitReviewInputSchema.safeParse({ ...base, anchorKind: "listing" }).success, false);
	assertEquals(EditReviewInputSchema.safeParse({ rating: 3, comment: COMMENT.padEnd(100, ".") }).success, true);
});

Deno.test("reviews: a reply is 1 to 1,000 characters", () => {
	assertEquals(ReviewReplyInputSchema.safeParse({ body: "Thank you." }).success, true);
	assertEquals(ReviewReplyInputSchema.safeParse({ body: "   " }).success, false);
	assertEquals(ReviewReplyInputSchema.safeParse({ body: "x".repeat(1001) }).success, false);
});
