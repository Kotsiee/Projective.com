/**
 * Coverage of the two-identifier addressing model, and of the create that now has to produce
 * something openable.
 *
 * The whole class of defect here is silent. A uuid satisfies `ck_projects_slug_shape`, so a resolver
 * that matches it against the slug returns a clean, unlogged 404; a store keyed by one identifier and
 * read by the other returns a project with none of its owner's edits; and a create that shapes a slug
 * and persists nothing returns `201` and a URL that answers 404. None of the three throws, and none is
 * visible to a type-checker or to a source-reading review — which is exactly why they are asserted
 * here rather than reasoned about.
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import type { ReadActor } from "../read-actor.ts";
import { allProjects } from "./fixtures.ts";
import { findProject } from "./query.ts";
import { findProjectDetail } from "./detail-fixtures.ts";
import { findProjectSetup } from "./setup-fixtures.ts";
import { findProjectOverview } from "./overview-fixtures.ts";
import { isProjectKeyUuid, matchesProjectKey, UUID_RE } from "./project-identity.ts";
import { ProjectBackendService } from "./ProjectBackendService.ts";
import { resetWriteStore } from "./write-store.ts";

/** A signed-in actor with no live access, so every path under test answers from the fixtures. */
function actor(userId = "u-owner"): ReadActor {
	return {
		userId,
		contextType: "personal",
		contextId: userId,
		accessToken: "",
	} as ReadActor;
}

/**
 * The payload of a result that must have succeeded.
 *
 * `ServiceResult.ok` is a plain boolean, not a discriminant, so `data` stays optional however many
 * times a test asserts the flag. This narrows once and reports the service's own refusal message when
 * it did not — which is the thing a reader needs and a bare "undefined" hides.
 */
function expectData<T>(result: { ok: boolean; data?: T; message?: string }, what: string): T {
	assert(
		result.ok && result.data !== undefined,
		`${what}: ${result.message ?? "no data returned"}`,
	);
	return result.data;
}

/** The first fixture row, which carries both a uuid and a readable slug. */
function sample() {
	const row = allProjects()[0];
	assert(row, "the fixture corpus is empty, so nothing below can be addressed");
	return row;
}

// #region Shape
Deno.test("a lowercase uuid satisfies the slug CHECK — which is why the branch cannot be skipped", () => {
	const uuid = crypto.randomUUID();
	assert(
		/^[a-z0-9-]{1,96}$/.test(uuid),
		'If a uuid did not satisfy ck_projects_slug_shape, an `.eq("slug", <uuid>)` would be an ' +
			"obvious mistake. It does, so the query is legal and silently matches nothing forever.",
	);
	assert(isProjectKeyUuid(uuid));
});

Deno.test("the shape test tells a readable slug apart from a key", () => {
	assert(!isProjectKeyUuid("aurora-rebrand"));
	assert(!isProjectKeyUuid(""));
	// Version-agnostic on purpose: the question is "will Postgres accept this", not "which RFC variant".
	assert(UUID_RE.test("11111111-1111-1111-8111-111111111101"));
	assert(UUID_RE.test("11111111-1111-4111-8111-111111111101".toUpperCase()));
});

Deno.test("matchesProjectKey answers to both identifiers and to nothing else", () => {
	const row = { id: crypto.randomUUID(), slug: "aurora-rebrand" };
	assert(matchesProjectKey(row, row.id));
	assert(matchesProjectKey(row, row.slug));
	assert(!matchesProjectKey(row, "aurora-rebrand-2"));
	assert(!matchesProjectKey(row, ""));
});
// #endregion

// #region Fixture roots
Deno.test("every fixture read resolves the SAME project from its uuid and from its slug", () => {
	for (const row of allProjects()) {
		assertEquals(findProject(row.id)?.slug, row.slug, `findProject missed ${row.id}`);
		assertEquals(findProjectDetail(row.id)?.slug, row.slug, `findProjectDetail missed ${row.id}`);

		// Setup and overview compose the two roots above, so they are what proves the widening actually
		// reaches the surfaces rather than only the lookups.
		const bySlug = findProjectSetup(row.slug);
		const byId = findProjectSetup(row.id);
		assertEquals(byId, bySlug, `findProjectSetup disagrees between ${row.id} and ${row.slug}`);

		assertEquals(
			findProjectOverview(row.id),
			findProjectOverview(row.slug),
			`findProjectOverview disagrees between ${row.id} and ${row.slug}`,
		);
	}
});

Deno.test("a setup resolved by uuid still reports its own readable slug, not the uuid", () => {
	const row = sample();
	const setup = findProjectSetup(row.id);
	assert(setup);
	assertEquals(setup.id, row.id);
	assertEquals(setup.slug, row.slug);
});
// #endregion

// #region Create
Deno.test("create refuses without an identity — owner_user_id is what RLS checks", async () => {
	resetWriteStore();
	const result = await ProjectBackendService.create({
		title: "Website refresh",
		format: "pipeline",
		currency: "GBP",
		baselineAmountCents: 12_000,
		scopeType: "personal",
		scopeId: "",
	}, actor(""));
	assertEquals(result.ok, false);
	assertEquals(result.status, 401);
});

