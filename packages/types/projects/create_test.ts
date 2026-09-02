import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	blocksPosting,
	CreateProjectSchema,
	CreateProjectStageSchema,
	CurrencyCode,
	DEADLINE_BONUS_RATE,
	FIELD_TIERS,
	fieldTier,
	ndaDocumentFor,
	ndaRequiredFor,
	projectSlugFrom,
	type ProjectWizardField,
	ProjectWizardStep,
	WIZARD_STEP_FIELDS,
	WIZARD_STEP_LABEL,
} from "./create.ts";

/**
 * The create payload's own promises, pinned.
 *
 * Two classes of claim live here and they fail differently. A DEFAULT that drifts is silent — a stage
 * created without a files requirement, or a project quietly stored public — and shows up only as
 * behaviour nobody asked for. A CAP or a pattern that drifts is loud, but in the wrong place: it
 * surfaces as a Postgres CHECK violation the author cannot act on, long after the field they typed
 * into has left the screen.
 */

// #region Backward compatibility

Deno.test("a title-only payload still parses — every field added since carries a default", () => {
	const parsed = CreateProjectSchema.parse({ title: "Rebrand" });
	assertEquals(parsed.title, "Rebrand");
	assertEquals(parsed.format, "pipeline");
	assertEquals(parsed.hasStages, true);
	assertEquals(parsed.stages, []);
	assertEquals(parsed.roles, []);
	assertEquals(parsed.budget, null);
});

Deno.test("a title is the only hard requirement", () => {
	assertFalse(CreateProjectSchema.safeParse({}).success);
	assertFalse(CreateProjectSchema.safeParse({ title: "" }).success);
	assert(CreateProjectSchema.safeParse({ title: "R" }).success);
});

// #endregion

// #region Project-level defaults

Deno.test("the wizard asks for public, and nothing here decides what gets stored", () => {
	// `effectiveVisibility` in ./setup.ts is what turns this request into a stored value; a payload
	// default of `public` states the author's usual intent without granting it.
	const parsed = CreateProjectSchema.parse({ title: "Rebrand" });
	assertEquals(parsed.visibility, "public");
	assertEquals(parsed.ipOwnershipMode, "exclusive_transfer");
	assertEquals(parsed.portfolioDisplayRights, "allowed");
	assertEquals(parsed.ndaMode, "none");
	assertEquals(parsed.ndaDocumentId, null);
	assertEquals(parsed.allowDeadlineBonuses, false);
	assertEquals(parsed.languages, []);
	assertEquals(parsed.locations, []);
	assertEquals(parsed.attachmentIds, []);
});

Deno.test("reference material is capped at ten attachments", () => {
	const ids = (n: number) => Array.from({ length: n }, (_, i) => `file-${i}`);
	assert(CreateProjectSchema.safeParse({ title: "R", attachmentIds: ids(10) }).success);
	assertFalse(CreateProjectSchema.safeParse({ title: "R", attachmentIds: ids(11) }).success);
});

// #endregion

// #region Currency

Deno.test("a currency is three uppercase letters, and nothing else is close enough", () => {
	// The column carries `CHECK (currency ~ '^[A-Z]{3}$')`, so anything this accepts and Postgres
	// refuses becomes a 23514 raised after the author has left the field.
	assert(CurrencyCode.safeParse("GBP").success);
	assert(CurrencyCode.safeParse("USD").success);
	assert(CurrencyCode.safeParse("JPY").success);
	assertFalse(CurrencyCode.safeParse("gbp").success);
	assertFalse(CurrencyCode.safeParse("Dollars").success);
	assertFalse(CurrencyCode.safeParse("").success);
	assertFalse(CurrencyCode.safeParse("GB").success);
	assertFalse(CurrencyCode.safeParse("GBPX").success);
	assertFalse(CurrencyCode.safeParse("£").success);
});

