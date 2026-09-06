import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	blankStage,
	countsAsOnboarded,
	CREATED_PUBLISH_VISIBILITY,
	DEFAULT_PROJECT_BUDGET,
	DEFAULT_PROJECT_RULES,
	hasStages,
	liveVisibilityFor,
	lockedStagePriceIds,
	ONBOARDED_ASSIGNMENT_EXCLUDED,
	previewReady,
	pricedAtProjectLevel,
	pricedStages,
	priceLockReasonFor,
	pricingSatisfied,
	PROJECT_PRICE_LOCK_REASON,
	projectOnboarded,
	projectPriceLocked,
	type ProjectSetupPatch,
	type ProjectSetupStep,
	type ProjectSetupStepsInput,
	reconcileSetup,
	setupCompleteness,
	setupSteps,
	shapeLocked,
	STAGE_PRICE_LOCK_REASON,
	stagePredecessorOptions,
	structureForStages,
	wouldCycle,
} from "./setup.ts";

/**
 * The setup ladder's rules, pinned.
 *
 * Every assertion here is a CLAIM THE PRODUCT MAKES to a project owner — how far along they are, and
 * whether the thing they are about to publish is ready to be seen. Getting one wrong does not break a
 * layout; it prints a confident percentage beside a gate that disagrees with it, which is the class of
 * defect a type checker cannot see and a source-reading review reads straight past.
 */

const base: ProjectSetupStepsInput = {
	title: "",
	format: "pipeline",
	structure: "standard",
	description: "",
	budget: DEFAULT_PROJECT_BUDGET,
	stages: [],
	roles: [],
	rules: DEFAULT_PROJECT_RULES,
};

/**
 * A stage in its as-created state.
 *
 * Built from the SSOT's own {@link blankStage} rather than as a literal, so a field added to
 * {@link StageSetupSchema} cannot leave this fixture behind. A hand-written literal here would fail
 * to compile on every schema growth and tempt the next author to paste in a default the schema does
 * not actually use — which is how a test comes to pin a shape the product never produces.
 */
const stage = blankStage("stage-1", "Concepts", 0);

const role = {
	id: "role-1",
	name: "Illustrator",
	skills: [] as string[],
	description: "",
	budgetCents: null as number | null,
};

/** A priced stage, for the rules that count primary figures rather than the presence of a stage. */
const priced = (id: string, order: number, cents: number | null) => ({
	...blankStage(id, `Stage ${order + 1}`, order),
	unitPriceCents: cents,
});

const keys = (steps: readonly ProjectSetupStep[]) => steps.map((s) => s.key);
const requiredKeys = (steps: readonly ProjectSetupStep[]) =>
	steps.filter((s) => s.required).map((s) => s.key);
const step = (steps: readonly ProjectSetupStep[], key: string) => steps.find((s) => s.key === key);

// #region The ladder's shape

Deno.test("a staged structure asks for stages and never mentions roles", () => {
	const steps = setupSteps(base);
	assertEquals(keys(steps), [
		"title",
		"format",
		"description",
		"pricing",
		"stages",
		"rules",
		"publish",
	]);
	assertEquals(requiredKeys(steps), ["title", "format", "pricing", "stages"]);
});

Deno.test("a Direct Deliverable asks for ROLES instead of stages", () => {
	const steps = setupSteps({ ...base, format: "one_off", structure: "single_task" });
	// A Direct Deliverable takes no stages at all, so a Stages row would be a requirement its owner
	// could never satisfy.
	assertFalse(keys(steps).includes("stages"));
	assertEquals(requiredKeys(steps), ["title", "format", "pricing", "roles"]);
});

Deno.test("a session keeps the stage rule unchanged — a session IS the stage list", () => {
	const steps = setupSteps({ ...base, format: "session" });
	assertEquals(requiredKeys(steps), ["title", "format", "pricing", "stages"]);
	assertEquals(step(steps, "stages")?.label, "Sessions");
});

Deno.test("the staffing row is named for the format it belongs to", () => {
	assertEquals(step(setupSteps(base), "stages")?.label, "Stages");
	assertEquals(step(setupSteps({ ...base, format: "one_off" }), "stages")?.label, "Milestones");
	assertEquals(
		step(setupSteps({ ...base, format: "one_off", structure: "single_task" }), "roles")?.label,
		"Team roles",
	);
});

// #endregion

// #region What counts as done

Deno.test("format is satisfied from creation — the baseline the create modal pre-fills", () => {
	// It carries a default at the modal, so it is a fact about the project rather than an errand.
	assertEquals(step(setupSteps(base), "format")?.done, true);
	assertEquals(step(setupSteps(base), "format")?.required, true);
});

