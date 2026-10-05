import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import type { ProjectSetup } from "../types/projects-types.ts";
import { firstBlocker } from "./setup-validation.ts";

/**
 * The setup store's save gate.
 *
 * `firstBlocker` is the half of the store that runs without a browser. The signal half
 * (`setup-signals.ts` — seed, patch, discard, reset, dirtiness) cannot be loaded under `deno test`:
 * its outcome channel imports `@projective/ui/feedback`, whose components import their stylesheets,
 * and Deno refuses a CSS module at load time.
 *
 * What these pin is the CONTRACT the save path relies on: `null` means the payload will pass the wire
 * schema's `min(1)` fields, and anything else is a sentence the owner can act on — naming the row by
 * the format's own noun, never a field path.
 */

// #region Fixtures
/** A draft the wire schema would accept: every `min(1)` field the gate inspects is filled. */
function setupOf(over: Partial<ProjectSetup> = {}): ProjectSetup {
	return {
		title: "Brand refresh",
		format: "pipeline",
		stages: [
			{
				name: "Discovery",
				tasks: [{ id: "t1", text: "Audit the current site" }],
				roles: [{ id: "r1", name: "Designer" }],
			},
		],
		roles: [{ id: "pr1", name: "Lead" }],
		...over,
	} as unknown as ProjectSetup;
}

/** The first stage of {@link setupOf}, with `over` folded in. */
function stageWith(over: Record<string, unknown>): ProjectSetup["stages"] {
	return [{ ...setupOf().stages[0], ...over }] as ProjectSetup["stages"];
}
// #endregion

// #region firstBlocker
Deno.test("a complete draft has no blocker", () => {
	assertEquals(firstBlocker(setupOf()), null);
});

Deno.test("a draft with no stages and no roles has no blocker", () => {
	// Emptiness of a LIST is the completeness ladder's business, not the save gate's: the server
	// accepts it, so refusing here would block a save the owner is entitled to make.
	assertEquals(firstBlocker(setupOf({ stages: [], roles: [] })), null);
});

Deno.test("a blank or whitespace-only title blocks the save", () => {
	assertStringIncludes(firstBlocker(setupOf({ title: "" })) ?? "", "name before saving");
	assertStringIncludes(firstBlocker(setupOf({ title: "   " })) ?? "", "name before saving");
});

Deno.test("a nameless stage is named by the format's own noun", () => {
	const stages = stageWith({ name: " " });
	assertEquals(firstBlocker(setupOf({ stages })), "Every stage needs a name.");
	assertEquals(
		firstBlocker(setupOf({ format: "one_off", stages })),
		"Every milestone needs a name.",
	);
	assertEquals(firstBlocker(setupOf({ format: "session", stages })), "Every session needs a name.");
});

Deno.test("an empty task step blocks the save", () => {
	// Reachable by design: "Add step" adds an empty row, and Save pressed straight after it lands here.
	const stages = stageWith({ tasks: [{ id: "t1", text: "" }] });
	assertStringIncludes(firstBlocker(setupOf({ stages })) ?? "", "task list needs some text");
});

Deno.test("an unnamed stage role blocks the save", () => {
	const stages = stageWith({ roles: [{ id: "r1", name: "" }] });
	assertStringIncludes(firstBlocker(setupOf({ stages })) ?? "", "named role on a stage");
});

Deno.test("an unnamed team role blocks the save", () => {
	const roles = [{ id: "pr1", name: "  " }] as ProjectSetup["roles"];
	assertEquals(firstBlocker(setupOf({ roles })), "Every team role needs a name.");
});

Deno.test("the title outranks every row-level blocker", () => {
	// The more specific answer wins: with everything blank at once, the owner is told the one thing
	// at the top of the form rather than a row somewhere below it.
	const blocker = firstBlocker(
		setupOf({
			title: "",
			stages: stageWith({ name: "", tasks: [{ id: "t1", text: "" }] }),
			roles: [{ id: "pr1", name: "" }] as ProjectSetup["roles"],
		}),
	);
	assert(blocker !== null);
	assertStringIncludes(blocker, "name before saving");
});
// #endregion