Deno.test("the payload's currency defaults to USD and is validated at both levels", () => {
	assertEquals(CreateProjectSchema.parse({ title: "R" }).currency, "USD");
	assertFalse(CreateProjectSchema.safeParse({ title: "R", currency: "gbp" }).success);
	assertFalse(
		CreateProjectSchema.safeParse({
			title: "R",
			budget: { budgetType: "fixed_price", amountCents: 1, currency: "pounds" },
		}).success,
	);
});

// #endregion

// #region NDA

Deno.test("the legacy nda_required boolean is derived, never separately chosen", () => {
	assertEquals(ndaRequiredFor("none"), false);
	assertEquals(ndaRequiredFor("platform_standard"), true);
	assertEquals(ndaRequiredFor("custom"), true);
});

Deno.test("only a custom NDA may name a document", () => {
	// Mirrors `CHECK (nda_mode = 'custom' OR nda_document_id IS NULL)`: switching the mode back has to
	// drop the reference, or the row points at a file the engagement no longer uses.
	assertEquals(ndaDocumentFor("custom", "doc-1"), "doc-1");
	assertEquals(ndaDocumentFor("custom", null), null);
	assertEquals(ndaDocumentFor("platform_standard", "doc-1"), null);
	assertEquals(ndaDocumentFor("none", "doc-1"), null);
});

// #endregion

// #region Stage defaults

Deno.test("a named stage fills in every remaining field", () => {
	const stage = CreateProjectStageSchema.parse({ name: "Concepts" });
	assertEquals(stage.description, "");
	assertEquals(stage.unitPriceCents, null);
	assertEquals(stage.milestone, "");
	assertEquals(stage.tasks, []);
	assertEquals(stage.skills, []);
	// Files are required by default: a stage whose delivery leaves no artefact has nothing to review.
	assertEquals(stage.requiresFiles, true);
	// Limited to three seats, not unlimited — `null` is the deliberate unlimited answer.
	assertEquals(stage.seatLimit, 3);
	assertEquals(stage.parallel, false);
	assertEquals(stage.dependsOnStageIndex, null);
	assertEquals(stage.lagDays, 0);
	assertEquals(stage.ndaOverride, false);
	assertEquals(stage.allowedFileCategories, []);
	assertEquals(stage.allowedFileExtensions, []);
	assertEquals(stage.durationMode, "no_due_date");
	assertEquals(stage.durationDays, null);
	assertEquals(stage.dueDate, null);
});

Deno.test("a stage takes its scope up to the same cap the projection reads it back at", () => {
	// The create payload and the setup projection describe one stage from opposite ends of a round
	// trip; a tighter cap here would truncate prose the form can display but not resubmit.
	assert(CreateProjectStageSchema.safeParse({ name: "S", description: "x".repeat(8000) }).success);
	assertFalse(
		CreateProjectStageSchema.safeParse({ name: "S", description: "x".repeat(8001) }).success,
	);
});

Deno.test("a stage's seat limit is unlimited or a real headcount, never zero", () => {
	assert(CreateProjectStageSchema.safeParse({ name: "S", seatLimit: null }).success);
	assert(CreateProjectStageSchema.safeParse({ name: "S", seatLimit: 1 }).success);
	assertFalse(CreateProjectStageSchema.safeParse({ name: "S", seatLimit: 0 }).success);
	assertFalse(CreateProjectStageSchema.safeParse({ name: "S", seatLimit: -1 }).success);
});

Deno.test("a stage takes at most ten skills, and only real categories", () => {
	const skills = (n: number) => Array.from({ length: n }, (_, i) => `skill-${i}`);
	assert(CreateProjectStageSchema.safeParse({ name: "S", skills: skills(10) }).success);
	assertFalse(CreateProjectStageSchema.safeParse({ name: "S", skills: skills(11) }).success);
	assert(
		CreateProjectStageSchema.safeParse({ name: "S", allowedFileCategories: ["Image", "Vector"] })
			.success,
	);
	assertFalse(
		CreateProjectStageSchema.safeParse({ name: "S", allowedFileCategories: ["Pictures"] }).success,
	);
});

