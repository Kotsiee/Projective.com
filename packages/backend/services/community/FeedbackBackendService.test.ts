import { assert, assertEquals, assertFalse } from "@std/assert";
import type { SupabaseClient } from "supabaseClient";
import { FeedbackBoardQuerySchema, type FeedbackIdeaRow } from "@projective/types/community";
import { ANONYMOUS_READER, type ReadActor } from "../read-actor.ts";
import { FeedbackBackendService } from "./FeedbackBackendService.ts";
import { FEEDBACK_SEARCH_POOL } from "./feedback-model.ts";
import { FEEDBACK_DEMO_IDEAS, FEEDBACK_DEMO_PEOPLE } from "./feedback-fixtures.ts";
import { fixtureUserId, resetFeedbackStore } from "./feedback-store.ts";

/**
 * The service over the fixture road — the same code path the live road runs, with the store standing
 * in for the doors. Every test resets the store, so none depends on another's writes.
 */

const NOW = new Date("2026-10-17T12:00:00Z");
const FIXTURE = { source: "fixture" as const, now: NOW };
const q = (raw: Record<string, unknown> = {}) => FeedbackBoardQuerySchema.parse(raw);

function as(key: keyof typeof FEEDBACK_DEMO_PEOPLE): ReadActor {
	const id = FEEDBACK_DEMO_PEOPLE[key].userId;
	return { userId: id, contextId: id, contextType: "personal" };
}

const demo = (key: string) => FEEDBACK_DEMO_IDEAS.find((i) => i.key === key)!;

// #region Reading
Deno.test("a guest reads the public board, never an idea under review or archived", async () => {
	resetFeedbackStore();
	const res = await FeedbackBackendService.board(q(), ANONYMOUS_READER, FIXTURE);
	assert(res.ok && res.data);
	const statuses = new Set(res.data.ideas.map((i) => i.status));
	assertFalse(statuses.has("backlog"));
	assertFalse(statuses.has("archived"));
	assertEquals(res.data.counts, {
		all: 12,
		under_review: 0,
		planned: 5,
		in_progress: 3,
		shipped: 4,
	});
	assertEquals(res.data.viewer.signedIn, false);
	assertEquals(res.data.now, NOW.toISOString());
	assert(res.data.ideas.every((i) => !i.viewerVoted && !i.isOwn));
});

Deno.test("an author also reads their own idea under review, and nobody else's", async () => {
	resetFeedbackStore();
	const res = await FeedbackBackendService.board(
		q({ status: "under_review" }),
		as("theo"),
		FIXTURE,
	);
	assert(res.ok && res.data);
	assertEquals(res.data.ideas.map((i) => i.slug), [demo("tip-after-approval").slug]);
	assert(res.data.ideas[0].isOwn);
	assertEquals(res.data.counts.under_review, 1);
	assertEquals(res.data.counts.all, 13);
});

Deno.test("Top orders the board by votes; the reader's own votes are folded in", async () => {
	resetFeedbackStore();
	const res = await FeedbackBackendService.board(q({ status: "planned" }), as("hannah"), FIXTURE);
	assert(res.ok && res.data);
	const counts = res.data.ideas.map((i) => i.voteCount);
	assertEquals(counts, [...counts].sort((a, b) => b - a));
	assertEquals(res.data.ideas[0].slug, demo("pause-stage").slug);
	assert(res.data.ideas.find((i) => i.slug === demo("pause-stage").slug)?.viewerVoted);
	assertFalse(res.data.ideas.find((i) => i.slug === demo("saved-replies").slug)?.viewerVoted);
});

Deno.test("the title search returns matching ideas only, best first", async () => {
	resetFeedbackStore();
	const res = await FeedbackBackendService.board(
		q({ q: "pause a stage" }),
		ANONYMOUS_READER,
		FIXTURE,
	);
	assert(res.ok && res.data);
	assertEquals(res.data.ideas[0].slug, demo("pause-stage").slug);
	assert(res.data.ideas.every((i) => /pause|stage/i.test(i.title)));
	const none = await FeedbackBackendService.board(q({ q: "a to" }), ANONYMOUS_READER, FIXTURE);
	assertEquals(none.data?.ideas, []);
});

Deno.test("one idea: history oldest first, related ideas, the author card", async () => {
	resetFeedbackStore();
	const spec = demo("named-saved-lists");
	const res = await FeedbackBackendService.idea(spec.slug, ANONYMOUS_READER, FIXTURE);
	assert(res.ok && res.data);
	assertEquals(res.data.history.map((h) => h.to), ["backlog", "ready", "in_progress", "complete"]);
	assertEquals(res.data.idea.author?.handle, "juno");
	assertEquals(res.data.idea.voteCount, spec.voters.length + 1);
	assert(res.data.related.every((r) => r.category === spec.category && r.slug !== spec.slug));
});

