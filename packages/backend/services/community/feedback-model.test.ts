import { assert, assertEquals } from "@std/assert";
import { recordsFromRows, rowsFromRecords } from "../../core/row-mapper.ts";
import {
	FEEDBACK_BOARD_STATES,
	FEEDBACK_IDEAS_TABLE,
	feedbackCountsFromRpc,
	feedbackCountsOf,
	feedbackHistoryOf,
	type FeedbackIdeaRecord,
	feedbackSearchScore,
	feedbackSearchTokens,
	feedbackStatesFor,
	ideaFromDoorRow,
	rankFeedbackSearch,
	relatedFeedbackIdeas,
	sortFeedbackIdeas,
	toFeedbackIdea,
} from "./feedback-model.ts";

const AT = (d: number) => new Date(Date.UTC(2026, 9, 1 + d)).toISOString();

let serial = 0;

function idea(over: Partial<FeedbackIdeaRecord> & { slug: string }): FeedbackIdeaRecord {
	serial += 1;
	return {
		id: `00000000-0000-4000-a000-${serial.toString(16).padStart(12, "0")}`,
		title: "An idea",
		impact: "Why it matters to someone.",
		body: null,
		category: "projects",
		status: "ready",
		authorId: null,
		voteCount: 0,
		teamResponse: null,
		teamResponseAt: null,
		createdAt: AT(0),
		updatedAt: AT(0),
		statusChangedAt: AT(0),
		archivedAt: null,
		...over,
	};
}

// #region The mapper
Deno.test("a record survives the row round trip unchanged", () => {
	const record = idea({ slug: "fbk-kbyrph7gdt", authorId: "6ce1906f-caab-4708-a19e-df3d8960666e" });
	const [back] = recordsFromRows(
		FEEDBACK_IDEAS_TABLE,
		rowsFromRecords(FEEDBACK_IDEAS_TABLE, [record]),
	);
	assertEquals(back, record);
});

Deno.test("a door's answer splits into the record and the caller's vote", () => {
	const record = idea({ slug: "fbk-kbyrph7gdt" });
	const [row] = rowsFromRecords(FEEDBACK_IDEAS_TABLE, [record]);
	const split = ideaFromDoorRow({ ...row, viewer_voted: true });
	assertEquals(split.record, record);
	assertEquals(split.viewerVoted, true);
});
// #endregion

// #region States, order and search
Deno.test("no tab reads every board state; Archived is never read", () => {
	assertEquals(feedbackStatesFor(undefined), ["backlog", "ready", "in_progress", "complete"]);
	assertEquals(feedbackStatesFor("shipped"), ["complete"]);
	assert(!FEEDBACK_BOARD_STATES.includes("archived"));
});

Deno.test("Top orders by votes then newest; New by newest; ties end on the slug", () => {
	const a = idea({ slug: "fbk-aaaaaaaaaa", voteCount: 3, createdAt: AT(1) });
	const b = idea({ slug: "fbk-bbbbbbbbbb", voteCount: 9, createdAt: AT(0) });
	const c = idea({ slug: "fbk-cccccccccc", voteCount: 3, createdAt: AT(2) });
	const d = idea({ slug: "fbk-dddddddddd", voteCount: 3, createdAt: AT(2) });
	assertEquals(sortFeedbackIdeas([a, b, c, d], "top").map((r) => r.slug), [
		"fbk-bbbbbbbbbb",
		"fbk-cccccccccc",
		"fbk-dddddddddd",
		"fbk-aaaaaaaaaa",
	]);
	assertEquals(sortFeedbackIdeas([a, b, c, d], "new").map((r) => r.slug), [
		"fbk-cccccccccc",
		"fbk-dddddddddd",
		"fbk-aaaaaaaaaa",
		"fbk-bbbbbbbbbb",
	]);
});

Deno.test("search tokens: words of three letters or more, lowercased, no stopwords, no filter syntax", () => {
	assertEquals(feedbackSearchTokens("Let me PAUSE the stage, please!"), [
		"pause",
		"stage",
		"please",
	]);
	assertEquals(feedbackSearchTokens("title.ilike.*x*,id.eq.1"), ["title", "ilike"]);
	assertEquals(feedbackSearchTokens("a an to"), []);
	assertEquals(feedbackSearchTokens(undefined), []);
	assertEquals(feedbackSearchTokens("one two three four five six seven eight nine ten").length, 6);
	assertEquals(feedbackSearchTokens("stage stage Stage"), ["stage"]);
});