// #endregion

// #region The wizard's tier taxonomy

Deno.test("every wizard control belongs to exactly one step", () => {
	// A control in two steps is a control an author can answer twice, and a control in none is one the
	// wizard has a tier for and no place to draw.
	const seen = new Map<ProjectWizardField, number>();
	for (const fields of Object.values(WIZARD_STEP_FIELDS)) {
		for (const field of fields) seen.set(field, (seen.get(field) ?? 0) + 1);
	}
	for (const field of Object.keys(FIELD_TIERS) as ProjectWizardField[]) {
		assertEquals(seen.get(field), 1, `not placed exactly once: ${field}`);
	}
	assertEquals(seen.size, Object.keys(FIELD_TIERS).length);
});

Deno.test("the six steps are the six the flow document names, in order", () => {
	assertEquals(ProjectWizardStep.options, [
		"details",
		"legal",
		"stages",
		"timeline",
		"budget",
		"review",
	]);
	assertEquals(Object.keys(WIZARD_STEP_FIELDS), ProjectWizardStep.options);
	assertEquals(WIZARD_STEP_LABEL.review, "Review & Publish");
	// Review reads the ladder and publishes; it collects nothing of its own.
	assertEquals(WIZARD_STEP_FIELDS.review.length, 0);
});

Deno.test("a stage's price and schedule change tier with the engagement's shape", () => {
	// A one-off's single fee IS the engagement, so it blocks; a pipeline's per-ticket rate can wait
	// until the work is scoped.
	assertEquals(fieldTier("stageUnitPrice", "pipeline"), "T2");
	assertEquals(fieldTier("stageUnitPrice", "one_off"), "T1");
	assertEquals(fieldTier("stageDuration", "pipeline"), "T5");
	assertEquals(fieldTier("stageDuration", "one_off"), "T3");
});

Deno.test("a Direct Deliverable resolves down the one-off arm", () => {
	// It IS a one-off — the stage-less variant — so no caller has to remember which member the pair
	// was written for.
	for (const field of Object.keys(FIELD_TIERS) as ProjectWizardField[]) {
		assertEquals(
			fieldTier(field, "direct_deliverable"),
			fieldTier(field, "one_off"),
			`diverged on ${field}`,
		);
	}
});

Deno.test("a tier that does not vary answers the same for every shape", () => {
	assertEquals(fieldTier("title", "pipeline"), "T1");
	assertEquals(fieldTier("title", "one_off"), "T1");
	assertEquals(fieldTier("attachmentIds", "pipeline"), "T5");
	assertEquals(fieldTier("attachmentIds", "one_off"), "T5");
});

Deno.test("the publish gate waits on T1 and T2, and on nothing below them", () => {
	assertEquals(blocksPosting("T1"), true);
	assertEquals(blocksPosting("T2"), true);
	assertEquals(blocksPosting("T3"), false);
	assertEquals(blocksPosting("T4"), false);
	assertEquals(blocksPosting("T5"), false);
});

// #endregion

// #region Constants and slugs

Deno.test("the deadline-bonus rate is a single named constant, not a literal at a call site", () => {
	// It is brief-sourced and unconfirmed against any source-of-truth document, so it exists once in
	// order to be correctable once. It never reaches the database or a money path.
	assertEquals(DEADLINE_BONUS_RATE, 0.1);
});

Deno.test("a slug is derived once, and an unusable title yields an empty one rather than prose", () => {
	assertEquals(projectSlugFrom("Helia Wallet Redesign"), "helia-wallet-redesign");
	assertEquals(projectSlugFrom("  !!!  "), "");
	assert(projectSlugFrom("x".repeat(200)).length <= 80);
});

// #endregion
