import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { ArcCache, cacheKey, invalidatePrefix, tenantPrefix } from "../../core/cache.ts";
import { ProjectBackendService } from "./ProjectBackendService.ts";
import { findProjectSetup } from "./setup-fixtures.ts";
import { buildStubCard, resetWriteStore, setupPatchFrom, writeOwnerOf } from "./write-store.ts";
import type { ReadActor } from "../read-actor.ts";
import type { CommitTicket } from "@projective/types/projects";

/**
 * write-store_test — the properties the projects write path is only correct because of.
 *
 * Three of them cannot be established by reading the code. A stub that returns `ok()` and mutates
 * nothing passes every type-check and every route test, and fails the only question that matters
 * about a write — whether the change is still there on the next read. A cache that is never
 * invalidated is likewise invisible: the statement commits, the service answers `ok`, the row is
 * right, and the surface shows the old board. And an overlay keyed too loosely serves one viewer's
 * edits to another, which no single-actor test can see.
 *
 * So these tests exercise the write and then perform the READ, through the real fat service, rather
 * than asserting on the store's internals.
 */

// #region Fixtures
const SLUG = "monarch-design-system";
const CHANNEL = "general";

/** An acting identity. Distinct ids give distinct overlay buckets — the isolation under test. */
function actorOf(userId: string, contextId = ""): ReadActor {
	return { userId, contextId, contextType: "personal" };
}

const ALICE = actorOf("u-alice");
const BOB = actorOf("u-bob");

/** A minimal, valid commit payload against a real fixture stage. */
function commitOf(overrides: Partial<CommitTicket> = {}): CommitTicket {
	return {
		projectId: SLUG,
		clientId: "optimistic-1",
		title: "Audit the type ramp",
		description: "<p>Check every heading against the four registers.</p>",
		status: "backlog",
		stageId: "stage-0",
		priority: "normal",
		intensity: "standard",
		dueDate: null,
		ownerId: null,
		tasks: [],
		stages: [{
			stageId: "stage-0",
			name: "Discovery",
			order: 0,
			status: "active",
			required: true,
			brief: "",
			intensity: "standard",
			tasks: [],
			parallel: false,
			costCents: null,
			unitPriceCents: null,
		}],
		attachmentIds: [],
		...overrides,
	};
}
// #endregion

// #region Cache invalidation
Deno.test("invalidatePrefix drops a tenant's entries and leaves every other tenant's alone", () => {
	const cache = new ArcCache<string>({ maxEntries: 32, ttlMs: 60_000 });
	const mine = { userId: "u-alice", contextId: "" };
	const theirs = { userId: "u-bob", contextId: "" };

	cache.set(cacheKey(mine, "projects.board", { slug: SLUG }), "mine-board");
	cache.set(cacheKey(mine, "projects.detail", { slug: SLUG }), "mine-detail");
	cache.set(cacheKey(theirs, "projects.board", { slug: SLUG }), "theirs-board");

	invalidatePrefix(cache as unknown as ArcCache<unknown>, tenantPrefix(mine));

	assertEquals(cache.get(cacheKey(mine, "projects.board", { slug: SLUG })), undefined);
	assertEquals(cache.get(cacheKey(mine, "projects.detail", { slug: SLUG })), undefined);
	assertEquals(cache.get(cacheKey(theirs, "projects.board", { slug: SLUG })), "theirs-board");
});

Deno.test("invalidatePrefix forgets the ghost too, so a re-set cannot shift the adaptation", () => {
	// A ghost is capacity evidence — "I evicted this and I may have been wrong". After an
	// invalidation that evidence describes a value that no longer exists, and letting the next `set`
	// of the same key act on it would move `p` on the strength of a key the cache was told to forget.
	const cache = new ArcCache<string>({ maxEntries: 2, ttlMs: 60_000 });
	const mine = { userId: "u-alice", contextId: "" };
	const a = cacheKey(mine, "n", { i: 1 });

	cache.set(a, "1");
	cache.set(cacheKey(mine, "n", { i: 2 }), "2");
	cache.set(cacheKey(mine, "n", { i: 3 }), "3");

	const before = cache.stats().p;
	invalidatePrefix(cache as unknown as ArcCache<unknown>, tenantPrefix(mine));
	cache.set(a, "1-again");
	assertEquals(cache.stats().p, before);
});
// #endregion

