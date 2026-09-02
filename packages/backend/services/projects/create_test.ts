import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { ProjectBackendService } from "./ProjectBackendService.ts";
import { resetWriteStore } from "./write-store.ts";
import { findProjectSetup } from "./setup-fixtures.ts";
import { createFormatToColumns, projectSlugFrom } from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import type { CreateProject, ProjectFeedParams } from "@projective/types/projects";

/**
 * create_test — the properties a project create is only correct because of.
 *
 * The one that cannot be established by reading the code is the one that was actually broken: a
 * create that returns a slug and persists nothing type-checks, returns `ok`, and satisfies every
 * route test — and then the client navigates to that slug and reads "Project not found". So these
 * tests write through the real fat service and then perform the READ, exactly as the surface does.
 *
 * They exercise the STUB branch, which is the default (`PROJECTS_BACKEND_LIVE` ships off) and the one
 * a developer runs against. The live branch is covered by execution against a real Postgres, which a
 * unit test cannot stand in for — an RPC's behaviour is not knowable from the TypeScript that calls
 * it. What IS shared between the two branches, and therefore worth pinning here, is the format
 * mapping and the slug derivation, because both are pure and both are consulted by the live path too.
 */

// #region Fixtures
/**
 * An acting identity with NO access token.
 *
 * That absence is what selects the stub branch: `canReadLive` requires a token, so a tokenless actor
 * never reaches Postgres regardless of how the gate is set. It makes the test independent of the
 * environment it runs in, which a `PROJECTS_BACKEND_LIVE` check would not be.
 */
function actorOf(
	userId: string,
	contextId = "",
	contextType: ReadActor["contextType"] = "personal",
): ReadActor {
	return { userId, contextId, contextType };
}

const ALICE = actorOf("u-alice");
const BOB = actorOf("u-bob");

function payloadOf(overrides: Partial<CreateProject> = {}): CreateProject {
	return {
		title: "Northwind Rebrand",
		format: "pipeline",
		scopeType: "personal",
		scopeId: "",
		scope: "<p>A full brand refresh.</p>",
		budget: null,
		stages: [],
		roles: [],
		...overrides,
	};
}
/**
 * The widest feed query — `global` scope with every facet cleared.
 *
 * Deliberately unfiltered: the assertion under test is that a drafted project is IN the feed at all,
 * and a params object that happened to filter it out would make the test pass for the wrong reason.
 */
function feedParams(): ProjectFeedParams {
	return {
		q: "",
		view: "projects",
		involvement: "all",
		sort: "recent",
		scope: "global",
		scopeType: null,
		scopeId: "",
		workspaces: [],
		roles: [],
		formats: [],
		kinds: [],
		statuses: [],
		quick: [],
		requests: [],
		serviceId: "",
	};
}
// #endregion

// #region The write is visible to the read
Deno.test("a created project is readable by the slug the create returned", async () => {
	resetWriteStore();
	const created = await ProjectBackendService.create(payloadOf(), ALICE);

	assert(created.ok, created.message);
	assertEquals(created.status, 201);
	assert(created.data);

	// The whole defect in one assertion: the slug the caller navigates to must resolve.
	const read = await ProjectBackendService.setup(created.data.slug, ALICE);
	assert(read.ok, `setup(${created.data.slug}) did not resolve: ${read.message}`);
	assertEquals(read.data?.setup.title, "Northwind Rebrand");
	assertEquals(read.data?.setup.status, "draft");
});

Deno.test("a create returns BOTH identifiers, and neither is empty", async () => {
	resetWriteStore();
	const created = await ProjectBackendService.create(payloadOf(), ALICE);
	assert(created.data);
	// `id` is the durable reference a later write may use; `slug` is the address a route carries.
	// Returning one without the other forces the caller to read the row back for the half it lacks.
	assert(created.data.id.length > 0, "id must not be empty");
	assert(created.data.slug.length > 0, "slug must not be empty");
	assertNotEquals(created.data.id, created.data.slug);
});

