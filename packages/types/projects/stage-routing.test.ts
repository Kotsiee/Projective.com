/**
 * Stage addressing — that a `/projects/[projectSlug]/[stageSlug]` path resolves to exactly one stage,
 * and that nothing else does.
 *
 * Every property here fails SILENTLY in production if it breaks. A stage that resolves to nothing
 * renders an empty body with no error; a stage that resolves to the WRONG row renders another
 * engagement's work under this one's chrome. Neither is visible to a type-checker, because all three
 * of a stage's identifiers are `string`.
 *
 * These live here rather than beside the route resolver because {@link findStageChannel} IS the rule —
 * `resolveChannelMeta` delegates to it — and because this package has no Vite-only dependencies, so it
 * can be run by a plain `deno test`.
 */
import { assert, assertEquals } from "@std/assert";
import { isSlug, mintSlug, slugPattern } from "@projective/types/slugs";
import {
	addressesDiscussion,
	DISCUSSION_REF,
	discussionOf,
	expandChannelRef,
	findStageChannel,
	type ProjectChannel,
	type ProjectDetail,
	rootStageOf,
	type StageChannel,
} from "./detail.ts";

// #region Fixtures
function stage(slug: string, name: string, order: number): StageChannel {
	return {
		id: `chan-${order}`,
		slug,
		stageId: `stagerow-${order}`,
		name,
		order,
		status: "active",
		activity: null,
		channel: { id: `chan-${order}`, chatId: `chat-${order}`, name, kind: "stage", unread: false },
	};
}
// #endregion

// #region Shape
Deno.test("a minted stage address is what the column's CHECK accepts", () => {
	// The same pattern `ck_project_stages_slug_shape` enforces. A minter that drifted from it would
	// produce addresses the database refuses at INSERT — in production, on a path no test exercises.
	for (let i = 0; i < 200; i++) {
		const slug = mintSlug("stage");
		assert(slugPattern("stage").test(slug), `${slug} is not a well-formed stage address`);
	}
});

Deno.test("a stage address is never mistaken for a project one, in either direction", () => {
	// The prefix is the whole reason a bare segment is self-describing: without it, a stage segment
	// pasted into a project route resolves against the wrong table with no shape to refuse it.
	const stageSlug = mintSlug("stage");
	const projectSlug = mintSlug("project");
	assert(isSlug(stageSlug, "stage") && !isSlug(stageSlug, "project"));
	assert(isSlug(projectSlug, "project") && !isSlug(projectSlug, "stage"));
});
// #endregion

// #region Collision
Deno.test("two stages sharing a title get different addresses, and a rename moves neither", () => {
	// A title-derived address needs a collision suffix and a rename policy. An address derived from
	// NOTHING needs neither: there is no input that could collide and none that could change. This is
	// the property that replaces both of those mechanisms.
	const a = mintSlug("stage");
	const b = mintSlug("stage");
	assert(a !== b, "two stages named the same thing must not share an address");

	const stages = [stage(a, "Discovery", 0), stage(b, "Discovery", 1)];
	assertEquals(findStageChannel(stages, a)?.order, 0);
	assertEquals(findStageChannel(stages, b)?.order, 1);

	// Renaming is exactly what breaks a derived slug. Here the address is not a function of the name,
	// so every link minted before the rename still resolves after it.
	const renamed = stages.map((s) => ({ ...s, name: "Research" }));
	assertEquals(findStageChannel(renamed, a)?.order, 0);
	assertEquals(findStageChannel(renamed, b)?.order, 1);
});

Deno.test("the minter does not repeat itself across far more stages than a project has", () => {
	const seen = new Set<string>();
	for (let i = 0; i < 5_000; i++) seen.add(mintSlug("stage"));
	assertEquals(seen.size, 5_000, "a repeat at this volume means the draw is not uniform");
});
// #endregion

// #region Isolation
Deno.test("a stage of ANOTHER project is not addressable through this project's stage list", () => {
	// The slug is globally unique, so this is not about ambiguity — it is about SCOPE. Resolution runs
	// against this project's stages, so a perfectly valid address belonging elsewhere resolves to
	// nothing rather than rendering another engagement's stage under this project's chrome.
	const mine = mintSlug("stage");
	const theirs = mintSlug("stage");
	const stages = [stage(mine, "Discovery", 0)];

	assertEquals(findStageChannel(stages, mine)?.name, "Discovery");
	assertEquals(findStageChannel(stages, theirs), null);
});

Deno.test("a stage is addressed by its slug ALONE — never by its row id or its room id", () => {
	// The fixtures used to make all three strings equal, which is exactly why a lookup written against
	// the wrong one passed in the stub and found nothing in production. Accepting the other two here
	// would restore that: an address that works in development and 404s once the live gate is on.
	const slug = mintSlug("stage");
	const stages = [stage(slug, "Discovery", 0)];

	assertEquals(findStageChannel(stages, slug)?.name, "Discovery");
	assertEquals(findStageChannel(stages, "stagerow-0"), null, "the stage row id must not route");
	assertEquals(findStageChannel(stages, "chan-0"), null, "the channel id must not route");
});

Deno.test("a project-view segment names no stage, so it draws no stage chrome", () => {
	// `/projects/{slug}/board` is a project view, not a channel. Resolving it would put a channel
	// header over a board.
	const stages = [stage(mintSlug("stage"), "Discovery", 0)];
	for (const seg of ["board", "files", "timeline", "submissions", "general", "dm-ivy"]) {
		assertEquals(findStageChannel(stages, seg), null, `${seg} must not resolve to a stage`);
	}
});
// #endregion