Deno.test("an idea under review or archived is a 404 to anyone who may not see it", async () => {
	resetFeedbackStore();
	const hidden = await FeedbackBackendService.idea(
		demo("tip-after-approval").slug,
		as("noor"),
		FIXTURE,
	);
	assertEquals(hidden.status, 404);
	const own = await FeedbackBackendService.idea(
		demo("tip-after-approval").slug,
		as("theo"),
		FIXTURE,
	);
	assertEquals(own.status, 200);
	const archived = await FeedbackBackendService.idea(
		demo("pay-outside-escrow").slug,
		as("miguel"),
		FIXTURE,
	);
	assertEquals(archived.status, 404);
});
// #endregion

// #region Writing
Deno.test("a guest cannot suggest or vote", async () => {
	resetFeedbackStore();
	const idea = await FeedbackBackendService.submit(
		{ title: "A guest idea", category: "other", impact: "A guest explains why." },
		ANONYMOUS_READER,
		FIXTURE,
	);
	assertEquals(idea.status, 401);
	const vote = await FeedbackBackendService.vote(
		demo("pause-stage").slug,
		true,
		ANONYMOUS_READER,
		FIXTURE,
	);
	assertEquals(vote.status, 401);
});

Deno.test("a suggestion enters Under review, self-voted, and shows only on its author's board", async () => {
	resetFeedbackStore();
	const res = await FeedbackBackendService.submit(
		{
			title: "Export my invoices as one PDF",
			category: "escrow_payments",
			impact: "My accountant asks.",
		},
		as("noor"),
		FIXTURE,
	);
	assertEquals(res.status, 201);
	assert(res.data);
	assertEquals([res.data.idea.status, res.data.idea.voteCount, res.data.idea.viewerVoted], [
		"backlog",
		1,
		true,
	]);
	assertEquals(res.data.idea.author?.handle, "noor");
	const mine = await FeedbackBackendService.board(
		q({ status: "under_review" }),
		as("noor"),
		FIXTURE,
	);
	assertEquals(mine.data?.ideas.map((i) => i.slug), [res.data.idea.slug]);
	const theirs = await FeedbackBackendService.board(
		q({ status: "under_review" }),
		as("juno"),
		FIXTURE,
	);
	assertEquals(theirs.data?.ideas.length, 0);
});

Deno.test("a contact detail is refused field by field, before anything is stored", async () => {
	resetFeedbackStore();
	const res = await FeedbackBackendService.submit(
		{
			title: "Email me at ada@example.com",
			category: "other",
			impact: "Or ring 07700 900123 for details.",
			body: "Nothing to hide here.",
		},
		as("noor"),
		FIXTURE,
	);
	assertEquals(res.status, 422);
	assertEquals(Object.keys(res.errors ?? {}).sort(), ["impact", "title"]);
	const mine = await FeedbackBackendService.board(
		q({ status: "under_review" }),
		as("noor"),
		FIXTURE,
	);
	assertEquals(mine.data?.ideas.length, 0);
});

Deno.test("the sixth suggestion in a day is a 429 with when to retry", async () => {
	resetFeedbackStore();
	for (let i = 1; i <= 5; i++) {
		const res = await FeedbackBackendService.submit(
			{ title: `Probe idea number ${i}`, category: "other", impact: "Probing the daily limit." },
			as("chloe"),
			FIXTURE,
		);
		assertEquals(res.status, 201);
	}
	const sixth = await FeedbackBackendService.submit(
		{ title: "Probe idea number 6", category: "other", impact: "One past the daily limit." },
		as("chloe"),
		FIXTURE,
	);
	assertEquals(sixth.status, 429);
	assertEquals(typeof sixth.details?.retryAt, "string");
});

Deno.test("votes are idempotent both ways and closed once an idea ships", async () => {
	resetFeedbackStore();
	const slug = demo("saved-replies").slug;
	const before = demo("saved-replies").voters.length + 1;
	const first = await FeedbackBackendService.vote(slug, true, as("chloe"), FIXTURE);
	const again = await FeedbackBackendService.vote(slug, true, as("chloe"), FIXTURE);
	assertEquals([first.data?.voteCount, again.data?.voteCount], [before + 1, before + 1]);
	const off = await FeedbackBackendService.vote(slug, false, as("chloe"), FIXTURE);
	const offAgain = await FeedbackBackendService.vote(slug, false, as("chloe"), FIXTURE);
	assertEquals([off.data?.voteCount, offAgain.data?.voteCount], [before, before]);
	const shipped = await FeedbackBackendService.vote(
		demo("pin-messages").slug,
		true,
		as("chloe"),
		FIXTURE,
	);
	assertEquals(shipped.status, 409);
	const hidden = await FeedbackBackendService.vote(
		demo("hide-rate-in-search").slug,
		true,
		as("chloe"),
		FIXTURE,
	);
	assertEquals(hidden.status, 404);
});

Deno.test("the fixture road has no operator, so moderation is refused for everyone", async () => {
	resetFeedbackStore();
	const res = await FeedbackBackendService.moderate(
		demo("tip-after-approval").slug,
		{ status: "ready" },
		as("priya"),
		FIXTURE,
	);
	assertEquals(res.status, 403);
});

