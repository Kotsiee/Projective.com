import { assert, assertEquals } from "@std/assert";
import {
	activeChannelIdOf,
	channelMessageHref,
	conversationMessageHref,
	discussionHref,
	discussionLinkOf,
	messageAnchorOf,
	withoutMessageAnchor,
} from "./chat-context.ts";
import type { ProjectChannel, ProjectDetail, StageChannel } from "../types/projects-types.ts";

/**
 * The lane's Discussion link is the one way into an engagement's primary conversation on EVERY
 * archetype, and it always carries the same address. These pin the address, which room it stands for
 * on each archetype, and the one case where there is no link to offer.
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

function general(id: string, unread = true): ProjectChannel {
	return { id, chatId: `chat-${id}`, name: "General", kind: "general", unread };
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

const PIPELINE = { format: "pipeline", structure: "standard" } as const;
// #endregion

Deno.test("every archetype's discussion has the same address", () => {
	assertEquals(discussionHref("prj-abcdefghij"), "/projects/prj-abcdefghij/discussion");
	const task = detailOf({}, { stages: [stage("stg-2222222222", 0)] });
	const pipeline = detailOf(PIPELINE, {
		general: [general("general")],
		stages: [stage("stg-3", 0)],
	});
	assertEquals(discussionLinkOf(task)?.href, "/projects/prj-abcdefghij/discussion");
	assertEquals(discussionLinkOf(pipeline)?.href, "/projects/prj-abcdefghij/discussion");
});

Deno.test("a Task's discussion is its stage room, and its unread is that room's", () => {
	const d = detailOf({}, {
		stages: [stage("stg-2222222222", 0, true)],
		general: [general("general", false)],
	});
	const link = discussionLinkOf(d);
	assert(link?.room.kind === "stage");
	assertEquals(link.room.stage.slug, "stg-2222222222");
	assertEquals(link.unread, true);
});

Deno.test("the FIRST stage by order is a Task's room, never the array's first element", () => {
	const d = detailOf({}, { stages: [stage("stg-bbbbbbbbbb", 1), stage("stg-aaaaaaaaaa", 0)] });
	const link = discussionLinkOf(d);
	assert(link?.room.kind === "stage");
	assertEquals(link.room.stage.slug, "stg-aaaaaaaaaa");
});

Deno.test("a staged engagement's discussion is its project-wide room, never a stage", () => {
	const d = detailOf(PIPELINE, {
		stages: [stage("stg-aaaaaaaaaa", 0, true)],
		general: [general("general", false)],
	});
	const link = discussionLinkOf(d);
	assert(link?.room.kind === "general");
	assertEquals(link.unread, false, "a stage's chatter is not the discussion's");
});

Deno.test("with no room the address could open there is no link", () => {
	// A Task with neither room, and a staged engagement with no project-wide room (a live project made
	// before creation provisioned one): a Discussion entry leading nowhere would do nothing.
	assertEquals(discussionLinkOf(detailOf({})), null);
	assertEquals(discussionLinkOf(detailOf(PIPELINE, { stages: [stage("stg-a", 0)] })), null);
	// A Task whose stage room was never provisioned still has the general fallback.
	assertEquals(
		discussionLinkOf(detailOf({}, { general: [general("general")] }))?.room.kind,
		"general",
	);
});

Deno.test("the discussion is a channel segment; the project views are not", () => {
	assertEquals(activeChannelIdOf("/projects/prj-a/discussion"), "discussion");
	assertEquals(activeChannelIdOf("/projects/prj-a/discussion/files"), "discussion");
	for (const view of ["board", "timeline", "files", "members", "submissions", "calendar"]) {
		assertEquals(activeChannelIdOf(`/projects/prj-a/${view}`), null, view);
	}
});

// #region Message links
const ROOM_UUID = "22222222-3333-4444-8555-666666666666";

Deno.test("a room's message link names the message in the query, by slug only", () => {
	assertEquals(
		channelMessageHref("prj-67ss4hwneu", "stg-3f4gvyycwv", "m-1"),
		"/projects/prj-67ss4hwneu/stg-3f4gvyycwv/chat?m=m-1",
	);
	assertEquals(
		channelMessageHref("prj-a", "discussion", "a b"),
		"/projects/prj-a/discussion/chat?m=a+b",
	);
	assertEquals(channelMessageHref("prj-a", ROOM_UUID, "m-1"), null);
	assertEquals(channelMessageHref(ROOM_UUID, ROOM_UUID, "m-1"), null);
});

Deno.test("a conversation's message link is the inbox route, never a project path", () => {
	assertEquals(
		conversationMessageHref(ROOM_UUID, "m-1"),
		`/messages/${ROOM_UUID}?m=m-1`,
	);
	assertEquals(conversationMessageHref("dm-mara", "m-1"), "/messages/dm-mara?m=m-1");
});

Deno.test("the anchor is read from ?m=, else a legacy #m- fragment", () => {
	assertEquals(messageAnchorOf("?m=abc", ""), "abc");
	assertEquals(messageAnchorOf("?tab=x&m=abc", "#m-old"), "abc");
	assertEquals(messageAnchorOf("", "#m-old%20id"), "old id");
	assertEquals(messageAnchorOf("?m=", "#m-"), null);
	assertEquals(messageAnchorOf("", "#m-%E0%A4%A"), null);
	assertEquals(messageAnchorOf("?x=1", "#top"), null);
});

Deno.test("stripping the anchor keeps every other part of the address", () => {
	assertEquals(withoutMessageAnchor("/messages/c", "?m=abc", ""), "/messages/c");
	assertEquals(
		withoutMessageAnchor("/projects/p/discussion/chat", "?tkv=t&m=abc", "#m-abc"),
		"/projects/p/discussion/chat?tkv=t",
	);
	assertEquals(withoutMessageAnchor("/messages/c", "", "#top"), "/messages/c#top");
});
// #endregion