Deno.test("search ranks by words in common, then votes", () => {
	const pause = idea({
		slug: "fbk-aaaaaaaaaa",
		title: "Pause a stage without cancelling it",
		voteCount: 2,
	});
	const split = idea({ slug: "fbk-bbbbbbbbbb", title: "Split one stage's payment", voteCount: 9 });
	const other = idea({ slug: "fbk-cccccccccc", title: "Saved replies", voteCount: 20 });
	const tokens = feedbackSearchTokens("pause the stage");
	assertEquals(feedbackSearchScore(pause.title, tokens), 2);
	assertEquals(rankFeedbackSearch([split, other, pause], tokens).map((r) => r.slug), [
		"fbk-aaaaaaaaaa",
		"fbk-bbbbbbbbbb",
	]);
});
// #endregion

// #region Counts, related, history, the API shape
Deno.test("counts: one per tab, all is their sum, Archived counts nowhere", () => {
	const counts = feedbackCountsOf([
		idea({ slug: "fbk-aaaaaaaaaa", status: "backlog" }),
		idea({ slug: "fbk-bbbbbbbbbb", status: "ready" }),
		idea({ slug: "fbk-cccccccccc", status: "ready" }),
		idea({ slug: "fbk-dddddddddd", status: "complete" }),
		idea({ slug: "fbk-eeeeeeeeee", status: "archived" }),
	]);
	assertEquals(counts, { all: 4, under_review: 1, planned: 2, in_progress: 0, shipped: 1 });
});

Deno.test("the counts RPC is parsed defensively", () => {
	assertEquals(
		feedbackCountsFromRpc({ ready: 5, complete: 2, archived: 7, bogus: 3, backlog: "x" }),
		{
			all: 7,
			under_review: 0,
			planned: 5,
			in_progress: 0,
			shipped: 2,
		},
	);
	assertEquals(feedbackCountsFromRpc(null).all, 0);
	assertEquals(feedbackCountsFromRpc([1, 2]).all, 0);
});

Deno.test("related: same category, public only, never the idea itself, most voted first, three at most", () => {
	const self = idea({ slug: "fbk-aaaaaaaaaa", category: "messaging" });
	const pool = [
		self,
		idea({ slug: "fbk-bbbbbbbbbb", category: "messaging", voteCount: 1 }),
		idea({ slug: "fbk-cccccccccc", category: "messaging", voteCount: 5 }),
		idea({ slug: "fbk-dddddddddd", category: "messaging", voteCount: 3, status: "backlog" }),
		idea({ slug: "fbk-eeeeeeeeee", category: "projects", voteCount: 50 }),
		idea({ slug: "fbk-ffffffffff", category: "messaging", voteCount: 2, status: "complete" }),
		idea({ slug: "fbk-gggggggggg", category: "messaging", voteCount: 4, status: "in_progress" }),
	];
	assertEquals(relatedFeedbackIdeas(pool, self).map((r) => r.slug), [
		"fbk-cccccccccc",
		"fbk-gggggggggg",
		"fbk-ffffffffff",
	]);
});

Deno.test("history is oldest first, the submission before a move at the same instant", () => {
	const history = feedbackHistoryOf([
		{ id: "3", ideaId: "x", from: "ready", to: "in_progress", at: AT(4) },
		{ id: "2", ideaId: "x", from: "backlog", to: "ready", at: AT(1) },
		{ id: "1", ideaId: "x", from: null, to: "backlog", at: AT(1) },
	]);
	assertEquals(history.map((h) => h.to), ["backlog", "ready", "in_progress"]);
	assertEquals(history[0].from, null);
});

Deno.test("the API shape carries the slug, the reader's facts and the author card — never the id", () => {
	const record = idea({
		slug: "fbk-kbyrph7gdt",
		authorId: "6ce1906f-caab-4708-a19e-df3d8960666e",
		voteCount: 4,
	});
	const shaped = toFeedbackIdea(record, {
		viewerId: "6ce1906f-caab-4708-a19e-df3d8960666e",
		voted: new Set([record.id]),
		authors: new Map([[record.authorId!, {
			handle: "marisdelacroix",
			name: "Maris",
			avatar: null,
		}]]),
	});
	assertEquals(shaped.isOwn, true);
	assertEquals(shaped.viewerVoted, true);
	assertEquals(shaped.author?.handle, "marisdelacroix");
	assert(!("id" in shaped));
	assert(!("authorId" in shaped));
	const asGuest = toFeedbackIdea(record, { viewerId: null, voted: new Set(), authors: new Map() });
	assertEquals([asGuest.isOwn, asGuest.viewerVoted, asGuest.author], [false, false, null]);
});
// #endregion
