import { assert, assertEquals } from "@std/assert";
import { STAGE_REMOVAL_LOCKED_MESSAGE, type StageSetup } from "@projective/types/projects";
import { ProjectBackendService } from "./ProjectBackendService.ts";
import { stageOrderPlan } from "./live-writes.ts";
import { resetWriteStore } from "./write-store.ts";
import type { ReadActor } from "../read-actor.ts";

/**
 * The setup form's Remove (PROJECTS ST2, Decision #553). A PATCH never removes a stage, on the stub
 * path as on the live one, so Remove goes through `deleteStage`: a pristine stage is deleted and stays
 * gone after the next save and a reload; a stage with work on it is refused 409 and nothing moves.
 * The SQL door is `supabase/probes/stage_removal.sql`'s.
 */

// #region Fixtures
/** A staged, active fixture engagement Alice configures; every fixture stage has tickets or seats. */
const PROJECT = "prj-ghnkqoopo4";
const ALICE: ReadActor = { userId: "u-alice", contextId: "", contextType: "personal" };

async function stagesOf(): Promise<StageSetup[]> {
	const read = await ProjectBackendService.setup(PROJECT, ALICE);
	assert(read.ok && read.data, read.message);
	return read.data.setup.stages;
}

/** The form's save as it sends one: every stage it holds, by id. */
async function save(stages: readonly StageSetup[]): Promise<StageSetup[]> {
	const res = await ProjectBackendService.updateProject(PROJECT, {
		stages: stages.map((s) => ({ id: s.id })),
	}, ALICE);
	assert(res.ok && res.data, res.message);
	return res.data.setup.stages;
}

/** Add one stage through a save, as the form's Add stage does, and answer it as stored. */
async function addStage(name: string): Promise<StageSetup> {
	resetWriteStore();
	const before = await stagesOf();
	const res = await ProjectBackendService.updateProject(PROJECT, {
		stages: [...before.map((s) => ({ id: s.id })), { name }],
	}, ALICE);
	assert(res.ok && res.data, res.message);
	const added = res.data.setup.stages.find((s) => s.name === name);
	assert(added, "the new stage is stored");
	return added;
}
// #endregion

Deno.test("a save that leaves out a saved stage keeps it, as the live reconcile does", async () => {
	resetWriteStore();
	const [first, ...rest] = await stagesOf();
	await save(rest);
	const after = await stagesOf();
	assert(after.some((s) => s.id === first.id), "a PATCH is not a removal");
	assertEquals(
		after.at(-1)?.id,
		first.id,
		"the stage it left out keeps its place after the named ones",
	);
});

Deno.test("a stage just added has a stg- address and reads removable", async () => {
	const added = await addStage("Probe: pristine");
	assert(added.slug?.startsWith("stg-"), `the stored stage has an address, got ${added.slug}`);
	assertEquals(added.removable, true);
});

Deno.test("Remove deletes a pristine stage, and it stays gone after the next save and a reload", async () => {
	const added = await addStage("Probe: pristine");
	const removed = await ProjectBackendService.deleteStage(
		{ projectId: PROJECT, stageId: added.slug! },
		ALICE,
	);
	assert(removed.ok, removed.message);
	assertEquals(removed.data?.stageId, added.slug);

	const saved = await save((await stagesOf()).filter((s) => s.id !== added.id));
	assert(!saved.some((s) => s.id === added.id), "the save does not bring it back");
	assert(!(await stagesOf()).some((s) => s.id === added.id), "nor does a reload");
});

Deno.test("a stage with work on it is refused 409 stage_has_history, and nothing moves", async () => {
	resetWriteStore();
	const before = await stagesOf();
	const touched = before[0];
	assertEquals(touched.removable, false);
	const res = await ProjectBackendService.deleteStage(
		{ projectId: PROJECT, stageId: touched.slug! },
		ALICE,
	);
	assertEquals(res.ok, false);
	assertEquals(res.status, 409);
	assertEquals(res.message, STAGE_REMOVAL_LOCKED_MESSAGE);
	assertEquals(res.errors, { stage: "stage_has_history" });
	assertEquals((await stagesOf()).map((s) => s.id), before.map((s) => s.id));
});

Deno.test("a stage address the project does not hold is a 404", async () => {
	resetWriteStore();
	const res = await ProjectBackendService.deleteStage(
		{ projectId: PROJECT, stageId: "stg-2222222222" },
		ALICE,
	);
	assertEquals(res.status, 404);
});

// #region The live reconcile's order
Deno.test("stageOrderPlan: a PATCH keeps a stored stage it omits, after the named ones", () => {
	const plan = stageOrderPlan(["a", "b", "c"], ["a", "c"], new Set(["a", "c"]), false);
	assertEquals(plan.full, ["a", "c", "b"]);
	assertEquals(plan.reordered, false);
});

Deno.test("stageOrderPlan: a stage the server deleted is never named again", () => {
	// Read at save time, the stored list no longer holds the removed stage, so the permutation
	// `reorder_stages` receives is exactly the live stages.
	const plan = stageOrderPlan(["a", "c"], ["a", "c"], new Set(["a", "c"]), false);
	assertEquals(plan.full, ["a", "c"]);
	assertEquals(plan.reordered, false);
});

Deno.test("stageOrderPlan: a real reorder is reported, a PUT sends only what it names", () => {
	assertEquals(stageOrderPlan(["a", "b"], ["b", "a"], new Set(["a", "b"]), false).reordered, true);
	assertEquals(stageOrderPlan(["a", "b", "c"], ["c", "a"], new Set(["a", "c"]), true).full, [
		"c",
		"a",
	]);
});
// #endregion

Deno.test("delete_stage refuses with the exact sentence the service and the dialog read", async () => {
	const sql = await Deno.readTextFile(
		new URL(
			"../../../../supabase/migrations/00001130_functions_projects_stages.sql",
			import.meta.url,
		),
	);
	assert(sql.includes(`RAISE EXCEPTION '${STAGE_REMOVAL_LOCKED_MESSAGE}'`));
});