Deno.test("a title of whitespace is not a title", () => {
	assertEquals(step(setupSteps({ ...base, title: "   " }), "title")?.done, false);
	assertEquals(step(setupSteps({ ...base, title: "Rebrand" }), "title")?.done, true);
});

Deno.test("an emptied rich-text editor does not tick the description off", () => {
	// An emptied RichTextEditor emits markup, not "". Trimming alone would call this described.
	assertEquals(
		step(setupSteps({ ...base, description: "<p><br></p>" }), "description")?.done,
		false,
	);
	assertEquals(
		step(setupSteps({ ...base, description: "<p>&nbsp;</p>" }), "description")?.done,
		false,
	);
	assertEquals(
		step(setupSteps({ ...base, description: "<p>Scope</p>" }), "description")?.done,
		true,
	);
});

Deno.test("pricing counts a priced stage; the project amount answers only for a role-staffed shape", () => {
	assertEquals(step(setupSteps(base), "pricing")?.done, false);
	assertEquals(
		step(setupSteps({ ...base, stages: [priced("s1", 0, 120_00)] }), "pricing")?.done,
		true,
	);
	// A project amount on a STAGE-BEARING shape is not the primary figure and never satisfies the rung
	// — the Budget section is not even rendered there, so counting it would tick a rung off against a
	// field the owner cannot see.
	assertEquals(
		step(
			setupSteps({ ...base, budget: { ...DEFAULT_PROJECT_BUDGET, amountCents: 500_00 } }),
			"pricing",
		)?.done,
		false,
	);
	assertEquals(
		step(
			setupSteps({
				...base,
				format: "one_off",
				structure: "single_task",
				budget: { ...DEFAULT_PROJECT_BUDGET, amountCents: 500_00 },
			}),
			"pricing",
		)?.done,
		true,
	);
});

Deno.test("the Budget section's visibility and the pricing rung read ONE predicate", () => {
	// The invariant that keeps a project from being held back by a figure the form does not render:
	// `pricedAtProjectLevel` decides whether the section exists, and `pricingSatisfied` branches on the
	// same call. Wherever the section is absent, the rung must be measuring stages instead.
	const shapes = [
		{ format: "pipeline", structure: "standard" },
		{ format: "pipeline", structure: "single_stage" },
		{ format: "one_off", structure: "one_off" },
		{ format: "one_off", structure: "single_stage" },
		{ format: "one_off", structure: "single_task" },
		{ format: "session", structure: "standard" },
	] as const;

	for (const shape of shapes) {
		const withBudgetOnly = {
			...base,
			...shape,
			budget: { ...DEFAULT_PROJECT_BUDGET, amountCents: 500_00 },
			stages: [],
			roles: [],
		};
		assertEquals(
			pricingSatisfied(withBudgetOnly),
			pricedAtProjectLevel(shape.structure),
			`${shape.format}/${shape.structure}: a project amount satisfied pricing without a Budget section`,
		);

		// And every stage-priced shape is satisfied by its stages, with no project amount at all.
		if (!pricedAtProjectLevel(shape.structure)) {
			assert(
				pricingSatisfied({ ...base, ...shape, stages: [priced("s1", 0, 120_00)] }),
				`${shape.format}/${shape.structure}: a priced stage did not satisfy pricing`,
			);
		}
	}
});

Deno.test("a stage-bearing shape with no stages yet reads as unpriced, not as project-priced", () => {
	// It used to fall through to `budget.amountCents`. Once the Budget section became conditional that
	// was a requirement with no field behind it anywhere on the page — the `stages` rung is what tells
	// the owner to add one, and this rung measures it afterwards.
	const empty = { ...base, budget: { ...DEFAULT_PROJECT_BUDGET, amountCents: 900_00 }, stages: [] };
	assertEquals(pricingSatisfied(empty), false);
	assertEquals(step(setupSteps(empty), "stages")?.done, false);
});

