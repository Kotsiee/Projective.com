import { assertEquals } from "@std/assert";
import type { FeedbackIdea } from "@projective/types/community";
import {
	FEEDBACK_TABS,
	feedbackAge,
	feedbackEmptyCopy,
	feedbackHistoryDate,
	feedbackIdeaUnavailable,
	feedbackRoadmap,
	feedbackStatusTag,
	feedbackTabCount,
	feedbackTabLabel,
	signInToVoteLabel,
	voteAnnouncement,
	voteCountText,
	voteLabel,
} from "./feedback-view.ts";

const NOW = "2026-10-17T12:00:00.000Z";

function idea(slug: string, status: FeedbackIdea["status"]): FeedbackIdea {
	return {
		slug,
		title: slug,
		impact: "Why.",
		body: null,
		category: "projects",
		status,
		author: null,
		isOwn: false,
		voteCount: 1,
		viewerVoted: false,
		teamResponse: null,
		teamResponseAt: null,
		createdAt: NOW,
		statusChangedAt: NOW,
	};
}

Deno.test("tabs: All first, then the lifecycle, each with the owner's label and its count", () => {
	assertEquals(FEEDBACK_TABS.map(feedbackTabLabel), [
		"All",
		"Under review",
		"Planned",
		"In progress",
		"Shipped",
	]);
	const counts = { all: 9, under_review: 1, planned: 4, in_progress: 2, shipped: 2 };
	assertEquals(FEEDBACK_TABS.map((t) => feedbackTabCount(t, counts)), [9, 1, 4, 2, 2]);
});

Deno.test("each state wears its lifecycle tag", () => {
	assertEquals(feedbackStatusTag("backlog"), { label: "Under review", severity: "secondary" });
	assertEquals(feedbackStatusTag("ready"), { label: "Planned", severity: "info" });
	assertEquals(feedbackStatusTag("in_progress"), { label: "In progress", severity: "primary" });
	assertEquals(feedbackStatusTag("complete"), { label: "Shipped", severity: "success" });
});

Deno.test("the vote control says what it does and the count it shows", () => {
	assertEquals(voteCountText(1), "1 vote");
	assertEquals(voteCountText(12), "12 votes");
	assertEquals(voteLabel("Pause a stage", 12), "Upvote Pause a stage, 12 votes");
	assertEquals(signInToVoteLabel("Pause a stage", 1), "Sign in to upvote Pause a stage, 1 vote");
	assertEquals(voteAnnouncement("Pause a stage", true, 13), "Upvoted Pause a stage. 13 votes.");
	assertEquals(
		voteAnnouncement("Pause a stage", false, 12),
		"Vote removed from Pause a stage. 12 votes.",
	);
});

Deno.test("ages are measured from the board's own now, in words", () => {
	assertEquals(feedbackAge("2026-10-17T11:59:40.000Z", NOW), "just now");
	assertEquals(feedbackAge("2026-10-17T11:30:00.000Z", NOW), "30 minutes ago");
	assertEquals(feedbackAge("2026-10-16T12:00:00.000Z", NOW), "yesterday");
	assertEquals(feedbackAge("2026-10-14T12:00:00.000Z", NOW), "3 days ago");
	assertEquals(feedbackAge("2026-10-03T12:00:00.000Z", NOW), "2 weeks ago");
	assertEquals(feedbackAge("2026-06-17T12:00:00.000Z", NOW), "4 months ago");
	assertEquals(feedbackAge("not a date", NOW), "");
});

Deno.test("history dates are UTC, day-month-year, the same on every machine", () => {
	assertEquals(feedbackHistoryDate("2026-10-17T23:30:00.000Z"), "17 Oct 2026");
	assertEquals(feedbackHistoryDate("2026-01-05T00:00:00.000Z"), "05 Jan 2026");
});

Deno.test("the roadmap groups by column in the board's order; under review sits apart", () => {
	const ideas = [
		idea("a", "complete"),
		idea("b", "ready"),
		idea("c", "backlog"),
		idea("d", "in_progress"),
		idea("e", "ready"),
	];
	const { columns, underReview } = feedbackRoadmap(ideas);
	assertEquals(columns.planned.map((i) => i.slug), ["b", "e"]);
	assertEquals(columns.in_progress.map((i) => i.slug), ["d"]);
	assertEquals(columns.shipped.map((i) => i.slug), ["a"]);
	assertEquals(underReview.map((i) => i.slug), ["c"]);
});

Deno.test("an empty Under review tab explains itself differently to a guest", () => {
	assertEquals(feedbackEmptyCopy("under_review", false).title, "Ideas under review are private");
	assertEquals(feedbackEmptyCopy("under_review", true).title, "Nothing under review");
	assertEquals(feedbackEmptyCopy(null, false).title, "No ideas yet");
});

Deno.test("an idea that will not open: one answer for absent and hidden, another for a failed read", () => {
	const hidden = feedbackIdeaUnavailable(404, "That idea isn't on the board.");
	assertEquals(hidden.title, "This idea isn't on the board");
	assertEquals(hidden.text.includes("under review"), true);
	assertEquals(
		feedbackIdeaUnavailable(503, "The feedback board is unavailable.").text,
		"The feedback board is unavailable.",
	);
	assertEquals(feedbackIdeaUnavailable(503, null).title, "This idea couldn't load");
	assertEquals(feedbackIdeaUnavailable(500, "").text.length > 0, true);
});