// #region Totality
Deno.test("resolution is total — an absent or empty segment is a miss, never a throw", () => {
	const stages = [stage(mintSlug("stage"), "Discovery", 0)];
	assertEquals(findStageChannel(stages, null), null);
	assertEquals(findStageChannel(stages, undefined), null);
	assertEquals(findStageChannel(stages, ""), null);
	assertEquals(findStageChannel([], mintSlug("stage")), null);
});

Deno.test("a resolved stage carries all three keys, each for its own job", () => {
	// The URL segment, the room every channel-scoped read takes, and the row the Details tab writes to.
	// Collapsing any two of these is how a slug ends up posted as a channel id.
	const slug = mintSlug("stage");
	const found = findStageChannel([stage(slug, "Hi-fi design", 2)], slug);
	assert(found);
	assertEquals(found.slug, slug);
	assertEquals(found.id, "chan-2");
	assertEquals(found.stageId, "stagerow-2");
});
// #endregion

// #region Discussion
/** A project-wide room, as the live read projects a `project_all` channel. */
function general(id: string): ProjectChannel {
	return { id, chatId: `chat-${id}`, name: "General", kind: "general", unread: false };
}

/** The three fields the discussion rule reads, for a Task or for a staged engagement. */
function engagement(
	task: boolean,
	channels: { general?: ProjectChannel[]; stages?: StageChannel[] },
): Pick<ProjectDetail, "format" | "structure" | "channels"> {
	return {
		format: task ? "one_off" : "pipeline",
		structure: task ? "single_task" : "standard",
		channels: {
			general: channels.general ?? [],
			stages: channels.stages ?? [],
			teams: [],
			dms: [],
		},
	};
}

Deno.test("a Task's discussion is its root stage's room, by order rather than array position", () => {
	// Two stages on a Task is a legacy anomaly the database now refuses, so the answer must not depend
	// on which order a read happened to return them in.
	const root = mintSlug("stage");
	const later = mintSlug("stage");
	const d = engagement(true, {
		general: [general("room-general")],
		stages: [stage(later, "Later", 3), stage(root, "Delivery", 0)],
	});
	const room = discussionOf(d);
	assert(room?.kind === "stage");
	assertEquals(room.stage.slug, root);
	assertEquals(expandChannelRef(d, DISCUSSION_REF), root);
	assertEquals(findStageChannel(d.channels.stages, DISCUSSION_REF, { task: true })?.slug, root);
});

Deno.test("a staged engagement's discussion is its project-wide room and never a stage", () => {
	const d = engagement(false, {
		general: [general("room-general")],
		stages: [stage(mintSlug("stage"), "Discovery", 0)],
	});
	const room = discussionOf(d);
	assert(room?.kind === "general");
	assertEquals(room.channel.id, "room-general");
	assertEquals(expandChannelRef(d, DISCUSSION_REF), "room-general");
	// The word names no stage here, so the stage-scoped views find nothing rather than stage one.
	assertEquals(findStageChannel(d.channels.stages, DISCUSSION_REF), null);
	assertEquals(findStageChannel(d.channels.stages, DISCUSSION_REF, { task: false }), null);
});

Deno.test("a staged engagement with no project-wide room has no discussion to link to", () => {
	const d = engagement(false, { stages: [stage(mintSlug("stage"), "Discovery", 0)] });
	assertEquals(discussionOf(d), null);
	// Unexpanded, so every read matching on it misses — the same answer as any unknown segment.
	assertEquals(expandChannelRef(d, DISCUSSION_REF), DISCUSSION_REF);
});

Deno.test("a Task whose stage room was never provisioned falls back to a general room", () => {
	const d = engagement(true, { general: [general("room-general")] });
	assertEquals(discussionOf(d)?.kind, "general");
});

Deno.test("every other segment passes through expansion unchanged", () => {
	const slug = mintSlug("stage");
	const d = engagement(false, {
		general: [general("room-general")],
		stages: [stage(slug, "A", 0)],
	});
	for (const seg of [slug, "room-general", "dm-ivy", "board"]) {
		assertEquals(expandChannelRef(d, seg), seg);
	}
});

Deno.test("only the discussion room's OLD addresses are redirected to the word", () => {
	const root = mintSlug("stage");
	const task = engagement(true, {
		general: [general("room-general")],
		stages: [stage(root, "D", 0)],
	});
	assert(addressesDiscussion(task, root), "a Task's stage slug is its discussion's old address");
	assert(addressesDiscussion(task, "chan-0"), "so is the room id a notification may carry");
	// A Task's seeded general room is a different room — reachable, but not its discussion.
	assert(!addressesDiscussion(task, "room-general"));
	assert(!addressesDiscussion(task, DISCUSSION_REF), "the word itself never redirects");

	const other = mintSlug("stage");
	const staged = engagement(false, {
		general: [general("room-general")],
		stages: [stage(other, "Discovery", 0)],
	});
	assert(addressesDiscussion(staged, "room-general"));
	assert(!addressesDiscussion(staged, other), "a staged engagement's stage keeps its own address");
});

Deno.test("the root stage is the lowest order, and an empty list has none", () => {
	assertEquals(rootStageOf([{ o: 2 }, { o: 1 }, { o: 5 }], (s) => s.o), { o: 1 });
	assertEquals(rootStageOf([] as { o: number }[], (s) => s.o), null);
});
// #endregion