Deno.test("a FLAT project is priced by its ROOT stage, not by the rows the toggle left behind", () => {
	// Turning stages off does not delete them — their tickets, submissions and escrow hang off those
	// rows — so a flat project can carry several while its Details section renders one. Measuring the
	// hidden remainder held publishing back from behind a section that does not show it, which is the
	// same defect as a rung asking for a Budget field the form no longer renders.
	const flat = {
		...base,
		structure: "single_stage" as const,
		stages: [priced("root", 0, 250_00), priced("left", 1, null), priced("over", 2, null)],
	};
	assertEquals(pricedStages(flat.structure, flat.stages).map((s) => s.id), ["root"]);
	assert(pricingSatisfied(flat));
	assertEquals(step(setupSteps(flat), "pricing")?.done, true);

	// An unpriced ROOT is still unpriced: the one stage the form does show has to carry a figure.
	const noRoot = { ...flat, stages: [priced("root", 0, null), priced("left", 1, 999_00)] };
	assertFalse(pricingSatisfied(noRoot));
});

Deno.test("a STAGED run is still measured in full — every stage is on the page", () => {
	const staged = {
		...base,
		structure: "standard" as const,
		stages: [priced("a", 0, 120_00), priced("b", 1, null)],
	};
	assertEquals(pricedStages(staged.structure, staged.stages).length, 2);
	assertFalse(pricingSatisfied(staged));
});

Deno.test("a flat one-off's rolled-up budget ignores the stages it no longer shows", () => {
	// Otherwise the listing would advertise a total made partly of prices nobody can see or change.
	const setup = reconcileSetup(patchOf({
		format: "one_off",
		structure: "single_stage",
		stages: [priced("root", 0, 250_00), priced("left", 1, 800_00)],
	}));
	assertEquals(setup.budget.amountCents, 250_00);
});

Deno.test("only a Direct Deliverable is priced at the project level", () => {
	assert(pricedAtProjectLevel("single_task"));
	// A FLAT engagement prices its ROOT stage through the Details section, because
	// `finance.fn_hold_ticket_escrow` reads `unit_price_cents` and can see no figure stored elsewhere.
	assertFalse(pricedAtProjectLevel("single_stage"));
	assertFalse(pricedAtProjectLevel("standard"));
	assertFalse(pricedAtProjectLevel("one_off"));
});

Deno.test("EVERY stage must be priced, not merely one of them", () => {
	// The rule this replaced was `.some(...)`, which ticked pricing off for a run whose second
	// milestone still cost nothing — and the escrow hold on that stage's first ticket would then be
	// taken against a NULL.
	const partly = [priced("s1", 0, 120_00), priced("s2", 1, null)];
	assertEquals(step(setupSteps({ ...base, stages: partly }), "pricing")?.done, false);

	const fully = [priced("s1", 0, 120_00), priced("s2", 1, 80_00)];
	assertEquals(step(setupSteps({ ...base, stages: fully }), "pricing")?.done, true);
});

Deno.test("a rolled-up project budget cannot stand in for an unpriced stage", () => {
	// `reconcileSetup` writes the running total of the PRICED stages into `budget.amountCents`, so a
	// half-priced run carries a non-null project amount. A rule that consulted it first would read
	// that partial sum as a finished answer.
	const half = reconcileSetup(patchOf({
		format: "one_off",
		structure: "one_off",
		stages: [priced("s1", 0, 120_00), priced("s2", 1, null)],
	}));
	assertEquals(half.budget.amountCents, 120_00);
	assertEquals(step(half.steps, "pricing")?.done, false);
});

Deno.test("a named role's bonus is NOT a primary figure", () => {
	// It is an amount on top of the ticket price, so a project whose only number is a role bonus has
	// priced nothing — and must not read as priced.
	assertEquals(
		step(
			setupSteps({
				...base,
				structure: "single_task",
				roles: [{ ...role, budgetCents: 400_00 }],
			}),
			"pricing",
		)?.done,
		false,
	);
	// The role-staffed engagement's primary figure is the project's own budget.
	assertEquals(
		step(
			setupSteps({
				...base,
				structure: "single_task",
				budget: { ...DEFAULT_PROJECT_BUDGET, amountCents: 400_00 },
				roles: [role],
			}),
			"pricing",
		)?.done,
		true,
	);
});

Deno.test("an unpriced stage does not satisfy pricing — null is not zero", () => {
	// A stage silently defaulted to 0 would tick pricing off with a number nobody typed.
	assertEquals(step(setupSteps({ ...base, stages: [stage] }), "pricing")?.done, false);
});

Deno.test("publish reads the lifecycle status, and an absent status is a draft", () => {
	assertEquals(step(setupSteps(base), "publish")?.done, false);
	assertEquals(step(setupSteps({ ...base, status: "draft" }), "publish")?.done, false);
	assertEquals(step(setupSteps({ ...base, status: "active" }), "publish")?.done, true);
});

// #endregion

// #region Completeness