Deno.test("an anonymous caller cannot create a project", async () => {
	resetWriteStore();
	const created = await ProjectBackendService.create(payloadOf(), actorOf(""));
	assertEquals(created.ok, false);
	assertEquals(created.status, 401);
});
// #endregion

// #region Slugs
Deno.test("two projects with the same title get different addresses", async () => {
	resetWriteStore();
	const first = await ProjectBackendService.create(payloadOf(), ALICE);
	const second = await ProjectBackendService.create(payloadOf(), ALICE);

	// `projects.projects.slug` is globally UNIQUE. Without a disambiguator the second create either
	// collides at the database or silently replaces the first in the store — which reads, from the
	// feed, as the create having renamed something rather than added anything.
	assertNotEquals(first.data?.slug, second.data?.slug);

	// And BOTH must still resolve; a disambiguated address is not a second-class one.
	const readFirst = await ProjectBackendService.setup(first.data!.slug, ALICE);
	const readSecond = await ProjectBackendService.setup(second.data!.slug, ALICE);
	assert(readFirst.ok);
	assert(readSecond.ok);
});

Deno.test("a title with nothing sluggable still yields a usable address", async () => {
	resetWriteStore();
	const created = await ProjectBackendService.create(payloadOf({ title: "!!! ???" }), ALICE);
	assert(created.data);
	// `projectSlugFrom` returns "" here on purpose, so the caller falls back to a generated address
	// rather than inventing prose the author did not write. What must NOT happen is an empty segment.
	assertEquals(projectSlugFrom("!!! ???"), "");
	assert(created.data.slug.length > 0);
	// The database's CHECK is `^[a-z0-9-]{1,96}$`, and the route interpolates the slug into a path
	// verbatim — an address the constraint would refuse is a project that exists and cannot be opened.
	assert(/^[a-z0-9-]{1,96}$/.test(created.data.slug), `unroutable slug: ${created.data.slug}`);
});

Deno.test("projectSlugFrom never emits a leading, trailing or uppercase character", () => {
	assertEquals(projectSlugFrom("  Helia   Wallet Redesign  "), "helia-wallet-redesign");
	assertEquals(projectSlugFrom("Ünïcödé"), "n-c-d");
	assertEquals(projectSlugFrom("---"), "");
	// The 80-char truncation must not leave a trailing hyphen, which the CHECK permits but which
	// produces an ugly address and a needless second form of the same name.
	const long = projectSlugFrom("a".repeat(78) + " " + "b".repeat(40));
	assert(long.length <= 80);
	assert(!long.endsWith("-"), `trailing hyphen after truncation: ${long}`);
});
// #endregion

// #region The format vocabularies
Deno.test("direct_deliverable resolves to the two columns the database actually has", () => {
	// `project_format` is ('one_off','pipeline','session') — it has NO `direct_deliverable` member,
	// so sending it straight through raises 22P02 at the insert. The reconciliation is a stored pair.
	assertEquals(createFormatToColumns("direct_deliverable"), {
		format: "one_off",
		structure: "single_task",
	});
	assertEquals(createFormatToColumns("one_off"), { format: "one_off", structure: "one_off" });
	assertEquals(createFormatToColumns("pipeline"), { format: "pipeline", structure: "standard" });
});

Deno.test("a Direct Deliverable is staffed by roles and asks for no stages", async () => {
	resetWriteStore();
	const created = await ProjectBackendService.create(
		payloadOf({
			format: "direct_deliverable",
			stages: [],
			roles: [{ name: "Illustrator", skills: ["vector"] }],
		}),
		ALICE,
	);
	assert(created.data);
	const read = await ProjectBackendService.setup(created.data.slug, ALICE);
	const setup = read.data!.setup;

	assertEquals(setup.structure, "single_task");
	assertEquals(setup.roles.length, 1);
	assertEquals(setup.roles[0].skills, ["vector"]);
	// The ladder's required step swaps from `stages` to `roles` on this structure — the whole reason
	// the structure axis exists — so a roles-only project must be able to satisfy it.
	const roleStep = setup.steps.find((step) => step.key === "roles");
	assert(roleStep, "a single_task project must have a roles step");
	assertEquals(roleStep.done, true);
});
// #endregion

