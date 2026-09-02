import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	createFormatToColumns,
	DEFAULT_PROJECT_BUDGET,
	DEFAULT_PROJECT_RULES,
	DEFAULT_STAGE_SETUP,
	effectiveVisibility,
	hasStagesFor,
	previewReady,
	type ProjectSetupPatch,
	type ProjectSetupStep,
	type ProjectSetupStepsInput,
	reconcileSetup,
	setupCompleteness,
	setupSteps,
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

const stage = {
	...DEFAULT_STAGE_SETUP,
	id: "stage-1",
	name: "Concepts",
	order: 0,
	unitPriceCents: null as number | null,
};

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
	assertEquals(setup.rules.ndaMode, "none");
	assertEquals(setup.rules.ndaDocumentId, null);
	assertEquals(setup.budget.amountCents, null);
});

Deno.test("a patch carrying one rule does not blank the others", () => {
	const setup = reconcileSetup(
		{
			slug: "rebrand",
			title: "Rebrand",
			rules: { ...DEFAULT_PROJECT_RULES, ndaRequired: true, ndaMode: "platform_standard" },
		},
		{ rules: { visibility: "public" } },
	);
	assertEquals(setup.rules.visibility, "public");
	assertEquals(setup.rules.ndaRequired, true);
	assertEquals(setup.rules.ndaMode, "platform_standard");
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

// #region Format → columns

Deno.test("createFormatToColumns covers every offered shape, and the stage-less variant of each", () => {
	// A Direct Deliverable is stage-less by definition, so the toggle cannot move it.
	assertEquals(createFormatToColumns("direct_deliverable"), {
		format: "one_off",
		structure: "single_task",
	});
	assertEquals(createFormatToColumns("direct_deliverable", false), {
		format: "one_off",
		structure: "single_task",
	});

	// Turning stages off on a one-off IS a Direct Deliverable — the same engagement, reached from the
	// two-option offer instead of a third format nobody has to learn.
	assertEquals(createFormatToColumns("one_off", false), {
		format: "one_off",
		structure: "single_task",
	});
	assertEquals(createFormatToColumns("one_off", true), { format: "one_off", structure: "one_off" });

	// A pipeline with stages off is one continuous stage, not a role-staffed engagement.
	assertEquals(createFormatToColumns("pipeline", false), {
		format: "pipeline",
		structure: "single_stage",
	});
	assertEquals(createFormatToColumns("pipeline", true), {
		format: "pipeline",
		structure: "standard",
	});
});

Deno.test("the hasStages parameter defaults to true, so a one-arg caller is unchanged", () => {
	assertEquals(createFormatToColumns("one_off"), createFormatToColumns("one_off", true));
	assertEquals(createFormatToColumns("pipeline"), createFormatToColumns("pipeline", true));
});

Deno.test("hasStagesFor is the read direction, and only single_task has none", () => {
	assertEquals(hasStagesFor("standard"), true);
	assertEquals(hasStagesFor("one_off"), true);
	assertEquals(hasStagesFor("single_stage"), true);
	assertEquals(hasStagesFor("single_task"), false);
});

Deno.test("hasStagesFor reads the stored structure, and does NOT recover the toggle", () => {
	// The two are not inverses and must not be mistaken for a round trip. Turning stages off on a
	// ONE-OFF removes them: the engagement becomes role-staffed, and the read direction says so. On a
	// PIPELINE it collapses them to one continuous stage, which is still a stage — so the read
	// direction answers `true` for something the author switched off, correctly. `hasStages` is a
	// wizard control, and `structure_variation` is what the row actually is.
	const stageless = createFormatToColumns("one_off", false);
	assertEquals(stageless.structure, "single_task");
	assertEquals(hasStagesFor(stageless.structure), false);

	const collapsed = createFormatToColumns("pipeline", false);
	assertEquals(collapsed.structure, "single_stage");
	assertEquals(hasStagesFor(collapsed.structure), true);

	for (const format of ["pipeline", "one_off", "direct_deliverable"] as const) {
		for (const hasStages of [true, false]) {
			const { structure } = createFormatToColumns(format, hasStages);
			assertEquals(
				hasStagesFor(structure),
				structure !== "single_task",
				`${format} / hasStages=${hasStages}`,
			);
		}
	}
});

// #endregion

// #region Effective visibility

Deno.test("a project that has not met its required steps is stored unlisted, whatever it asked for", () => {
	// This is the whole reason create writes `unlisted`: a freshly created project has satisfied
	// nothing, so a `public` request must not put a half-written engagement on Explore.
	const steps = setupSteps(base);
	assertFalse(previewReady(steps));
	assertEquals(effectiveVisibility("public", steps), "unlisted");
	assertEquals(effectiveVisibility("invite_only", steps), "unlisted");
});

Deno.test("a project that has met its required steps gets the visibility it asked for", () => {
	const steps = setupSteps({
		...base,
		title: "Rebrand",
		stages: [{ ...stage, unitPriceCents: 120_00 }],
	});
	assert(previewReady(steps));
	assertEquals(effectiveVisibility("public", steps), "public");
	assertEquals(effectiveVisibility("invite_only", steps), "invite_only");
	assertEquals(effectiveVisibility("unlisted", steps), "unlisted");
});

Deno.test("effective visibility is exactly the Preview gate, never a second rule", () => {
	// Two gates that agree today are two gates that can disagree tomorrow.
	const cases: ProjectSetupStepsInput[] = [
		base,
		{ ...base, title: "Rebrand" },
		{ ...base, title: "Rebrand", stages: [stage] },
		{ ...base, title: "Rebrand", stages: [{ ...stage, unitPriceCents: 1 }] },
		{ ...base, format: "one_off", structure: "single_task", title: "Poster" },
	];
	for (const input of cases) {
		const steps = setupSteps(input);
		assertEquals(effectiveVisibility("public", steps) === "public", previewReady(steps));
	}
});

// #endregion

// #region The stage projection's neutral row

Deno.test("DEFAULT_STAGE_SETUP carries the create payload's own defaults", () => {
	// Derived from CreateProjectStageSchema, so the value a create writes and the value a projection
	// reports for an unconfigured stage cannot drift apart.
	assertEquals(DEFAULT_STAGE_SETUP.requiresFiles, true);
	assertEquals(DEFAULT_STAGE_SETUP.seatLimit, 3);
	assertEquals(DEFAULT_STAGE_SETUP.parallel, false);
	assertEquals(DEFAULT_STAGE_SETUP.ndaOverride, false);
	assertEquals(DEFAULT_STAGE_SETUP.dependsOnStageIndex, null);
	assertEquals(DEFAULT_STAGE_SETUP.lagDays, 0);
	assertEquals(DEFAULT_STAGE_SETUP.durationMode, "no_due_date");
	assertEquals(DEFAULT_STAGE_SETUP.durationDays, null);
	assertEquals(DEFAULT_STAGE_SETUP.dueDate, null);
	assertEquals(DEFAULT_STAGE_SETUP.allowedFileCategories, []);
	assertEquals(DEFAULT_STAGE_SETUP.allowedFileExtensions, []);
	assertEquals(DEFAULT_STAGE_SETUP.tasks, []);
});

Deno.test("a stage's new configuration never moves the ladder", () => {
	// The ladder measures whether a stage EXISTS and whether it is priced. Seats, files and NDA terms
	// are stage configuration, and counting them would block Preview on fields with sane defaults.
	const bare = setupSteps({ ...base, title: "Rebrand", stages: [{ ...stage, unitPriceCents: 1 }] });
	const configured = setupSteps({
		...base,
		title: "Rebrand",
		stages: [{
			...stage,
			unitPriceCents: 1,
			requiresFiles: false,
			seatLimit: null,
			parallel: true,
			ndaOverride: true,
			lagDays: 14,
			durationMode: "relative_duration",
			durationDays: 10,
		}],
	});
	assertEquals(setupCompleteness(bare), setupCompleteness(configured));
	assertEquals(previewReady(bare), previewReady(configured));
});

// #endregion
