import { assert, assertEquals, assertFalse } from "@std/assert";
import { isTaskDetail, TASK_ABSENT_VIEWS, taskDiscussionOf } from "./task-project.ts";
import type { ProjectChannel, ProjectDetail, StageChannel } from "../types/projects-types.ts";

/**
 * A Task's chrome is simpler than every other engagement's, and each simplification removes a way in.
 * These pin the two rules that decide what is removed — so a Task keeps exactly one way into its
 * conversation, and loses exactly the two views it has no use for.
 */

// #region Fixtures
function stage(slug: string, order: number, unread = false): StageChannel {
	return {
		id: `room-${slug}`,
		slug,
		stageId: `row-${slug}`,
		name: "Delivery",
		order,
		status: "active",
		activity: null,
		channel: {
			id: `room-${slug}`,
			chatId: `chat-${slug}`,
			name: "Delivery",
			kind: "stage",
			unread,
		},
	};
}

function general(id: string): ProjectChannel {
	return { id, chatId: `chat-${id}`, name: "General", kind: "general", unread: true };
}

function detailOf(
	over: Partial<Pick<ProjectDetail, "format" | "structure">>,
	channels: { stages?: StageChannel[]; general?: ProjectChannel[] } = {},
): ProjectDetail {
	return {
		slug: "prj-abcdefghij",
		format: "one_off",
		structure: "single_task",
		...over,
		channels: {
			general: channels.general ?? [],
			stages: channels.stages ?? [],
			teams: [],
			dms: [],
		},
	} as unknown as ProjectDetail;
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

Deno.test("a Task's discussion is its stage room, addressed by the stage's slug", () => {
	const d = detailOf({}, {
		stages: [stage("stg-2222222222", 0, true)],
		general: [general("general")],
	});
	assertEquals(taskDiscussionOf(d), {
		ref: "stg-2222222222",
		href: "/projects/prj-abcdefghij/stg-2222222222",
		unread: true,
	});
});

Deno.test("the FIRST stage by order is the room, never the array's first element", () => {
	const d = detailOf({}, { stages: [stage("stg-bbbbbbbbbb", 1), stage("stg-aaaaaaaaaa", 0)] });
	assertEquals(taskDiscussionOf(d)?.ref, "stg-aaaaaaaaaa");
});

Deno.test("with no stage room the general channel is the fallback, and with neither there is none", () => {
	assertEquals(
		taskDiscussionOf(detailOf({}, { general: [general("general")] }))?.href,
		"/projects/prj-abcdefghij/general",
	);
	// No room a link could reach means no link — a Discussion entry leading nowhere would be a control
	// that renders and does nothing.
	assertEquals(taskDiscussionOf(detailOf({})), null);
});

Deno.test("a Task loses Timeline and Calendar and nothing else", () => {
	assertEquals([...TASK_ABSENT_VIEWS].sort(), ["calendar", "timeline"]);
});