Deno.test("completeness is an integer in 0..100", () => {
	const cases: ProjectSetupStepsInput[] = [
		base,
		{ ...base, title: "Rebrand" },
		{ ...base, title: "Rebrand", description: "<p>Scope</p>" },
		{
			...base,
			title: "Rebrand",
			description: "<p>Scope</p>",
			status: "active",
			budget: { ...DEFAULT_PROJECT_BUDGET, amountCents: 1_000_00 },
			stages: [stage],
		},
	];
	for (const input of cases) {
		const value = setupCompleteness(setupSteps(input));
		assertEquals(Number.isInteger(value), true, `not an integer: ${value}`);
		assert(value >= 0 && value <= 100, `out of range: ${value}`);
	}
});

Deno.test("an empty ladder is 0%, not NaN", () => {
	assertEquals(setupCompleteness([]), 0);
});

Deno.test("a fully configured project reads 100%", () => {
	const steps = setupSteps({
		...base,
		title: "Rebrand",
		description: "<p>Scope</p>",
		budget: { ...DEFAULT_PROJECT_BUDGET, amountCents: 1_000_00 },
		// PRICED, and that is not incidental. A project-level amount no longer stands in for a stage
		// that costs nothing: the pricing rung asks every stage for its own figure, because that is the
		// one `finance.fn_hold_ticket_escrow` reads when a ticket on it is claimed.
		stages: [priced("stage-1", 0, 1_000_00)],
		status: "active",
	});
	assertEquals(setupCompleteness(steps), 100);
});

// #endregion

// #region The Preview gate

Deno.test("previewReady is EXACTLY every required step done", () => {
	const ready: ProjectSetupStep[] = [
		{ key: "title", label: "Title", done: true, required: true, hint: "" },
		{ key: "description", label: "Description", done: false, required: false, hint: "" },
	];
	assertEquals(previewReady(ready), true);

	const blocked: ProjectSetupStep[] = [
		{ key: "title", label: "Title", done: false, required: true, hint: "" },
		{ key: "description", label: "Description", done: true, required: false, hint: "" },
	];
	assertEquals(previewReady(blocked), false);
});

Deno.test("an incomplete project can still be previewable — the bar is not the gate", () => {
	// Description, Rules and Publish are optional, so a previewable project reads well short of 100%.
	const steps = setupSteps({
		...base,
		title: "Rebrand",
		stages: [{ ...stage, unitPriceCents: 120_00 }],
	});
	assertEquals(previewReady(steps), true);
	assert(setupCompleteness(steps) < 100);
});

Deno.test("a Direct Deliverable with no roles is NOT previewable", () => {
	const steps = setupSteps({
		...base,
		format: "one_off",
		structure: "single_task",
		title: "Poster",
		budget: { ...DEFAULT_PROJECT_BUDGET, amountCents: 200_00 },
	});
	assertEquals(previewReady(steps), false);
});

// #endregion

// #region reconcileSetup

Deno.test("reconcileSetup RE-DERIVES the trio and never believes the caller", () => {
	// A client that posts completeness: 100 over an empty project must be overruled, not trusted.
	const forged = {
		slug: "rebrand",
		title: "",
		steps: [],
		completeness: 100,
		previewReady: true,
	} as unknown as ProjectSetupPatch;

	const setup = reconcileSetup(forged);
	assert(setup.completeness < 100);
	assertEquals(setup.previewReady, false);
	assert(setup.steps.length > 0);
	assertEquals(setup.completeness, setupCompleteness(setup.steps));
	assertEquals(setup.previewReady, previewReady(setup.steps));
});

Deno.test("reconcileSetup fills a defaulted, coherent setup from nothing", () => {
	const setup = reconcileSetup({});
	assertEquals(setup.format, "pipeline");
	assertEquals(setup.structure, "standard");
	assertEquals(setup.sessionKind, "none");
	assertEquals(setup.status, "draft");
	assertEquals(setup.viewerIsClient, false);
	// A draft nobody has configured must not default to discoverable.
	assertEquals(setup.rules.visibility, "invite_only");
	assertEquals(setup.rules.ndaSource, "platform");
	assertEquals(setup.rules.ndaRequired, false);
	assertEquals(setup.rules.ndaDocumentId, null);
	assertEquals(setup.budget.amountCents, null);
});

