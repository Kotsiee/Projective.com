/**
 * Coverage of the single-address model, and of the create that has to produce something openable.
 *
 * The whole class of defect here is silent. A create that hands back an identifier the routes do not
 * accept returns `201` and a URL that answers 404; a store keyed by one identifier and read by another
 * returns a project with none of its owner's edits; and a slug that moves when the title moves breaks
 * every link built on it with no error anywhere. None of the three throws, and none is visible to a
 * type-checker or to a source-reading review — which is exactly why they are asserted here rather than
 * reasoned about.
 *
 * This file used to assert the OPPOSITE of several of the tests below, because a project used to be
 * addressable by its uuid as well as by a readable slug. That model is gone; the tests that pinned it
 * are inverted rather than deleted, so the reversal is visible to whoever reads them next.
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { isSlug, mintSlug, slugPattern } from "@projective/types/slugs";
import type { ReadActor } from "../read-actor.ts";
import { allProjects } from "./fixtures.ts";
import { findProject } from "./query.ts";
import { findProjectDetail } from "./detail-fixtures.ts";
import { findProjectSetup } from "./setup-fixtures.ts";
import { findProjectOverview } from "./overview-fixtures.ts";
import { isProjectSlug, matchesProjectKey } from "./project-identity.ts";
import { UUID_RE } from "./live-support.ts";
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

/** The first fixture row. */
function sample() {
	const row = allProjects()[0];
	assert(row, "the fixture corpus is empty, so nothing below can be addressed");
	return row;
}

const BASE_CREATE = {
	format: "pipeline" as const,
	currency: "GBP",
	baselineAmountCents: null,
	scopeType: "personal" as const,
	scopeId: "",
};

// #region Shape
Deno.test("a uuid can no longer be mistaken for a project address", () => {
	// THE INVERSION. A lowercase uuid satisfies the OLD `^[a-z0-9-]{1,96}$` slug CHECK, which is what
	// made `.eq("slug", <uuid>)` a legal query that silently matched nothing forever, and what forced
	// every resolver to branch on the shape of its own route segment. The prefixed form is what removes
	// the overlap — so if this ever fails, every one of those branches needs to come back.
	const uuid = crypto.randomUUID();
	assert(/^[a-z0-9-]{1,96}$/.test(uuid), "a uuid still satisfies the OLD permissive shape");
	assert(!isProjectSlug(uuid), "a uuid must not satisfy the project slug pattern");
});

Deno.test("the shape test admits a real slug and refuses everything adjacent to one", () => {
	assert(isProjectSlug(mintSlug("project")));
	assert(!isProjectSlug("aurora-rebrand"), "a title-derived slug is no longer an address");
	assert(!isProjectSlug(""));
	assert(!isProjectSlug("prj-"), "the prefix alone is not an address");
	// Namespaced, so a stage address handed to a project route is refused rather than queried. Both are
	// well-formed slugs; only one of them names a project.
	assert(!isProjectSlug(mintSlug("stage")));
	assert(!isProjectSlug(mintSlug("service")));
	assert(!isProjectSlug(mintSlug("session")));
});

Deno.test("matchesProjectKey answers to the slug and to nothing else", () => {
	const row = { id: crypto.randomUUID(), slug: mintSlug("project") };
	assert(matchesProjectKey(row, row.slug));
	// The inversion again, on the fixture side: the stub must not be more permissive than the live
	// query, or a URL works in development and 404s in production.
	assert(!matchesProjectKey(row, row.id), "the uuid must not resolve a project");
	assert(!matchesProjectKey(row, ""));
});
// #endregion

// #region Fixture roots
Deno.test("every fixture project carries a canonical address", () => {
	const rows = allProjects();
	assert(rows.length > 0);
	const seen = new Set<string>();
	for (const row of rows) {
		assert(
			isProjectSlug(row.slug),
			`fixture "${row.slug}" is a shape ck_projects_slug_shape refuses, so the live path could ` +
				"never produce it and a developer on fixtures never sees a real address",
		);
		assert(!seen.has(row.slug), `duplicate fixture slug ${row.slug}`);
		seen.add(row.slug);
	}
});

