import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { z } from "zod";
import { ProjectBackendService } from "./ProjectBackendService.ts";
import { resetWriteStore } from "./write-store.ts";
import { findProjectSetup } from "./setup-fixtures.ts";
import {
	createFormatToColumns,
	CreateProjectSchema,
	hasStagesFor,
	projectSlugFrom,
} from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import type { CreateProject, ProjectFeedParams, ProjectSetup } from "@projective/types/projects";

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
 * mapping, the slug derivation and the visibility ceiling, because all three are pure and all three
 * are consulted by the live path too.
 *
 * Quick-Init collects four facts — title, type, currency and one baseline price — so the round-trip
 * assertions are about what the SERVICE derives from them, not about a payload echoing itself back.
 * Everything else a project eventually needs is configured afterwards through `updateProject`, and
 * belongs to that path's tests rather than to this one.
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

/**
 * A create payload, defaulted by the SSOT rather than by this file.
 *
 * `CreateProjectSchema.parse` fills every field the modal did not override, so the tests exercise the
 * values a real request carries and a new field with a default cannot silently leave this builder
 * stale.
 */
function payloadOf(
	overrides: Partial<z.input<typeof CreateProjectSchema>> = {},
): CreateProject {
	return CreateProjectSchema.parse({
		title: "Northwind Rebrand",
		format: "pipeline",
		currency: "USD",
		...overrides,
	});
}

/** Create as Alice and read the configuration back, which is what the surface does on navigation. */
async function createAndRead(
	overrides: Partial<z.input<typeof CreateProjectSchema>> = {},
	actor: ReadActor = ALICE,
): Promise<{ slug: string; id: string; setup: ProjectSetup }> {
	const created = await ProjectBackendService.create(payloadOf(overrides), actor);
	assert(created.ok, created.message);
	assert(created.data);
	const read = await ProjectBackendService.setup(created.data.slug, actor);
	assert(read.ok, `setup(${created.data.slug}) did not resolve: ${read.message}`);
	return { ...created.data, setup: read.data!.setup };
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
	const { setup, slug } = await createAndRead();
	assertEquals(setup.slug, slug);
	assertEquals(setup.title, "Northwind Rebrand");
	assertEquals(setup.status, "draft");
});

Deno.test("a create returns BOTH identifiers, and neither is empty", async () => {
	resetWriteStore();
	const created = await ProjectBackendService.create(payloadOf(), ALICE);
	assert(created.data);
	assert(created.data.id.length > 0, "a create must return the row's canonical id");
	assert(created.data.slug.length > 0, "a create must return a readable address");
	assertNotEquals(created.data.id, created.data.slug);
});

Deno.test("a created project resolves by its uuid as well as by its slug", async () => {
	resetWriteStore();
	const created = await ProjectBackendService.create(payloadOf(), ALICE);
	assert(created.data);
	// The modal navigates to the UUID, because a title-derived slug moves on the first rename and the
	// owner's first act on the Stage-2 surface is usually to rename the project. A store that answered
	// only the slug would 404 the page the create had just sent the browser to.
	const byId = await ProjectBackendService.setup(created.data.id, ALICE);
	assert(byId.ok, `setup(${created.data.id}) did not resolve: ${byId.message}`);
	assertEquals(byId.data?.setup.slug, created.data.slug);
});

Deno.test("an anonymous caller cannot create a project", async () => {
	resetWriteStore();
	const created = await ProjectBackendService.create(payloadOf(), actorOf(""));
	assertEquals(created.ok, false);
	assertEquals(created.status, 401);
});
// #endregion

// #region Addresses
Deno.test("two projects with the same title get different addresses", async () => {
	resetWriteStore();
	const first = await ProjectBackendService.create(payloadOf(), ALICE);
	const second = await ProjectBackendService.create(payloadOf(), ALICE);
	assertNotEquals(first.data?.slug, second.data?.slug);
});