Deno.test("a patch carrying one rule does not blank the others", () => {
	const setup = reconcileSetup(
		{
			slug: "rebrand",
			title: "Rebrand",
			rules: { ...DEFAULT_PROJECT_RULES, ndaRequired: true, ndaSource: "platform" },
		},
		{ rules: { visibility: "public" } },
	);
	assertEquals(setup.rules.visibility, "public");
	assertEquals(setup.rules.ndaRequired, true);
	assertEquals(setup.rules.ndaSource, "platform");
	assertEquals(setup.rules.ndaRequired, true);
	assertEquals(setup.rules.timelinePreset, "sequential");
});

Deno.test("a patch replaces the stage array wholesale", () => {
	// Create/update/remove reconciliation is an identity question answered against the database; two
	// arrays cannot express it, so the fold must not pretend to merge them.
	const setup = reconcileSetup(
		{ stages: [stage, { ...stage, id: "stage-2", name: "Build", order: 1 }] },
		{ stages: [{ ...stage, id: "stage-2", name: "Build", order: 0 }] },
	);
	assertEquals(setup.stages.length, 1);
	assertEquals(setup.stages[0].id, "stage-2");
});

Deno.test("reconcileSetup agrees with the standalone helpers on the same input", () => {
	const input: ProjectSetupPatch = {
		slug: "rebrand",
		title: "Rebrand",
		format: "session",
		description: "<p>Six weekly sittings.</p>",
		stages: [{ ...stage, name: "Session 1", unitPriceCents: 80_00 }],
		status: "active",
	};
	const setup = reconcileSetup(input);
	assertEquals(setup.steps, setupSteps(setup));
	assertEquals(setup.completeness, 100);
	assertEquals(setup.previewReady, true);
});

// #endregion

/** `base` as a mutable patch — its arrays are `readonly` for `setupSteps`, which only reads them. */
function patchOf(over: Partial<ProjectSetupPatch> = {}): ProjectSetupPatch {
	return {
		title: base.title,
		format: base.format,
		structure: base.structure,
		description: base.description,
		budget: base.budget,
		rules: base.rules,
		stages: [...base.stages],
		roles: [...base.roles],
		...over,
	};
}

// #region Publish intent versus live visibility
Deno.test("a draft is unlisted whatever its owner intends", () => {
	// The safety property, and the reason there are two fields at all. `liveVisibilityFor` does not
	// consult the intent on a draft, does not consult readiness, and cannot be talked out of it by a
	// payload — so no sequence of saves can put a half-written engagement on Explore.
	for (const intent of ["public", "unlisted", "invite_only"] as const) {
		assertEquals(liveVisibilityFor("draft", intent), "unlisted");
	}
});

Deno.test("publishing promotes the intent verbatim", () => {
	assertEquals(liveVisibilityFor("active", "public"), "public");
	assertEquals(liveVisibilityFor("active", "invite_only"), "invite_only");
	// And a project pulled back to draft re-hides, rather than staying on Explore under a status that
	// says it is no longer live.
	assertEquals(liveVisibilityFor("draft", "public"), "unlisted");
});

Deno.test("reconcileSetup re-derives liveVisibility and never folds it from a patch", () => {
	const draft = reconcileSetup(patchOf({
		status: "draft",
		rules: { ...DEFAULT_PROJECT_RULES, visibility: "public" },
	}));
	assertEquals(draft.rules.visibility, "public");
	assertEquals(draft.liveVisibility, "unlisted");

	// A client asserting the row is already public is overruled, exactly as `completeness` is: the
	// field is a function of the status and the intent, so a payload cannot make it disagree with the
	// status sitting beside it in the same object.
	const forged = reconcileSetup(
		patchOf({ status: "draft" }),
		{ liveVisibility: "public" } as never,
	);
	assertEquals(forged.liveVisibility, "unlisted");

	// The same intent, once the status moves, is in effect.
	const live = reconcileSetup(patchOf({
		status: "active",
		rules: { ...DEFAULT_PROJECT_RULES, visibility: "public" },
	}));
	assertEquals(live.liveVisibility, "public");
});

Deno.test("a created project's intent is public and is not DEFAULT_PROJECT_RULES", () => {
	// Two different defaults for two different situations. `invite_only` is the fallback where nobody
	// chose anything; `public` expresses the evident intent of someone who just created a project in
	// order to hire against it. Collapsing them would either hide every new project from the people
	// meant to bid on it, or make the conservative fallback stop being conservative.
	assertEquals(CREATED_PUBLISH_VISIBILITY, "public");
	assertEquals(DEFAULT_PROJECT_RULES.visibility, "invite_only");
});
// #endregion