Deno.test("a created project can immediately be OPENED by the id the client navigates to", async () => {
	resetWriteStore();
	const who = actor();
	const created = await ProjectBackendService.create({
		title: "Website refresh",
		format: "pipeline",
		currency: "GBP",
		baselineAmountCents: 12_000,
		scopeType: "personal",
		scopeId: "",
	}, who);

	const made = expectData(created, "create refused");
	assert(UUID_RE.test(made.id), "the client navigates to this, so it must be a real uuid");

	// The whole point of the write-store branch: without it this is a 404 on a URL the create just
	// handed out, and the modal reports success while producing nothing anybody can open.
	const opened = expectData(
		await ProjectBackendService.setup(made.id, who),
		"the created project could not be read back by its own id",
	).setup;
	assertEquals(opened.title, "Website refresh");
	assertEquals(opened.status, "draft");

	// TWO facts, two fields. The INTENT is `public` — that is what somebody creating a project to hire
	// against is asking for, and the Rules dropdown has to be able to show it. The ROW is `unlisted`,
	// and stays that way until the owner publishes: if these ever collapse onto one value, editing any
	// part of the Terms section puts a draft with an empty description onto Explore.
	assertEquals(opened.rules.visibility, "public");
	assertEquals(opened.liveVisibility, "unlisted");
	assertEquals(opened.budget.currency, "GBP");

	// One root stage, mirroring what the live insert provisions, priced from the baseline — a pipeline's
	// baseline is a per-ticket RATE and belongs on the stage, never on the project budget.
	assertEquals(opened.stages.length, 1);
	assertEquals(opened.stages[0].unitPriceCents, 12_000);
	assertEquals(opened.budget.amountCents, null);

	// And by its readable address too, since both are handed back.
	const bySlug = expectData(await ProjectBackendService.setup(made.slug, who), "slug read failed");
	assertEquals(bySlug.setup.id, made.id);
});

Deno.test("a one-off's baseline is the PROJECT budget, not a per-ticket rate", async () => {
	resetWriteStore();
	const who = actor();
	const created = await ProjectBackendService.create({
		title: "Logo refresh",
		format: "one_off",
		currency: "USD",
		baselineAmountCents: 250_000,
		scopeType: "personal",
		scopeId: "",
	}, who);
	const made = expectData(created, "create refused");
	const opened = expectData(
		await ProjectBackendService.setup(made.id, who),
		"the one-off could not be read back",
	).setup;
	assertEquals(opened.budget.amountCents, 250_000);
	assertEquals(opened.structure, "one_off");
});

Deno.test("two projects of the same name get two addresses — projects_slug_key is global", async () => {
	resetWriteStore();
	const who = actor();
	const input = {
		title: "Website refresh",
		format: "pipeline" as const,
		currency: "GBP",
		baselineAmountCents: null,
		scopeType: "personal" as const,
		scopeId: "",
	};
	const first = expectData(await ProjectBackendService.create(input, who), "first create refused");
	const second = expectData(
		await ProjectBackendService.create(input, who),
		"second create refused",
	);
	assertNotEquals(first.slug, second.slug);
	assertNotEquals(first.id, second.id);
	for (const slug of [first.slug, second.slug]) {
		assert(
			/^[a-z0-9-]{1,96}$/.test(slug),
			`"${slug}" violates ck_projects_slug_shape, so the live insert would be refused`,
		);
	}
});

Deno.test("a title with no Latin letters still produces a legal, routable slug", async () => {
	resetWriteStore();
	const who = actor();
	for (const title of ["!!!", "設計プロジェクト", "— — —"]) {
		const created = await ProjectBackendService.create({
			title,
			format: "pipeline",
			currency: "GBP",
			baselineAmountCents: null,
			scopeType: "personal",
			scopeId: "",
		}, who);
		const made = expectData(created, `create refused the title ${JSON.stringify(title)}`);
		assert(
			/^[a-z0-9-]{1,96}$/.test(made.slug),
			`${JSON.stringify(title)} produced "${made.slug}", which the shape CHECK refuses`,
		);
	}
});

Deno.test("a created draft accepts its own first save, and the edit survives both addresses", async () => {
	resetWriteStore();
	const who = actor();
	const created = await ProjectBackendService.create({
		title: "Website refresh",
		format: "pipeline",
		currency: "GBP",
		baselineAmountCents: null,
		scopeType: "personal",
		scopeId: "",
	}, who);
	const made = expectData(created, "create refused");

	const saved = expectData(
		await ProjectBackendService.updateProject(made.id, { title: "Website refresh 2026" }, who),
		"a freshly created draft refused its own first save",
	);
	assertEquals(saved.setup.title, "Website refresh 2026");

	// Read back through the OTHER identifier. Keyed naively, the edit would be stored under the uuid
	// and looked up under the slug, and the owner's save would vanish from the page that made it.
	const bySlug = expectData(await ProjectBackendService.setup(made.slug, who), "slug read failed");
	assertEquals(bySlug.setup.title, "Website refresh 2026");
});

Deno.test("an edit saved through the uuid is visible when the project is reached by slug", async () => {
	resetWriteStore();
	const who = actor();
	const row = sample();

	expectData(
		await ProjectBackendService.updateProject(row.id, { title: "Renamed" }, who),
		"the fixture project refused a save addressed by its uuid",
	);

	const bySlug = expectData(await ProjectBackendService.setup(row.slug, who), "slug read failed");
	assertEquals(bySlug.setup.title, "Renamed");
});

Deno.test("a stub-created project belongs to its creator and to nobody else", async () => {
	resetWriteStore();
	const mine = actor("u-owner");
	const theirs = actor("u-stranger");
	const created = await ProjectBackendService.create({
		title: "Private draft",
		format: "pipeline",
		currency: "GBP",
		baselineAmountCents: null,
		scopeType: "personal",
		scopeId: "",
	}, mine);
	const made = expectData(created, "create refused");

	const seen = await ProjectBackendService.setup(made.id, theirs);
	assertEquals(seen.ok, false, "another viewer could open a draft held in this viewer's own store");
	assertEquals(seen.status, 404);
});
// #endregion
