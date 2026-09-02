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
 * The same shape covers the second failure class this wizard invites, and the one no type checker
 * can see: a field collected by the form, carried through six layers, and dropped at the last. Every
 * new term is therefore asserted by round trip — written on the create, read back off the setup
 * projection — rather than by inspecting the payload builder.
 *
 * They exercise the STUB branch, which is the default (`PROJECTS_BACKEND_LIVE` ships off) and the one
 * a developer runs against. The live branch is covered by execution against a real Postgres, which a
 * unit test cannot stand in for — an RPC's behaviour is not knowable from the TypeScript that calls
 * it. What IS shared between the two branches, and therefore worth pinning here, is the format
 * mapping, the slug derivation and every refusal in `validateCreate`, because all of them are pure
 * and all of them are consulted by the live path too.
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
 * `CreateProjectSchema.parse` fills every field the wizard did not override, so the tests exercise
 * the values a real request carries and a new field with a default cannot silently leave the payload
 * builder stale. The parameter is the schema's INPUT type for the same reason: a stage overridden as
 * `{ name: "Discovery" }` is what the wire actually admits, and requiring a complete stage here would
 * make the tests state seventeen values none of them is about.
 */
function payloadOf(
	overrides: Partial<z.input<typeof CreateProjectSchema>> = {},
): CreateProject {
	return CreateProjectSchema.parse({
		title: "Northwind Rebrand",
		scope: "<p>A full brand refresh.</p>",
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

Deno.test("a created project resolves by its uuid as well as by its slug", async () => {
	resetWriteStore();
	const created = await ProjectBackendService.create(payloadOf(), ALICE);
	assert(created.data);

	// The live path resolves both — `resolveProjectRef` tries the slug and falls back to the primary
	// key — so a store keyed by slug alone answered 404 for the id half of what the create had just
	// returned, in the mode that ships by default. The two branches must agree on what an identifier is.
	const byId = await ProjectBackendService.setup(created.data.id, ALICE);
	assert(byId.ok, `setup(${created.data.id}) did not resolve: ${byId.message}`);
	assertEquals(byId.data?.setup.slug, created.data.slug);

	const detail = await ProjectBackendService.detail(created.data.id, ALICE);
	assert(detail.ok, "the sidebar projection must resolve by id too");
	assertEquals(detail.data?.detail.slug, created.data.slug);

	// The deep-link prefetch reads the same store, so it must answer for both halves as well.
	const item = await ProjectBackendService.item(created.data.slug, ALICE);
	assert(item.ok, `item(${created.data.slug}) did not resolve: ${item.message}`);
	assertEquals(item.data?.item.id, created.data.id);
	const itemById = await ProjectBackendService.item(created.data.id, ALICE);
	assert(itemById.ok, "the feed row must resolve by id too");
	assertEquals(itemById.data?.item.slug, created.data.slug);
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

Deno.test("the stages toggle is what the second column records", () => {
	// The wizard offers two types and a toggle, not three types. `hasStages` is never a column — it
	// folds into `structure_variation`, and `hasStagesFor` reads it back out, so the pair cannot
	// disagree with the stage list the way a real boolean beside it could.
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

Deno.test("turning stages off is honoured all the way to the stored structure", async () => {
	resetWriteStore();
	// Inert is the failure to watch for: resolving the pair without the toggle made every create land
	// on the with-stages structure regardless of what the wizard was showing.
	const off = await createAndRead({ format: "one_off", hasStages: false, stages: [] });
	assertEquals(off.setup.structure, "single_task");

	const on = await createAndRead({ format: "one_off", hasStages: true, title: "Verdant Refresh" });
	assertEquals(on.setup.structure, "one_off");
});

Deno.test("a Direct Deliverable is staffed by roles and asks for no stages", async () => {
	resetWriteStore();
	const { setup } = await createAndRead({
		format: "direct_deliverable",
		stages: [],
		roles: [{ name: "Illustrator", skills: ["vector"] }],
	});

	assertEquals(setup.structure, "single_task");
	assertEquals(setup.roles.length, 1);
	assertEquals(setup.roles[0].skills, ["vector"]);
	// A role budget is a decision the owner has not taken. Zero would say the seat is free and would
	// satisfy the pricing step with a number nobody typed.
	assertEquals(setup.roles[0].budgetCents, null);
	// The ladder's required step swaps from `stages` to `roles` on this structure — the whole reason
	// the structure axis exists — so a roles-only project must be able to satisfy it.
	const roleStep = setup.steps.find((step) => step.key === "roles");
	assert(roleStep, "a single_task project must have a roles step");
	assertEquals(roleStep.done, true);
});
// #endregion

// #region The implicit stage
Deno.test("a project that names no stage is still given one", async () => {
	resetWriteStore();
	const { setup } = await createAndRead({ stages: [] });

	// `projects.create_project` mints this unconditionally, and the stub has to as well or flipping
	// the gate changes what a create MEANS. A project with no stage has nothing for a ticket to sit
	// in, nothing for escrow to price against, no room in the channel tree, and
	// `projects.set_project_status` refuses to activate it because it counts stages.
	assertEquals(setup.stages.length, 1);
	assertEquals(setup.stages[0].name, "Delivery");
	assertEquals(setup.stages[0].order, 0);
	// It carries the project's own brief: this stage IS the single unit of delivery, and seeding it
	// blank would ask the author to retype what they have just typed.
	assertEquals(setup.stages[0].description, "<p>A full brand refresh.</p>");
});

Deno.test("the implicit stage inherits a FIXED price and never a spending cap", async () => {
	resetWriteStore();
	const fixed = await createAndRead({
		stages: [],
		budget: { budgetType: "fixed_price", amountCents: 250_000, currency: "GBP" },
	});
	assertEquals(fixed.setup.stages[0].unitPriceCents, 250_000);

	// `hourly_cap` is a ceiling on spend, not the cost of one ticket, and
	// `finance.fn_hold_ticket_escrow` reads this column as an amount to hold — so copying a cap here
	// would escrow the ceiling as though it were the fee.
	const capped = await createAndRead({
		title: "Capped Engagement",
		stages: [],
		budget: { budgetType: "hourly_cap", amountCents: 250_000, currency: "GBP" },
	});
	assertEquals(capped.setup.stages[0].unitPriceCents, null);
});

Deno.test("a project that names stages is given exactly those", async () => {
	resetWriteStore();
	const { setup } = await createAndRead({
		stages: [{ name: "Discovery" }, { name: "Design" }],
	});
	assertEquals(setup.stages.map((stage) => stage.name), ["Discovery", "Design"]);
	assertEquals(setup.stages.map((stage) => stage.order), [0, 1]);
	// Ids are minted from the store's own monotonic sequence rather than numbered by position, so a
	// stage added later can never be issued a key one of these already holds.
	assertNotEquals(setup.stages[0].id, setup.stages[1].id);
});
// #endregion

// #region Visibility is earned, never asked for
Deno.test("a create never publishes, however complete it arrives", async () => {
	resetWriteStore();
	// Fully satisfying the ladder in ONE payload: title, format (always done), a priced stage, and a
	// stage list. So this is not a test of an impossible precondition — the cap is doing real work.
	const { setup } = await createAndRead({
		visibility: "public",
		stages: [{ name: "Delivery", unitPriceCents: 120_000 }],
	});

	assertEquals(setup.previewReady, true, "the ladder must actually be satisfied here");
	// `projects.create_project` hardcodes `unlisted` and ignores the payload, because the function is
	// EXECUTE-granted to `authenticated` and a caller reaching it directly was once able to publish a
	// project in the act of naming it. Publishing is a later, deliberate write through the setup path.
	assertEquals(setup.rules.visibility, "unlisted");
});

Deno.test("a request NARROWER than the create ceiling is honoured", async () => {
	resetWriteStore();
	// The cap is about REACH: it stops a create making a project more discoverable than `unlisted`,
	// so refusing an author's stricter choice would be the cap working against what it protects.
	const { setup } = await createAndRead({
		visibility: "invite_only",
		stages: [{ name: "Delivery", unitPriceCents: 120_000 }],
	});
	assertEquals(setup.rules.visibility, "invite_only");
});

Deno.test("an incomplete project is unlisted whatever it asked for", async () => {
	resetWriteStore();
	const { setup } = await createAndRead({ visibility: "public", stages: [], budget: null });
	assertEquals(setup.previewReady, false);
	assertEquals(setup.rules.visibility, "unlisted");
});
// #endregion

// #region Every term survives the round trip
Deno.test("every engagement term the wizard collects is readable back", async () => {
	resetWriteStore();
	const { setup } = await createAndRead({
		currency: "GBP",
		ipOwnershipMode: "licensed_use",
		portfolioDisplayRights: "embargoed",
		languages: ["English", "Portuguese"],
		locations: ["Portugal"],
		allowDeadlineBonuses: true,
		format: "pipeline",
	});

	assertEquals(setup.budget.currency, "GBP");
	assertEquals(setup.rules.ipOwnershipMode, "licensed_use");
	assertEquals(setup.rules.portfolioDisplayRights, "embargoed");
	assertEquals(setup.rules.languageRequirement, ["English", "Portuguese"]);
	assertEquals(setup.rules.locationRestriction, ["Portugal"]);
	assertEquals(setup.rules.allowDeadlineBonuses, true);
	// The RPC upper-cases what it is sent, so the stub has to as well or the same project reads back
	// in a different case either side of the gate.
	const lowered = payloadOf();
	lowered.currency = "gbp";
	const created = await ProjectBackendService.create(lowered, ALICE);
	const read = await ProjectBackendService.setup(created.data!.slug, ALICE);
	assertEquals(read.data?.setup.budget.currency, "GBP");
});

Deno.test("the NDA pair is stored as ONE answer, never two that can disagree", async () => {
	resetWriteStore();
	const none = await createAndRead({ ndaMode: "none", title: "No NDA" });
	assertEquals(none.setup.rules.ndaMode, "none");
	assertEquals(none.setup.rules.ndaRequired, false);

	const standard = await createAndRead({ ndaMode: "platform_standard", title: "Standard NDA" });
	assertEquals(standard.setup.rules.ndaMode, "platform_standard");
	// The legacy boolean is DERIVED, so a reader that only knows it still gets the right answer.
	assertEquals(standard.setup.rules.ndaRequired, true);
	assertEquals(standard.setup.rules.ndaDocumentId, null);

	const doc = "11111111-2222-4333-8444-555555555555";
	const custom = await createAndRead({
		ndaMode: "custom",
		ndaDocumentId: doc,
		title: "Custom NDA",
	});
	assertEquals(custom.setup.rules.ndaDocumentId, doc);

	// `ck_projects_nda_document` refuses a document under any other mode, so switching the mode has to
	// drop the reference rather than leave an instrument pointed at by an engagement that never cites it.
	const orphan = await createAndRead({
		ndaMode: "platform_standard",
		ndaDocumentId: doc,
		title: "Orphaned Document",
	});
	assertEquals(orphan.setup.rules.ndaDocumentId, null);
});

Deno.test("every per-stage field the wizard collects is readable back", async () => {
	resetWriteStore();
	const { setup } = await createAndRead({
		stages: [
			{ name: "Discovery" },
			{
				name: "Design",
				description: "<p>Two concepts.</p>",
				unitPriceCents: 90_000,
				milestone: "2 weeks",
				tasks: ["Moodboard", "Concepts"],
				skills: ["UI design"],
				requiresFiles: false,
				seatLimit: null,
				parallel: true,
				dependsOnStageIndex: 0,
				lagDays: 3,
				ndaOverride: true,
				allowedFileCategories: ["Image", "Vector"],
				allowedFileExtensions: ["png", "svg"],
				durationMode: "relative_duration",
				durationDays: 14,
			},
		],
	});

	const design = setup.stages[1];
	assertEquals(design.description, "<p>Two concepts.</p>");
	assertEquals(design.unitPriceCents, 90_000);
	assertEquals(design.milestone, "2 weeks");
	assertEquals(design.tasks, ["Moodboard", "Concepts"]);
	assertEquals(design.skills, ["UI design"]);
	assertEquals(design.requiresFiles, false);
	// `null` is UNLIMITED, not "unset". Folding the two together would silently cap a stage the owner
	// deliberately left open.
	assertEquals(design.seatLimit, null);
	assertEquals(design.parallel, true);
	assertEquals(design.dependsOnStageIndex, 0);
	assertEquals(design.lagDays, 3);
	assertEquals(design.ndaOverride, true);
	assertEquals(design.allowedFileCategories, ["Image", "Vector"]);
	assertEquals(design.allowedFileExtensions, ["png", "svg"]);
	assertEquals(design.durationMode, "relative_duration");
	assertEquals(design.durationDays, 14);

	// And a stage the author configured NOTHING on takes the create payload's own defaults, which are
	// the column defaults — a file IS required unless the owner says otherwise, and the seat cap stands
	// at three.
	const discovery = setup.stages[0];
	assertEquals(discovery.requiresFiles, true);
	assertEquals(discovery.seatLimit, 3);
	assertEquals(discovery.durationMode, "no_due_date");
	assertEquals(discovery.allowedFileCategories, []);
});
// #endregion

// #region Field-keyed refusals
/**
 * Every refusal the wizard has to be able to point at.
 *
 * Table-driven because the property under test is the same in each row and it is the KEY, not the
 * sentence: a 422 whose error key is not a control the step rail knows about is a message with
 * nowhere to render, which is how a form comes to refuse a save and highlight nothing.
 */
const REFUSALS: ReadonlyArray<{
	name: string;
	field: string;
	build: () => CreateProject;
}> = [
	{
		name: "a blank title",
		field: "title",
		build: () => payloadOf({ title: "   " }),
	},
	{
		name: "a currency that is not a 3-letter code",
		field: "currency",
		build: () => {
			const input = payloadOf();
			input.currency = "Dollars";
			return input;
		},
	},
	{
		name: "a deadline bonus on a one-off",
		field: "allowDeadlineBonuses",
		build: () => payloadOf({ format: "one_off", allowDeadlineBonuses: true }),
	},
	{
		name: "stages turned off with a list behind them",
		field: "hasStages",
		build: () => payloadOf({ hasStages: false, stages: [{ name: "A" }, { name: "B" }] }),
	},
	{
		name: "an NDA document that is not an id",
		field: "ndaMode",
		build: () => payloadOf({ ndaMode: "custom", ndaDocumentId: "not-a-uuid" }),
	},
	{
		name: "an attachment that is not an id",
		field: "attachmentIds",
		build: () => payloadOf({ attachmentIds: ["not-a-uuid"] }),
	},
	{
		name: "a stage with no name",
		field: "stageName",
		build: () => payloadOf({ stages: [{ name: " " }] }),
	},
	{
		name: "a negative stage price",
		field: "stageUnitPrice",
		build: () => {
			const input = payloadOf({ stages: [{ name: "Design" }] });
			input.stages[0].unitPriceCents = -1;
			return input;
		},
	},
	{
		name: "a seat cap below one",
		field: "stageSeatLimit",
		build: () => {
			const input = payloadOf({ stages: [{ name: "Design" }] });
			input.stages[0].seatLimit = 0;
			return input;
		},
	},
	{
		name: "a stage that waits on itself",
		field: "stageDependsOn",
		build: () => payloadOf({ stages: [{ name: "Design", dependsOnStageIndex: 0 }] }),
	},
	{
		name: "a dependency on a stage the project does not have",
		field: "stageDependsOn",
		build: () => payloadOf({ stages: [{ name: "Design", dependsOnStageIndex: 4 }] }),
	},
];

for (const refusal of REFUSALS) {
	Deno.test(`${refusal.name} is refused against \`${refusal.field}\``, async () => {
		resetWriteStore();
		const created = await ProjectBackendService.create(refusal.build(), ALICE);
		assertEquals(created.ok, false, `${refusal.name} was accepted`);
		assertEquals(created.status, 422);
		assert(created.errors, "a refusal must name the control it is about");
		assert(
			refusal.field in created.errors,
			`expected an error on \`${refusal.field}\`, got ${JSON.stringify(created.errors)}`,
		);
	});
}

Deno.test("a refused create writes nothing", async () => {
	resetWriteStore();
	const refused = await ProjectBackendService.create(
		payloadOf({ title: "Ghost Project", format: "one_off", allowDeadlineBonuses: true }),
		ALICE,
	);
	assertEquals(refused.ok, false);
	// The refusal runs before either branch, so there is nothing to roll back — and the feed must not
	// be showing a project the caller was told it could not create.
	const feed = await ProjectBackendService.list(feedParams(), ALICE);
	assertEquals(feed.data?.items.some((item) => item.title === "Ghost Project"), false);
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
		payloadOf({ stages: [{ name: "Discovery" }, { name: "Design" }] }),
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

// #region The surface the create navigates to can be used
Deno.test("a freshly created project can be saved from the setup form", async () => {
	resetWriteStore();
	const created = await ProjectBackendService.create(payloadOf(), ALICE);
	assert(created.data);

	// The stub save resolved its base from the FIXTURE corpus only, so the setup form's very first
	// save on a freshly created project answered "No project found" — on the surface the create had
	// just navigated the owner to.
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

	// A soft archive nobody can see having happened is the failure to guard against: the row must
	// leave the feed the moment it is archived.
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