// #region Persistence — the acceptance criterion
Deno.test("a committed ticket is on the board the next read returns", async () => {
	resetWriteStore();
	const before = await ProjectBackendService.board({ projectId: SLUG, view: "stages" }, ALICE);
	const countBefore = before.data!.page.cards.length;

	const written = await ProjectBackendService.commitTicket(commitOf(), ALICE);
	assert(written.ok, written.message);
	const card = written.data!.card;

	const after = await ProjectBackendService.board({ projectId: SLUG, view: "stages" }, ALICE);
	assertEquals(after.data!.page.cards.length, countBefore + 1);
	assert(after.data!.page.cards.some((c) => c.id === card.id));
});

Deno.test("a committed ticket is given a server id, never the client's optimistic one", async () => {
	resetWriteStore();
	const written = await ProjectBackendService.commitTicket(
		commitOf({ clientId: "optimistic-42" }),
		ALICE,
	);
	assertNotEquals(written.data!.card.id, "optimistic-42");
});

Deno.test("a moved ticket keeps its new column across a fresh board read", async () => {
	resetWriteStore();
	const board = await ProjectBackendService.board({ projectId: SLUG, view: "stages" }, ALICE);
	const target = board.data!.page.cards.find((c) => c.status === "backlog")!;

	const moved = await ProjectBackendService.moveTicket({
		projectId: SLUG,
		ticketId: target.id,
		status: "in_progress",
		stageId: "stage-1",
		sortOrder: null,
	}, ALICE);
	assert(moved.ok, moved.message);

	const after = await ProjectBackendService.board({ projectId: SLUG, view: "stages" }, ALICE);
	const reread = after.data!.page.cards.find((c) => c.id === target.id)!;
	assertEquals(reread.status, "in_progress");
	assertEquals(reread.stageId, "stage-1");
});

Deno.test("a move applies sortOrder only in the backlog lane, mirroring the ordering guard", async () => {
	// `fn_ticket_ordering_guard` RAISES when `sort_order` changes while `status <> 'backlog'`. A stub
	// that reordered anyway would accept a drag that the database refuses the day the gate flips.
	resetWriteStore();
	const board = await ProjectBackendService.board({ projectId: SLUG, view: "stages" }, ALICE);
	const target = board.data!.page.cards.find((c) => c.status === "backlog")!;

	const outside = await ProjectBackendService.moveTicket({
		projectId: SLUG,
		ticketId: target.id,
		status: "in_review",
		stageId: "stage-1",
		sortOrder: 9,
	}, ALICE);
	assertEquals(outside.data!.card.sortOrder, target.sortOrder);

	const inside = await ProjectBackendService.moveTicket({
		projectId: SLUG,
		ticketId: target.id,
		status: "backlog",
		stageId: null,
		sortOrder: 9,
	}, ALICE);
	assertEquals(inside.data!.card.sortOrder, 9);
});

Deno.test("a saved configuration survives the next setup read and re-derives the ladder", async () => {
	resetWriteStore();
	const saved = await ProjectBackendService.updateProject(
		SLUG,
		{ title: "Monarch Design System v2", status: "draft" },
		ALICE,
	);
	assert(saved.ok, saved.message);

	const reread = await ProjectBackendService.setup(SLUG, ALICE);
	assertEquals(reread.data!.setup.title, "Monarch Design System v2");
	// `publish` is a ladder row, so returning to draft must LOWER the percentage. An echoed payload
	// would have reported the old figure and the bar would disagree with the project.
	assert(reread.data!.setup.completeness < 100);
});

Deno.test("a saved title reaches the detail projection the sidebar renders", async () => {
	resetWriteStore();
	await ProjectBackendService.updateProject(SLUG, { title: "Renamed" }, ALICE);
	const detail = await ProjectBackendService.detail(SLUG, ALICE);
	assertEquals(detail.data!.detail.title, "Renamed");
});

Deno.test("archiving twice reports the instant of the first decision, not the second", async () => {
	resetWriteStore();
	const first = await ProjectBackendService.archiveProject(SLUG, {}, ALICE);
	const second = await ProjectBackendService.archiveProject(SLUG, {}, ALICE);
	assertEquals(second.data!.archivedAt, first.data!.archivedAt);
});
// #endregion