// #region The page the create navigates to
Deno.test("the creator's own draft dispatches to the OWNER surface, not the member dashboard", async () => {
	resetWriteStore();
	const created = await ProjectBackendService.create(payloadOf(), ALICE);
	assert(created.data);

	// `/projects/[projectId]` chooses its surface from `detail.viewerIsClient`, and a null detail
	// defaults it to FALSE — which routes the creator to the member dashboard, whose miss body reads
	// "Project not found". So this is the assertion that separates "the row exists" from "the page the
	// browser was just sent to actually renders".
	const detail = await ProjectBackendService.detail(created.data.slug, ALICE);
	assert(detail.ok, `detail(${created.data.slug}) did not resolve: ${detail.message}`);
	assertEquals(detail.data?.detail.viewerIsClient, true);
	assertEquals(detail.data?.detail.title, "Northwind Rebrand");
	assertEquals(detail.data?.detail.id, created.data.id);
});

Deno.test("a drafted project lists no channel it cannot open", async () => {
	resetWriteStore();
	const created = await ProjectBackendService.create(
		payloadOf({
			stages: [
				{ name: "Discovery", description: "", unitPriceCents: null, milestone: "" },
				{ name: "Design", description: "", unitPriceCents: null, milestone: "" },
			],
		}),
		ALICE,
	);
	const detail = await ProjectBackendService.detail(created.data!.slug, ALICE);
	const channels = detail.data!.detail.channels;

	// The stub provisions no rooms, so it must advertise none. Listing a stage channel here made the
	// sidebar render a clickable row whose every read — messages, board, files, members — answered
	// 404: a control that reaches nothing (root CLAUDE.md §3 gate 11). The LIVE path opens each room
	// inside `create_project` and its tree is real; differing visibly from it is the honest failure.
	assertEquals(channels.general, []);
	assertEquals(channels.stages, []);
	assertEquals(channels.teams, []);
	assertEquals(channels.dms, []);

	// The stages themselves are still recorded — they are configuration, not conversation.
	const setup = await ProjectBackendService.setup(created.data!.slug, ALICE);
	assertEquals(setup.data?.setup.stages.map((s) => s.name), ["Discovery", "Design"]);
});

Deno.test("a drafted project can never shadow a fixture engagement", async () => {
	resetWriteStore();
	// `createdSetup` is consulted BEFORE the fixture corpus, so a draft landing on a fixture's slug
	// does not collide — it REPLACES a fully populated engagement with a blank draft at the same
	// address. Titling a new project after an existing one did exactly that.
	const victim = findProjectSetup("monarch-design-system");
	assert(victim, "the fixture this guards must exist");

	const created = await ProjectBackendService.create(payloadOf({ title: victim.title }), ALICE);
	assertNotEquals(created.data?.slug, victim.slug);

	const read = await ProjectBackendService.setup(victim.slug, ALICE);
	assertEquals(read.data?.setup.title, victim.title);
	// The fixture keeps its own substance, not just its name.
	assert(read.data!.setup.stages.length > 0, "the fixture must still have its stages");
});

Deno.test("a drafted project appears in the feed it was created from", async () => {
	resetWriteStore();
	const created = await ProjectBackendService.create(payloadOf(), ALICE);
	const feed = await ProjectBackendService.list(feedParams(), ALICE);
	assert(feed.ok);
	const row = feed.data?.items.find((item) => item.slug === created.data!.slug);
	assert(row, "the drafted project must appear in the feed the create button sits on");
	assertEquals(row.status, "draft");
	assertEquals(row.title, "Northwind Rebrand");
});
// #endregion

// #region Isolation
Deno.test("one viewer's created project is not visible to another", async () => {
	resetWriteStore();
	const created = await ProjectBackendService.create(payloadOf(), ALICE);
	assert(created.data);

	// The store is keyed per acting identity. A create that leaked across viewers would show one
	// person's draft in another's feed — which no single-actor test can see.
	const asBob = await ProjectBackendService.setup(created.data.slug, BOB);
	assertEquals(asBob.ok, false);
});
// #endregion