Deno.test("a development stub session's id folds onto a stable uuid, so its ideas stay its own", async () => {
	resetFeedbackStore();
	const stub: ReadActor = { userId: "u-alice", contextId: "u-alice", contextType: "personal" };
	assertEquals(fixtureUserId("u-alice"), fixtureUserId("u-alice"));
	const res = await FeedbackBackendService.submit(
		{ title: "A stub session's idea", category: "other", impact: "Written by a stub session." },
		stub,
		FIXTURE,
	);
	assertEquals(res.status, 201);
	assert(res.data?.idea.isOwn);
	const mine = await FeedbackBackendService.board(q({ status: "under_review" }), stub, FIXTURE);
	assertEquals(mine.data?.ideas.length, 1);
});
// #endregion

// #region The live road's title search
/**
 * A stand-in for the `community` schema over PostgREST that honours the board's one query shape —
 * `in` · `or(title.ilike…)` · `order` · `limit` — and the counts RPC, recording each `limit` asked.
 */
function stubLiveClient(
	rows: FeedbackIdeaRow[],
): { client: () => SupabaseClient; limits: number[] } {
	const limits: number[] = [];
	function query() {
		let result = [...rows];
		const orders: Array<{ column: keyof FeedbackIdeaRow; ascending: boolean }> = [];
		const builder = {
			select: () => builder,
			in(column: keyof FeedbackIdeaRow, values: readonly unknown[]) {
				result = result.filter((row) => values.includes(row[column]));
				return builder;
			},
			or(expression: string) {
				const words = expression.split(",").map((part) =>
					part.replace(/^title\.ilike\.\*|\*$/g, "")
				);
				result = result.filter((row) => words.some((w) => row.title.toLowerCase().includes(w)));
				return builder;
			},
			order(column: keyof FeedbackIdeaRow, options: { ascending: boolean }) {
				orders.push({ column, ascending: options.ascending });
				return builder;
			},
			limit(n: number) {
				limits.push(n);
				const sorted = [...result].sort((a, b) => {
					for (const { column, ascending } of orders) {
						const x = a[column] as number | string;
						const y = b[column] as number | string;
						if (x !== y) return (x < y ? -1 : 1) * (ascending ? 1 : -1);
					}
					return 0;
				});
				return Promise.resolve({ data: sorted.slice(0, n), error: null });
			},
		};
		return builder;
	}
	const db = {
		from: () => query(),
		rpc: () => Promise.resolve({ data: { ready: rows.length }, error: null }),
	};
	return { client: () => ({ schema: () => db }) as unknown as SupabaseClient, limits };
}

function liveRow(n: number, title: string, votes: number): FeedbackIdeaRow {
	const at = new Date(NOW.getTime() - n * 86_400_000).toISOString();
	return {
		id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
		slug: `fbk-${"abcdefghjk"[n]}${"23456789a"}`,
		title,
		impact: "Why this matters to the people who asked for it.",
		body: null,
		category: "projects",
		status: "ready",
		author_id: null,
		vote_count: votes,
		team_response: null,
		team_response_at: null,
		created_at: at,
		updated_at: at,
		status_changed_at: at,
		archived_at: null,
	};
}

Deno.test("live: a title search ranks a bounded pool before the limit, so the best match is never cut", async () => {
	// Five popular ideas share one word with the search; the one that matches it whole has one vote.
	const rows = [
		liveRow(1, "Stage templates for repeat projects", 50),
		liveRow(2, "Stage deadlines on the calendar", 40),
		liveRow(3, "Stage comments for the whole team", 30),
		liveRow(4, "Stage budgets in my own currency", 20),
		liveRow(5, "Stage files in one place", 10),
		liveRow(6, "Pause a stage without cancelling it", 1),
	];
	const live = stubLiveClient(rows);
	const res = await FeedbackBackendService.board(
		q({ q: "Pause a stage without cancelling", limit: 4 }),
		ANONYMOUS_READER,
		{ source: "live", now: NOW, client: live.client },
	);
	assert(res.ok && res.data);
	assertEquals(live.limits, [FEEDBACK_SEARCH_POOL]);
	assertEquals(res.data.ideas.length, 4);
	assertEquals(res.data.ideas[0].title, "Pause a stage without cancelling it");
	// The rest follow by votes, exactly as the fixture road ranks them.
	assertEquals(res.data.ideas.slice(1).map((i) => i.voteCount), [50, 40, 30]);
});

Deno.test("live: a board read without a search still asks for exactly its limit", async () => {
	const live = stubLiveClient([liveRow(1, "Stage templates for repeat projects", 5)]);
	const res = await FeedbackBackendService.board(
		q({ status: "planned", limit: 7 }),
		ANONYMOUS_READER,
		{ source: "live", now: NOW, client: live.client },
	);
	assert(res.ok && res.data);
	assertEquals(live.limits, [7]);
	assertEquals(res.data.ideas.length, 1);
});
// #endregion