Deno.test("a title with nothing sluggable still yields a usable address", async () => {
	resetWriteStore();
	// `ck_projects_slug_shape` is `^[a-z0-9-]{1,96}$`, so an empty slug is a REFUSED insert rather than
	// merely an ugly one — and a title of pure punctuation or of a non-Latin script is an ordinary
	// title, not an adversarial one.
	const created = await ProjectBackendService.create(payloadOf({ title: "!!!!" }), ALICE);
	assert(created.data);
	assert(/^[a-z0-9-]{1,96}$/.test(created.data.slug), `illegal slug: ${created.data.slug}`);
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
Deno.test("each offered format maps onto the two columns the database has", async () => {
	// `ProjectCreateFormat` was narrowed to the two members `project_format` also carries, so the
	// format half of this mapping is the identity function and there is no bridge left to go stale.
	assertEquals(createFormatToColumns("one_off"), { format: "one_off", structure: "one_off" });
	assertEquals(createFormatToColumns("pipeline"), { format: "pipeline", structure: "standard" });

	resetWriteStore();
	const oneOff = await createAndRead({ format: "one_off" });
	assertEquals(oneOff.setup.format, "one_off");
	assertEquals(oneOff.setup.structure, "one_off");

	const pipeline = await createAndRead({ format: "pipeline", title: "Verdant Refresh" });
	assertEquals(pipeline.setup.format, "pipeline");
	assertEquals(pipeline.setup.structure, "standard");
});

Deno.test("the stages toggle is what the second column records", () => {
	// `hasStages` is never a column — it folds into `structure_variation`, and `hasStagesFor` reads it
	// back out, so the pair cannot disagree with the stage list the way a real boolean beside it could.
	// It is a Stage-2 control rather than a create one, which is why only the mapping is pinned here.
	assertEquals(createFormatToColumns("one_off", false), {
		format: "one_off",
		structure: "single_task",
	});
	assertEquals(createFormatToColumns("pipeline", false), {
		format: "pipeline",
		structure: "single_stage",
	});
	assertEquals(hasStagesFor("single_task"), false);
	assertEquals(hasStagesFor("single_stage"), true);
	assertEquals(hasStagesFor("standard"), true);
	assertEquals(hasStagesFor("one_off"), true);
});
// #endregion

// #region The root stage
Deno.test("every created project is given exactly one stage", async () => {
	resetWriteStore();
	const { setup } = await createAndRead({ format: "one_off" });

	// The live path provisions this inside the same create, and the stub has to as well or flipping the
	// gate changes what a create MEANS. A project with no stage has nothing for a ticket to sit in,
	// nothing for escrow to price against, and `projects.set_project_status` refuses to activate it
	// because it counts stages.
	assertEquals(setup.stages.length, 1);
	assertEquals(setup.stages[0].order, 0);
	// Named for what it IS on a one-off, because "Stage 1" on an engagement that will only ever have
	// one stage describes a sequence that does not exist.
	assertEquals(setup.stages[0].name, "Delivery");

	const pipeline = await createAndRead({ format: "pipeline", title: "Helia Wallet" });
	assertEquals(pipeline.setup.stages[0].name, "Stage 1");
});

Deno.test("the baseline price lands where its format means it", async () => {
	resetWriteStore();
	// A one-off's baseline is the whole escrow figure, so it is the PROJECT budget as well as the
	// single stage's price.
	const oneOff = await createAndRead({ format: "one_off", baselineAmountCents: 250_000 });
	assertEquals(oneOff.setup.budget.amountCents, 250_000);
	assertEquals(oneOff.setup.stages[0].unitPriceCents, 250_000);

	// A pipeline's is a per-TICKET rate. Writing a rate into the project budget would tick the pricing
	// ladder step off against a number that means something else.
	const pipeline = await createAndRead({
		format: "pipeline",
		baselineAmountCents: 120_000,
		title: "Atlas Pipeline",
	});
	assertEquals(pipeline.setup.budget.amountCents, null);
	assertEquals(pipeline.setup.stages[0].unitPriceCents, 120_000);
});

Deno.test("an unpriced create stays unpriced rather than free", async () => {
	resetWriteStore();
	// `null` and `0` are different facts: zero is a decision somebody took, and the pricing rung counts
	// a number the owner supplied. A defaulted zero would satisfy it silently.
	const { setup } = await createAndRead({ format: "one_off" });
	assertEquals(setup.budget.amountCents, null);
	assertEquals(setup.stages[0].unitPriceCents, null);
	assertEquals(setup.steps.find((step) => step.key === "pricing")?.done, false);
});
// #endregion

// #region Visibility is earned, never asked for
Deno.test("a create records the intent and publishes nothing", async () => {
	resetWriteStore();
	const { setup } = await createAndRead({ format: "one_off", baselineAmountCents: 120_000 });

	// The two-column model. `rules.visibility` is what the owner will want ONCE it publishes, and
	// somebody creating a project in order to hire against it is asking to be found — so the intent is
	// `public`, and it is safe to default precisely because it is not yet in effect.
	assertEquals(setup.rules.visibility, "public");
	// Where the row actually sits. A draft is `unlisted` unconditionally: the promotion consults the
	// STATUS, not the intent and not the ladder, which is what stops a half-written engagement from
	// reaching Explore however complete it arrives.
	assertEquals(setup.liveVisibility, "unlisted");
});

Deno.test("a complete draft is still a draft", async () => {
	resetWriteStore();
	const { setup } = await createAndRead({ format: "one_off", baselineAmountCents: 120_000 });
	// Publishing is an act the owner performs, not a threshold they cross — so readiness must not
	// promote anything on its own.
	assertEquals(setup.previewReady, true, "the ladder must actually be satisfied here");
	assertEquals(setup.status, "draft");
	assertEquals(setup.liveVisibility, "unlisted");
});
// #endregion

// #region What the payload itself refuses
Deno.test("the create schema refuses what the database would refuse later", () => {
	// Enforced by the SSOT rather than by the route, so the modal, the thin route and any other caller
	// reach the same verdict — and the author is told what is wrong while the field is still in front of
	// them, instead of receiving a `23514` they cannot act on.
	const refused = (input: Record<string, unknown>) => CreateProjectSchema.safeParse(input).success;

	assertEquals(refused({ title: "  ", format: "pipeline", currency: "USD" }), false);
	assertEquals(refused({ title: "Ok", format: "pipeline", currency: "USD" }), false);
	assertEquals(refused({ title: "Fine", format: "pipeline", currency: "Dollars" }), false);
	assertEquals(
		refused({ title: "Fine", format: "session", currency: "USD" }),
		false,
		"a session is a service composed provider-side, never a project a client posts",
	);

	// The currency is STORED, and `projects.projects` carries `CHECK (currency ~ '^[A-Z]{3}$')`, so a
	// lower-cased code is normalised on the way in rather than refused or kept as typed.
	assertEquals(payloadOf({ currency: "gbp" }).currency, "GBP");
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
	const created = await ProjectBackendService.create(payloadOf(), ALICE);
	const detail = await ProjectBackendService.detail(created.data!.slug, ALICE);
	const channels = detail.data!.detail.channels;

	// The stub provisions no rooms, so it must advertise none. Listing a stage channel here made the
	// sidebar render a clickable row whose every read — messages, board, files, members — answered 404:
	// a control that reaches nothing (root CLAUDE.md §3 gate 11). The LIVE path opens each room inside
	// `create_stage` and its tree is real; differing visibly from it is the honest failure.
	assertEquals(channels.general, []);
	assertEquals(channels.stages, []);
	assertEquals(channels.teams, []);
	assertEquals(channels.dms, []);

	// The stage itself is still recorded — it is configuration, not conversation.
	const setup = await ProjectBackendService.setup(created.data!.slug, ALICE);
	assertEquals(setup.data?.setup.stages.length, 1);
});

Deno.test("a drafted project can never shadow a fixture engagement", async () => {
	resetWriteStore();
	// `createdSetup` is consulted BEFORE the fixture corpus, so a draft landing on a fixture's slug
	// would not collide — it would REPLACE a fully populated engagement with a blank draft at the same
	// address. The minted address carries a random suffix for exactly this reason.
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

// #region The surface the create navigates to can be used
Deno.test("a freshly created project can be saved from the setup form", async () => {
	resetWriteStore();
	const created = await ProjectBackendService.create(payloadOf(), ALICE);
	assert(created.data);

	// The stub save resolved its base from the FIXTURE corpus only, so the setup form's very first save
	// on a freshly created project answered "No project found" — on the surface the create had just
	// navigated the owner to.
	const saved = await ProjectBackendService.updateProject(
		created.data.slug,
		{ title: "Northwind Rebrand II", description: "<p>Sharpened.</p>" },
		ALICE,
	);
	assert(saved.ok, `save did not land: ${saved.message}`);
	assertEquals(saved.data?.setup.title, "Northwind Rebrand II");

	// And the edit survives the read the surface performs next.
	const read = await ProjectBackendService.setup(created.data.slug, ALICE);
	assertEquals(read.data?.setup.title, "Northwind Rebrand II");
	assertEquals(read.data?.setup.description, "<p>Sharpened.</p>");
});

Deno.test("a freshly created project can be archived", async () => {
	resetWriteStore();
	const created = await ProjectBackendService.create(payloadOf(), ALICE);
	assert(created.data);

	const archived = await ProjectBackendService.archiveProject(created.data.slug, {}, ALICE);
	assert(archived.ok, `archive did not land: ${archived.message}`);

	// A soft archive nobody can see having happened is the failure to guard against: the row must leave
	// the feed the moment it is archived.
	const feed = await ProjectBackendService.list(feedParams(), ALICE);
	assertEquals(feed.data?.items.some((item) => item.slug === created.data!.slug), false);
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