Deno.test("every fixture read resolves by slug, and none of them resolves by uuid", () => {
	for (const row of allProjects()) {
		assertEquals(findProject(row.slug)?.slug, row.slug, `findProject missed ${row.slug}`);
		assertEquals(
			findProjectDetail(row.slug)?.slug,
			row.slug,
			`findProjectDetail missed ${row.slug}`,
		);
		assert(findProjectSetup(row.slug), `findProjectSetup missed ${row.slug}`);
		assert(findProjectOverview(row.slug), `findProjectOverview missed ${row.slug}`);

		// The hard cut, asserted at every root rather than at the one that happens to be checked first.
		// Falsiness rather than a specific `null`/`undefined`: the four roots differ on which absent
		// value they return, and pinning that here would test their internals rather than the rule.
		assert(!findProject(row.id), `findProject still answers to the uuid ${row.id}`);
		assert(!findProjectDetail(row.id), `findProjectDetail still answers to ${row.id}`);
		assert(!findProjectSetup(row.id), `findProjectSetup still answers to ${row.id}`);
		assert(!findProjectOverview(row.id), `findProjectOverview still answers to ${row.id}`);
	}
});
// #endregion

// #region Create
Deno.test("create refuses without an identity — owner_user_id is what RLS checks", async () => {
	resetWriteStore();
	const result = await ProjectBackendService.create({
		...BASE_CREATE,
		title: "Website refresh",
		baselineAmountCents: 12_000,
	}, actor(""));
	assertEquals(result.ok, false);
	assertEquals(result.status, 401);
});

Deno.test("a created project can immediately be OPENED by the address the client navigates to", async () => {
	resetWriteStore();
	const who = actor();
	const made = expectData(
		await ProjectBackendService.create({
			...BASE_CREATE,
			title: "Website refresh",
			baselineAmountCents: 12_000,
		}, who),
		"create refused",
	);

	// The client navigates to the SLUG. It used to navigate to the uuid, which after the hard cut is a
	// 404 on a URL a successful create just handed out — the single most expensive way to get this
	// wrong, because the write succeeded and only the address is broken.
	assert(isProjectSlug(made.slug), `"${made.slug}" is not a routable address`);
	assert(UUID_RE.test(made.id), "the row id is still a uuid; it is simply no longer an address");

	const opened = expectData(
		await ProjectBackendService.setup(made.slug, who),
		"the created project could not be read back by the address the client was given",
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

	// And the uuid opens nothing, so the two addresses cannot drift back apart.
	assertEquals((await ProjectBackendService.setup(made.id, who)).status, 404);
});

Deno.test("a one-off's baseline is the PROJECT budget, not a per-ticket rate", async () => {
	resetWriteStore();
	const who = actor();
	const made = expectData(
		await ProjectBackendService.create({
			...BASE_CREATE,
			title: "Logo refresh",
			format: "one_off",
			currency: "USD",
			baselineAmountCents: 250_000,
		}, who),
		"create refused",
	);
	const opened = expectData(
		await ProjectBackendService.setup(made.slug, who),
		"the one-off could not be read back",
	).setup;
	assertEquals(opened.budget.amountCents, 250_000);
	assertEquals(opened.structure, "one_off");
});

Deno.test("two projects of the same name get two addresses — projects_slug_key is global", async () => {
	resetWriteStore();
	const who = actor();
	const input = { ...BASE_CREATE, title: "Website refresh" };
	const first = expectData(await ProjectBackendService.create(input, who), "first create refused");
	const second = expectData(
		await ProjectBackendService.create(input, who),
		"second create refused",
	);
	assertNotEquals(first.slug, second.slug);
	assertNotEquals(first.id, second.id);
	for (const slug of [first.slug, second.slug]) {
		assert(isProjectSlug(slug), `"${slug}" violates ck_projects_slug_shape`);
	}
});

Deno.test("the address bears no trace of the title it was created under", async () => {
	resetWriteStore();
	const who = actor();
	// Titles that a slugifier handles badly, plus one it handles perfectly. All four must produce the
	// same SHAPE, because none of them is an input to it — which is the property that makes an empty
	// slugification, a non-Latin script and a 200-character title all non-events rather than edge cases.
	for (const title of ["!!!", "設計プロジェクト", "— — —", "Website Refresh"]) {
		const made = expectData(
			await ProjectBackendService.create({ ...BASE_CREATE, title }, who),
			`create refused the title ${JSON.stringify(title)}`,
		);
		assert(
			isProjectSlug(made.slug),
			`${JSON.stringify(title)} produced "${made.slug}", which the shape CHECK refuses`,
		);
		const body = made.slug.slice("prj-".length).toLowerCase();
		for (const word of title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3)) {
			assert(!body.includes(word), `"${made.slug}" carries "${word}" out of its own title`);
		}
	}
});