// #region Isolation
Deno.test("one viewer's stub writes are invisible to another", async () => {
	resetWriteStore();
	await ProjectBackendService.commitTicket(commitOf(), ALICE);

	const hers = await ProjectBackendService.board({ projectId: SLUG, view: "stages" }, ALICE);
	const his = await ProjectBackendService.board({ projectId: SLUG, view: "stages" }, BOB);
	assertEquals(hers.data!.page.cards.length, his.data!.page.cards.length + 1);
});

Deno.test("the overlay bucket key cannot be collided by two contexts of one user", () => {
	// The same person acting personally and acting as a team is reading two different feeds — the
	// distinction `ReadActor` exists to draw, and the one a single-field key would collapse.
	assertNotEquals(writeOwnerOf(actorOf("u", "team-a")), writeOwnerOf(actorOf("u", "team-b")));
});

Deno.test("a write is refused when nobody is signed in", async () => {
	resetWriteStore();
	const guest = actorOf("");
	const result = await ProjectBackendService.commitTicket(commitOf(), guest);
	assertEquals(result.ok, false);
	assertEquals(result.status, 401);
});
// #endregion

// #region Messages
Deno.test("a sent message lands on the latest page and not on an older cursor page", async () => {
	resetWriteStore();
	const sent = await ProjectBackendService.sendMessage({
		projectId: SLUG,
		channelId: CHANNEL,
		text: "Kicking off the audit.",
		attachmentIds: [],
		audio: null,
	}, ALICE);
	assert(sent.ok, sent.message);

	const latest = await ProjectBackendService.messages(
		{ projectId: SLUG, channelId: CHANNEL },
		ALICE,
	);
	assert(latest.data!.page.messages.some((m) => m.id === sent.data!.message.id));

	// A sent message postdates the whole channel, so folding it into a page fetched by the scroll-up
	// cursor would insert it into history it comes after — and the feed would render it twice.
	const older = await ProjectBackendService.messages(
		{ projectId: SLUG, channelId: CHANNEL, before: latest.data!.page.messages[0].id },
		ALICE,
	);
	assert(!older.data!.page.messages.some((m) => m.id === sent.data!.message.id));
});

Deno.test("a sent message is attributed to the viewer the corpus already knows", async () => {
	resetWriteStore();
	const sent = await ProjectBackendService.sendMessage({
		projectId: SLUG,
		channelId: CHANNEL,
		text: "Second note.",
		attachmentIds: [],
		audio: null,
	}, ALICE);

	const page = await ProjectBackendService.messages(
		{ projectId: SLUG, channelId: CHANNEL },
		ALICE,
	);
	const fixtureOwn = page.data!.page.messages.find((m) =>
		m.isOwn && m.id !== sent.data!.message.id
	);
	// Two faces on one person's messages inside a single conversation is what minting a second
	// identity here would produce.
	assertEquals(sent.data!.message.sender!.id, fixtureOwn!.sender!.id);
	assertEquals(sent.data!.message.sender!.avatar, fixtureOwn!.sender!.avatar);
});
// #endregion

// #region Derivation
Deno.test("a ticket's cost comes from the stage's rate, never from the payload", () => {
	// `stage-0` is priced at 40000 minor units in the corpus. A payload claiming otherwise must not
	// move the figure: a price the client sent is a price the client chose (Decision #64).
	const board = findProjectSetup(SLUG)!;
	assert(board.stages.length > 0);

	const card = buildStubCard(
		commitOf({
			stages: [{
				stageId: "stage-0",
				name: "Discovery",
				order: 0,
				status: "active",
				required: true,
				brief: "",
				intensity: "standard",
				tasks: [],
				parallel: false,
				costCents: 1,
				unitPriceCents: 1,
			}],
		}),
		[{
			id: "stage-0",
			name: "Discovery",
			order: 0,
			status: "active",
			locked: false,
			description: "",
			unitPriceCents: 40_000,
			categoryWeight: 1.2,
			members: [],
			ticketCount: 0,
			assignmentMode: "open_pull",
			maxConcurrentIntensity: null,
		}],
		undefined,
		"ticket-1",
		Date.parse("2026-08-31T12:00:00Z"),
	);

	assertEquals(card.budgetCents, 40_000);
	assertEquals(card.stages[0].unitPriceCents, 40_000);
});