// #region Shape control
/**
 * The Shape segments and the structure they write, pinned.
 *
 * These exist because the form's Shape handler shipped with both arguments hardcoded —
 * `structureForStages(true, "one_off")` — so every segment of every format wrote `one_off`. The
 * round-trip property below is the one that broke: pressing "Single stage" on a PIPELINE produced
 * `one_off`, which is not one of a pipeline's shapes, so the control resolved back to "Staged" and the
 * press silently set the wrong column. Each of these fails against that code.
 */
Deno.test("the toggle writes a stage-bearing structure on and a stage-less one off", () => {
	// The Shape control this replaced encoded one bit in four segments and two vocabularies. The
	// toggle asks the bit directly, and `hasStages` is the read direction — the same function the
	// section list and the ladder consult, so the three cannot disagree about what is on the page.
	for (const format of ["pipeline", "one_off"] as const) {
		assert(hasStages(structureForStages(true, format)), `${format} lost its stages when turned on`);
		assertFalse(
			hasStages(structureForStages(false, format)),
			`${format} kept its stages when turned off`,
		);
	}
});

Deno.test("a pipeline can actually become stage-less", () => {
	assertEquals(structureForStages(false, "pipeline"), "single_stage");
	assertEquals(structureForStages(true, "pipeline"), "standard");
});

Deno.test("the toggle never produces a Direct Deliverable", () => {
	// `single_task` is a STAFFING decision, not a stage-count one, and it is no longer reachable from
	// the form: a project already stored that way keeps its role editor, and turning the toggle on is
	// its one-way escape. A toggle that could write it would silently discard a role-staffed project's
	// roles on the way past.
	for (const format of ["pipeline", "one_off"] as const) {
		for (const on of [true, false]) {
			assert(
				structureForStages(on, format) !== "single_task",
				`${format}/${on} wrote single_task`,
			);
		}
	}
});
// #endregion

// #region Stage sequencing

Deno.test("a stage may never wait for itself", () => {
	const stages = [priced("a", 0, 100), priced("b", 1, 100)];
	assert(wouldCycle(stages, "a", "a"));
	assertFalse(wouldCycle(stages, "b", "a"));
});

Deno.test("a cycle is detected however long the chain", () => {
	// a <- b <- c. Pointing `a` at `c` closes the loop, and nothing on the row itself says so.
	const stages = [
		{ ...priced("a", 0, 100), startsWithId: null },
		{ ...priced("b", 1, 100), startsWithId: "a" },
		{ ...priced("c", 2, 100), startsWithId: "b" },
	];
	assert(wouldCycle(stages, "a", "c"));
	assert(wouldCycle(stages, "a", "b"));
	assertFalse(wouldCycle(stages, "c", "a"));
});

Deno.test("a graph that ALREADY contains a cycle terminates", () => {
	// Not an optimisation — it is what makes the function total. A legacy row, a concurrent edit or a
	// hand-written database change can produce this, and a validator that hangs on bad data is worse
	// than one that rejects it.
	const stages = [
		{ ...priced("a", 0, 100), startsWithId: "b" },
		{ ...priced("b", 1, 100), startsWithId: "a" },
	];
	assertFalse(wouldCycle(stages, "c", "a"));
});

Deno.test("the predecessor dropdown offers no choice that would close a loop", () => {
	const stages = [
		{ ...priced("a", 0, 100), startsWithId: null },
		{ ...priced("b", 1, 100), startsWithId: "a" },
		{ ...priced("c", 2, 100), startsWithId: "b" },
	];
	// `a` may wait for nothing here: `b` and `c` both lead back to it.
	assertEquals(stagePredecessorOptions(stages, "a").map((x) => x.id), []);
	// `c` may wait for either of the two above it.
	assertEquals(stagePredecessorOptions(stages, "c").map((x) => x.id), ["a", "b"]);
	// And never for itself.
	for (const id of ["a", "b", "c"]) {
		assertFalse(
			stagePredecessorOptions(stages, id).some((x) => x.id === id),
			`${id} was offered itself`,
		);
	}
});
// #endregion

// #region The budget roll-up

Deno.test("a one-off's project budget is the sum of its milestone fees", () => {
	const setup = reconcileSetup(patchOf({
		format: "one_off",
		structure: "one_off",
		stages: [priced("s1", 0, 120_00), priced("s2", 1, 80_00), priced("s3", 2, 50_00)],
	}));
	assertEquals(setup.budget.amountCents, 250_00);
});