Deno.test("RENAMING a project does not move its address", async () => {
	resetWriteStore();
	const who = actor();
	const made = expectData(
		await ProjectBackendService.create({ ...BASE_CREATE, title: "Website refresh" }, who),
		"create refused",
	);

	const saved = expectData(
		await ProjectBackendService.updateProject(made.slug, { title: "Something else entirely" }, who),
		"a freshly created draft refused its own first save",
	);
	assertEquals(saved.setup.title, "Something else entirely");
	// The point of the whole migration: the URL the owner is standing on still works after the rename
	// that a title-derived slug would have invalidated.
	assertEquals(saved.setup.slug, made.slug);

	const reopened = expectData(
		await ProjectBackendService.setup(made.slug, who),
		"the address stopped resolving after a rename",
	);
	assertEquals(reopened.setup.title, "Something else entirely");
});

Deno.test("an edit saved against a fixture project is visible when it is read back", async () => {
	resetWriteStore();
	const who = actor();
	const row = sample();

	expectData(
		await ProjectBackendService.updateProject(row.slug, { title: "Renamed" }, who),
		"the fixture project refused a save addressed by its slug",
	);

	const reread = expectData(await ProjectBackendService.setup(row.slug, who), "slug read failed");
	assertEquals(reread.setup.title, "Renamed");
	assertEquals(reread.setup.slug, row.slug);
});

Deno.test("a stub-created project belongs to its creator and to nobody else", async () => {
	resetWriteStore();
	const mine = actor("u-owner");
	const theirs = actor("u-stranger");
	const made = expectData(
		await ProjectBackendService.create({ ...BASE_CREATE, title: "Private draft" }, mine),
		"create refused",
	);

	const seen = await ProjectBackendService.setup(made.slug, theirs);
	assertEquals(seen.ok, false, "another viewer could open a draft held in this viewer's own store");
	assertEquals(seen.status, 404);
});
// #endregion

// #region Namespaces
Deno.test("the four entity namespaces cannot be confused with one another", () => {
	// One slug of each kind, checked against every pattern. A prefix that overlapped — or a pattern
	// that forgot to anchor — would let a stage address resolve a project, which is a cross-table
	// lookup that returns nothing and reads as a missing row rather than as a wrong URL.
	const entities = ["project", "stage", "service", "session"] as const;
	for (const owner of entities) {
		const value = mintSlug(owner);
		for (const other of entities) {
			assertEquals(
				slugPattern(other).test(value),
				owner === other,
				`${value} (${owner}) matched the ${other} pattern`,
			);
		}
		assert(isSlug(value), "a minted slug must be recognised without naming its entity");
	}
});
// #endregion
