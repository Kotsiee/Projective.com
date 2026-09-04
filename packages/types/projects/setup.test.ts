import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	blankStage,
	CREATED_PUBLISH_VISIBILITY,
	DEFAULT_PROJECT_BUDGET,
	DEFAULT_PROJECT_RULES,
	hasStages,
	liveVisibilityFor,
	previewReady,
	type ProjectSetupPatch,
	type ProjectSetupStep,
	type ProjectSetupStepsInput,
	reconcileSetup,
	setupCompleteness,
	setupSteps,
	shapeFor,
	shapeOptionsFor,
	structureForShape,
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
	budgetCents: null as number | null,
};

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

Deno.test("pricing counts a project budget OR a priced stage OR a priced role", () => {
	assertEquals(step(setupSteps(base), "pricing")?.done, false);
	assertEquals(
		step(
			setupSteps({ ...base, budget: { ...DEFAULT_PROJECT_BUDGET, amountCents: 500_00 } }),
			"pricing",
		)
			?.done,
		true,
	);
	assertEquals(
		step(setupSteps({ ...base, stages: [{ ...stage, unitPriceCents: 120_00 }] }), "pricing")?.done,
		true,
	);
	assertEquals(
		step(
			setupSteps({
				...base,
				structure: "single_task",
				roles: [{ ...role, budgetCents: 400_00 }],
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
		stages: [stage],
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
Deno.test("every shape segment round-trips through the structure it writes", () => {
	for (const format of ["pipeline", "one_off"] as const) {
		for (const option of shapeOptionsFor(format)) {
			const written = structureForShape(format, option);
			assertEquals(
				shapeFor(format, written),
				option,
				`${format}/${option} wrote ${written}, which reads back as a different segment`,
			);
		}
	}
});

Deno.test("a pipeline can actually become single-stage", () => {
	// The literal-argument bug returned "one_off" here, so a pipeline could never be stage-less through
	// the only control that offers it.
	assertEquals(structureForShape("pipeline", "single_stage"), "single_stage");
	assertFalse(hasStages(structureForShape("pipeline", "single_stage")));
});

Deno.test("shape writes stay inside the format's own vocabulary", () => {
	for (const format of ["pipeline", "one_off"] as const) {
		for (const option of shapeOptionsFor(format)) {
			assert(
				shapeOptionsFor(format).includes(structureForShape(format, option)),
				`${format} wrote a structure that is not one of its own shapes`,
			);
		}
	}
});

Deno.test("a session offers no shape choice", () => {
	// Absent, not a one-option picker: a sitting is not divisible into stages.
	assertEquals(shapeOptionsFor("session").length, 0);
	// And resolving a stored structure against an empty option set must not invent one.
	assertEquals(shapeFor("session", "single_stage"), "single_stage");
});
// #endregion
