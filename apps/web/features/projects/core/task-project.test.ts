import { assert, assertEquals, assertFalse } from "@std/assert";
import { isTaskDetail, TASK_ABSENT_VIEWS } from "./task-project.ts";
import type { ProjectDetail } from "../types/projects-types.ts";

/**
 * A Task's chrome is simpler than every other engagement's, and each simplification removes a way in.
 * These pin the rules that decide what is removed — so a Task loses exactly the two views it has no
 * use for. Its one way into its conversation is the engagement's discussion link, pinned with the
 * other archetypes' in `chat-context.test.ts`.
 */

// #region Fixtures
function detailOf(over: Partial<Pick<ProjectDetail, "format" | "structure">>): ProjectDetail {
	return { format: "one_off", structure: "single_task", ...over } as unknown as ProjectDetail;
}
// #endregion

Deno.test("only the engagements that read as a Task take the Task chrome", () => {
	assert(isTaskDetail(detailOf({})));
	assertFalse(
		isTaskDetail(detailOf({ structure: "one_off" })),
		"a milestone one-off keeps its timeline",
	);
	assertFalse(isTaskDetail(detailOf({ format: "pipeline", structure: "standard" })));
});

Deno.test("a Task loses Timeline and Calendar and nothing else", () => {
	assertEquals([...TASK_ABSENT_VIEWS].sort(), ["calendar", "timeline"]);
});