Deno.test("a PIPELINE's budget is never the sum of its stage prices", () => {
	// A pipeline stage's price is a per-TICKET rate over a stage that may run fifty tickets, so the
	// sum is the cost of nothing — and `budget_amount_cents` is what the feed card and the public
	// listing read. Rolling it up here would advertise a figure nobody is being charged.
	const setup = reconcileSetup(patchOf({
		format: "pipeline",
		structure: "standard",
		stages: [priced("s1", 0, 120_00), priced("s2", 1, 80_00)],
	}));
	assertEquals(setup.budget.amountCents, null);
});

Deno.test("a session's budget is not rolled up either — its price is one sitting's rate", () => {
	const setup = reconcileSetup(patchOf({
		format: "session",
		stages: [priced("s1", 0, 60_00)],
	}));
	assertEquals(setup.budget.amountCents, null);
});

Deno.test("an unpriced run keeps whatever budget it had rather than being blanked", () => {
	// Clearing it would discard a figure the create modal legitimately collected before any stage
	// existed, on the way to storing nothing in its place.
	const setup = reconcileSetup(patchOf({
		format: "one_off",
		structure: "one_off",
		budget: { ...DEFAULT_PROJECT_BUDGET, amountCents: 900_00 },
		stages: [priced("s1", 0, null)],
	}));
	assertEquals(setup.budget.amountCents, 900_00);
});

Deno.test("a role-staffed engagement keeps its typed amount — it has no stages to sum", () => {
	const setup = reconcileSetup(patchOf({
		structure: "single_task",
		budget: { ...DEFAULT_PROJECT_BUDGET, amountCents: 400_00 },
		roles: [role],
		stages: [],
	}));
	assertEquals(setup.budget.amountCents, 400_00);
});

Deno.test("the roll-up leaves the currency and the type alone", () => {
	const setup = reconcileSetup(patchOf({
		format: "one_off",
		structure: "one_off",
		budget: { budgetType: "fixed_price", amountCents: null, currency: "EUR" },
		stages: [priced("s1", 0, 120_00)],
	}));
	assertEquals(setup.budget.currency, "EUR");
	assertEquals(setup.budget.budgetType, "fixed_price");
	assertEquals(setup.budget.amountCents, 120_00);
});
// #endregion

// #region Post-onboarding immutability
/**
 * The immutability rules, pinned.
 *
 * Each of these decides whether a client may rewrite a term somebody has already agreed to work
 * under. The failure is silent in the direction that matters: a rule that under-locks reprices a
 * freelancer's stage with nothing on any screen to say so, which is why the cases below check the
 * SHAPE of the answer rather than sampling one convenient project.
 */

/** A stage carrying providers, for the rules that count them. */
const staffed = (id: string, order: number, count: number) => ({
	...blankStage(id, `Stage ${order + 1}`, order),
	onboardedCount: count,
});

Deno.test("nobody onboarded leaves every term editable", () => {
	const stages = [staffed("s1", 0, 0), staffed("s2", 1, 0)];
	const input = { structure: "standard" as const, onboardedCount: 0 };
	assertFalse(projectOnboarded(input));
	assertFalse(shapeLocked(input));
	assertFalse(projectPriceLocked(input));
	assertEquals(lockedStagePriceIds(input, stages).size, 0);
});

Deno.test("the price lock is PER STAGE, not per project", () => {
	// The whole reason it returns a set. A run whose second milestone has been staffed must still be
	// priceable at its fourth, or staffing one stage freezes the engagement's remaining commercials.
	const stages = [staffed("s1", 0, 2), staffed("s2", 1, 0), staffed("s3", 2, 1)];
	const locked = lockedStagePriceIds({ structure: "standard", onboardedCount: 3 }, stages);
	assertEquals([...locked].sort(), ["s1", "s3"]);
});

Deno.test("the SHAPE locks on the project total, even when one stage is empty", () => {
	// Distinct from the rule above and deliberately coarser: turning a staffed pipeline flat, or
	// switching its format, strands every provider hired onto any stage — so it is the project's
	// count that decides, never an individual stage's.
	assert(shapeLocked({ onboardedCount: 1 }));
});

Deno.test("a FLAT engagement locks its root stage on the PROJECT's count", () => {
	// A flat project's root stage IS the engagement — `pricedStages` collects only that one and
	// `fn_hold_ticket_escrow` reads its price — so anybody hired anywhere was hired against it, even
	// though the stage row itself carries no assignment of its own.
	const stages = [staffed("root", 0, 0), staffed("leftover", 1, 0)];
	const locked = lockedStagePriceIds({ structure: "single_stage", onboardedCount: 1 }, stages);
	assertEquals([...locked], ["root"]);
});

