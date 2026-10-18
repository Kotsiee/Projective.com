import { assert, assertEquals } from "@std/assert";
import type { FeedbackBoard, FeedbackIdea } from "@projective/types/community";
import { feedbackIdeaUrl, feedbackJsonLd, feedbackPageMeta } from "./feedback-seo.ts";

const ORIGIN = "https://projective.app";
const NOW = "2026-10-17T12:00:00.000Z";

function idea(slug: string, status: FeedbackIdea["status"], title = slug): FeedbackIdea {
	return {
		slug,
		title,
		impact: "Why it matters.",
		body: null,
		category: "projects",
		status,
		author: null,
		isOwn: false,
		voteCount: 3,
		viewerVoted: false,
		teamResponse: null,
		teamResponseAt: null,
		createdAt: NOW,
		statusChangedAt: NOW,
	};
}

const board = (ideas: FeedbackIdea[]): FeedbackBoard => ({
	ideas,
	counts: { all: ideas.length, under_review: 0, planned: 0, in_progress: 0, shipped: 0 },
	viewer: { signedIn: false },
	now: NOW,
});

Deno.test("the board is one indexable page at /feedback", () => {
	const meta = feedbackPageMeta(ORIGIN, null);
	assertEquals(meta.path, "/feedback");
	assertEquals(meta.title, "Feedback & roadmap");
	assert(!meta.noindex);
});

Deno.test("an idea's section keeps /feedback as canonical; one under review is never indexed", () => {
	const detail = (status: FeedbackIdea["status"]) => ({
		idea: idea("fbk-kbyrph7gdt", status, "Pause a stage"),
		history: [],
		related: [],
		now: NOW,
	});
	const planned = feedbackPageMeta(ORIGIN, detail("ready"));
	assertEquals([planned.path, planned.title, planned.noindex], [
		"/feedback",
		"Pause a stage · Feedback & roadmap",
		false,
	]);
	assertEquals(feedbackPageMeta(ORIGIN, detail("backlog")).noindex, true);
});

Deno.test("an idea the reader may not open answers with the board's head, never indexed", () => {
	const meta = feedbackPageMeta(ORIGIN, null, { ideaMissing: true });
	assertEquals([meta.path, meta.title, meta.noindex], ["/feedback", "Feedback & roadmap", true]);
});

Deno.test("a board that could not be read is never indexed, on the board or an idea's section", () => {
	assertEquals(feedbackPageMeta(ORIGIN, null, { boardFailed: true }).noindex, true);
	const detail = {
		idea: idea("fbk-kbyrph7gdt", "ready", "Pause a stage"),
		history: [],
		related: [],
		now: NOW,
	};
	assertEquals(feedbackPageMeta(ORIGIN, detail, { boardFailed: true }).noindex, true);
	assertEquals(feedbackPageMeta(ORIGIN, detail, { boardFailed: false }).noindex, false);
});

Deno.test("JSON-LD: a CollectionPage listing the public ideas at their rows' anchors, and a breadcrumb", () => {
	const graph = feedbackJsonLd(
		ORIGIN,
		board([
			idea("fbk-kbyrph7gdt", "ready"),
			idea("fbk-vgxyd2ex3m", "backlog"),
			idea("fbk-8caxcq6che", "complete"),
		]),
	);
	const page = graph["@graph"].find((n) => n["@type"] === "CollectionPage")!;
	const list = page.mainEntity as { itemListElement: Array<{ url: string; position: number }> };
	assertEquals(list.itemListElement.map((i) => i.url), [
		feedbackIdeaUrl(ORIGIN, "fbk-kbyrph7gdt"),
		feedbackIdeaUrl(ORIGIN, "fbk-8caxcq6che"),
	]);
	assertEquals(list.itemListElement.map((i) => i.position), [1, 2]);
	assert(graph["@graph"].some((n) => n["@type"] === "BreadcrumbList"));
	// The row's anchor on the canonical page — never a `?idea=` address, which canonicalises away.
	assertEquals(
		feedbackIdeaUrl(ORIGIN, "fbk-kbyrph7gdt"),
		"https://projective.app/feedback#fbk-kbyrph7gdt",
	);
	// It survives the script-safe serialiser as JSON.
	JSON.parse(JSON.stringify(graph));
});

Deno.test("an empty or unread board still describes the page, without a list", () => {
	const graph = feedbackJsonLd(ORIGIN, null);
	const page = graph["@graph"].find((n) => n["@type"] === "CollectionPage")!;
	assertEquals(page.mainEntity, undefined);
});