Deno.test("intensity is the one lever that moves both the cost and the capacity", () => {
	const stage = {
		id: "stage-0",
		name: "Discovery",
		order: 0,
		status: "active" as const,
		locked: false,
		description: "",
		unitPriceCents: 40_000,
		categoryWeight: 1,
		members: [],
		ticketCount: 0,
		assignmentMode: "open_pull" as const,
		maxConcurrentIntensity: null,
	};
	const at = Date.parse("2026-08-31T12:00:00Z");
	const ref = {
		stageId: "stage-0",
		name: "Discovery",
		order: 0,
		status: "active" as const,
		required: true,
		brief: "",
		tasks: [],
		parallel: false,
		costCents: null,
		unitPriceCents: null,
	};

	const standard = buildStubCard(
		commitOf({ intensity: "standard", stages: [{ ...ref, intensity: "standard" }] }),
		[stage],
		undefined,
		"t-standard",
		at,
	);
	const high = buildStubCard(
		commitOf({ intensity: "high", stages: [{ ...ref, intensity: "high" }] }),
		[stage],
		undefined,
		"t-high",
		at,
	);

	assertEquals(standard.budgetCents, 40_000);
	assertEquals(high.budgetCents, 80_000);
	// The same lever moves capacity, because the two were always one axis in the spec
	// (PRODUCT_SPEC §The Weighting Engine) and are one axis here.
	assertEquals(standard.workload, 1);
	assertEquals(high.workload, 2);
});

Deno.test("an unpriced ticket reports null, never zero", () => {
	// An unknown price and a free ticket are different facts, and a footer that renders `$0` for the
	// first has answered a question nobody asked it.
	const card = buildStubCard(
		commitOf({ stages: [] }),
		[],
		undefined,
		"t-unpriced",
		Date.now(),
	);
	assertEquals(card.budgetCents, null);
	assertEquals(card.budgetLabel, null);
});

Deno.test("committing never invents escrow", async () => {
	resetWriteStore();
	const written = await ProjectBackendService.commitTicket(commitOf(), ALICE);
	assertEquals(written.data!.card.escrowHeld, false);
	assertEquals(written.data!.card.claimed, false);
	assertEquals(written.data!.card.payments.length, 0);
});
// #endregion

// #region Setup patch reconciliation
Deno.test("setupPatchFrom creates, updates and removes stages by id", () => {
	const base = findProjectSetup(SLUG)!;
	const keep = base.stages[0];

	const patch = setupPatchFrom({
		stages: [
			{ id: keep.id, unitPriceCents: 99_900 },
			{ name: "A brand new stage" },
		],
	}, base);

	assertEquals(patch.stages!.length, 2);
	// An UPDATE merges over the base row: a section that sends only a price must not blank the scope
	// prose beside it.
	assertEquals(patch.stages![0].id, keep.id);
	assertEquals(patch.stages![0].name, keep.name);
	assertEquals(patch.stages![0].unitPriceCents, 99_900);
	// A CREATE gets a minted id, never the caller's absent one.
	assertNotEquals(patch.stages![1].id, "");
	assertEquals(patch.stages![1].name, "A brand new stage");
	// Every base stage the array omitted is a REMOVE, which needs no branch — it is simply gone.
	assert(base.stages.length > 2);
});

Deno.test("a minted stage id is never reused after a removal", () => {
	const base = findProjectSetup(SLUG)!;
	const first = setupPatchFrom({ stages: [{ name: "One" }] }, base);
	const second = setupPatchFrom({ stages: [{ name: "Two" }] }, base);
	// Naming a stage after its index would hand the second stage the first one's id, and every ticket
	// pointing at the old one would silently follow the new one instead.
	assertNotEquals(first.stages![0].id, second.stages![0].id);
});

Deno.test("setupPatchFrom carries only the fields the payload actually sent", () => {
	const base = findProjectSetup(SLUG)!;
	const patch = setupPatchFrom({ title: "Only the title" }, base);
	assertEquals(patch.title, "Only the title");
	assertEquals(patch.stages, undefined);
	assertEquals(patch.rules, undefined);
	assertEquals(patch.budget, undefined);
});
// #endregion