Deno.test("a FLAT engagement still locks a hidden stage that has its own providers", () => {
	// Turning stages off does not delete the rows a staged run left behind — their tickets and escrow
	// hang off them — so a stage the Details section never renders can still be staffed, and the write
	// path must refuse a price change on it rather than let it be repriced out of sight.
	const stages = [staffed("root", 0, 0), staffed("hidden", 1, 2)];
	const locked = lockedStagePriceIds({ structure: "single_stage", onboardedCount: 2 }, stages);
	assertEquals([...locked].sort(), ["hidden", "root"]);
});

Deno.test("a role-staffed engagement locks its project amount and no stage", () => {
	// Its figure lives on the project row, because `single_task` is the one structure with no stage to
	// carry a price. Locking a stage there would freeze a control the form does not render.
	const input = { structure: "single_task" as const, onboardedCount: 1 };
	assert(projectPriceLocked(input));
	assertEquals(lockedStagePriceIds(input, [staffed("s1", 0, 3)]).size, 0);
});

Deno.test("a staged engagement never locks the project amount", () => {
	// The Budget section does not render for it, and on a milestone run the amount is DERIVED from the
	// stage fees — so a lock there would freeze a number nobody types and fight the roll-up.
	assertFalse(projectPriceLocked({ structure: "standard", onboardedCount: 5 }));
	assertFalse(projectPriceLocked({ structure: "one_off", onboardedCount: 5 }));
	assertFalse(projectPriceLocked({ structure: "single_stage", onboardedCount: 5 }));
});

Deno.test("the lock reason names what the reader can actually see", () => {
	// A flat project has its stage list switched off, so explaining its frozen price by naming a stage
	// points at something absent from the page.
	assertEquals(priceLockReasonFor("standard"), STAGE_PRICE_LOCK_REASON);
	assertEquals(priceLockReasonFor("one_off"), STAGE_PRICE_LOCK_REASON);
	assertEquals(priceLockReasonFor("single_stage"), PROJECT_PRICE_LOCK_REASON);
	assertEquals(priceLockReasonFor("single_task"), PROJECT_PRICE_LOCK_REASON);
});

Deno.test("an assignment status nobody recognised counts as onboarded", () => {
	// The deny-list's whole direction. `stage_assignments.status` is free text with no CHECK, so a
	// value added tomorrow must LOCK: over-locking withholds an edit somebody can ask about, and
	// under-locking reprices agreed work with nothing on screen to reveal it.
	assert(countsAsOnboarded("some_state_invented_next_year"));
	assert(countsAsOnboarded("assigned"));
	assert(countsAsOnboarded("accepted"));
	// An agreement survives the person leaving, and escrow may already have moved against it.
	assert(countsAsOnboarded("released"));
	assert(countsAsOnboarded("cancelled"));
	assert(countsAsOnboarded("completed"));
});

Deno.test("the two states where no agreement was ever reached do not lock", () => {
	assertFalse(countsAsOnboarded("declined"));
	// Decision #80 parks a blueprint-instantiated row here and documents it as the state where nobody
	// is committed to anything — counting it would price-lock a draft from birth.
	assertFalse(countsAsOnboarded("pending_funding"));
	assertEquals([...ONBOARDED_ASSIGNMENT_EXCLUDED].sort(), ["declined", "pending_funding"]);
});

Deno.test("reconcileSetup re-grafts stage counts from the base and ignores the patch", () => {
	// The un-forgeability property. A payload that asserted `onboardedCount: 0` would be unlocking the
	// very field it is trying to change, in the one function every surface derives its locks from.
	const setup = reconcileSetup(
		patchOf({ stages: [staffed("s1", 0, 4)], onboardedCount: 4 }),
		{ stages: [{ ...staffed("s1", 0, 0), unitPriceCents: 1 }], onboardedCount: 0 },
	);
	assertEquals(setup.stages[0].onboardedCount, 4);
	assertEquals(setup.onboardedCount, 4);
	// The edit itself still lands — the guard freezes a figure, it does not freeze the fold.
	assertEquals(setup.stages[0].unitPriceCents, 1);
});

Deno.test("a stage the base does not know has onboarded nobody", () => {
	// A stage added a moment ago cannot be carrying providers, and reading `undefined` as anything but
	// zero would lock a brand new row on its first render.
	const setup = reconcileSetup(
		patchOf({ stages: [staffed("s1", 0, 2)] }),
		{ stages: [staffed("s1", 0, 2), staffed("stage-draft-9", 1, 7)] },
	);
	assertEquals(setup.stages[1].onboardedCount, 0);
});
// #endregion
