import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import {
	fallbackStageName,
	isStale,
	projectSidebarProjection,
	UNTITLED_PROJECT,
} from "./sidebar-overlay.ts";
import type {
	ProjectDetail,
	ProjectSetup,
	StageChannel,
	StageSetup,
} from "../types/projects-types.ts";

/**
 * These tests exist because the projection is the ONLY thing standing between the owner's keystrokes
 * and the lane, and two of its rules fail silently on screen.
 *
 * The first is the Direct Deliverable: its draft carries no stages because its form has no stage
 * list, and reading that silence as a deletion would erase real channels from the sidebar of an
 * engagement that never offered a control to remove them. Nothing about the code path says so — the
 * two lists simply differ.
 *
 * The second is a stage with no channel. Drawing it as an anchor produces a link into a conversation
 * that does not exist, which type-checks, renders, and is indistinguishable from a working row until
 * somebody clicks it.
 */

// #region Fixtures
const PARTY = { name: "Ivy Chen", handle: "ivy", avatar: null };

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function stageChannel(stageId: string, name: string, order: number): StageChannel {
	return {
		id: `chan-${stageId}`,
		slug: `stg-${stageId}`,
		stageId,
		name,
		order,
		status: "active",
		activity: null,
		channel: {
			id: `chan-${stageId}`,
			chatId: `chat-${stageId}`,
			name,
			kind: "stage",
			unread: false,
		},
	};
}

function detailOf(stages: StageChannel[]): ProjectDetail {
	return {
		id: PROJECT_ID,
		slug: "prj-abcdefghij",
		title: "Server Title",
		kind: "project",
		format: "pipeline",
		status: "active",
		typeLabel: "Brand Identity",
		description: "The stored plain description.",
		viewerRole: "client",
		viewerIsClient: true,
		starred: false,
		owner: PARTY,
		client: null,
		members: [],
		channels: { general: [], stages, teams: [], dms: [] },
	} as unknown as ProjectDetail;
}

function stageSetup(id: string, name: string, order: number): StageSetup {
	return {
		id,
		name,
		order,
		description: "",
		unitPriceCents: null,
		milestone: "",
		skills: [],
		tasks: [],
		dependency: "after",
		startsWithId: null,
		delayDays: 0,
		deliveryDate: null,
		capacity: "open",
		seatCount: null,
		roles: [],
		allowedFileKinds: [],
		ndaRequired: null,
	} as unknown as StageSetup;
}

function setupOf(over: Partial<ProjectSetup> = {}): ProjectSetup {
	return {
		id: PROJECT_ID,
		slug: "prj-abcdefghij",
		title: "Draft Title",
		format: "pipeline",
		structure: "standard",
		sessionKind: "none",
		status: "draft",
		archivedAt: null,
		description: "<p>Draft scope.</p>",
		attachments: [],
		stages: [],
		roles: [],
		onboardedCount: 0,
		viewerIsClient: true,
		steps: [],
		completeness: 0,
		previewReady: false,
		...over,
	} as unknown as ProjectSetup;
}
// #endregion

// #region No draft, or somebody else's
Deno.test("with no draft the stored answer passes through untouched", () => {
	const detail = detailOf([stageChannel("s1", "Discovery", 0)]);
	const p = projectSidebarProjection(detail, null);

	assertEquals(p.detail.title, "Server Title");
	assertEquals(p.stages.map((r) => r.name), ["Discovery"]);
	assertEquals(p.stages[0].channel?.id, "chan-s1");
	assertEquals(isStale(p), false);
});

Deno.test("a draft for a DIFFERENT engagement is ignored entirely", () => {
	// The lane is mounted on every project route and the store is module-level, so this guard is what
	// stops one engagement's unsaved title appearing over another's.
	const detail = detailOf([stageChannel("s1", "Discovery", 0)]);
	const other = setupOf({ id: "22222222-2222-4222-8222-222222222222" });
	const p = projectSidebarProjection(detail, other);

	assertEquals(p.detail.title, "Server Title");
	assertEquals(isStale(p), false);
});
// #endregion

// #region Identity
Deno.test("title, description and format follow the draft", () => {
	const p = projectSidebarProjection(
		detailOf([]),
		setupOf({ title: "Helia Wallet", format: "one_off", structure: "one_off" }),
	);

	assertEquals(p.detail.title, "Helia Wallet");
	assertEquals(p.detail.format, "one_off");
	assertEquals(p.detail.description, "Draft scope.");
});

Deno.test("an emptied title falls back rather than collapsing to nothing", () => {
	const p = projectSidebarProjection(detailOf([]), setupOf({ title: "   " }));
	assertEquals(p.detail.title, UNTITLED_PROJECT);
});

Deno.test("the description is flattened, not tag-stripped", () => {
	// The whole point of the shared flattener: a word crossing a formatting run must not acquire a
	// space in the middle of it, which is exactly what a tag-stripping regex does.
	const p = projectSidebarProjection(
		detailOf([]),
		setupOf({ description: "<p>Re<strong>brand</strong>ing</p><p>Second para.</p>" }),
	);

	assertStringIncludes(p.detail.description, "Rebranding");
	assertStringIncludes(p.detail.description, "Second para.");
});
// #endregion

// #region Stage rows
Deno.test("a renamed stage renames its row and its channel", () => {
	const detail = detailOf([stageChannel("s1", "Discovery", 0)]);
	const p = projectSidebarProjection(
		detail,
		setupOf({ stages: [stageSetup("s1", "Kick-off", 0)] }),
	);

	assertEquals(p.stages[0].name, "Kick-off");
	assertEquals(p.stages[0].channel?.name, "Kick-off");
	assertEquals(p.stages[0].channel?.channel.name, "Kick-off");
	assertEquals(isStale(p), false);
});

Deno.test("an unnamed stage falls back to the engagement's own word for the unit", () => {
	assertEquals(fallbackStageName("pipeline", 0), "Stage 1");
	assertEquals(fallbackStageName("one_off", 1), "Milestone 2");
	assertEquals(fallbackStageName("session", 2), "Session 3");

	const detail = detailOf([stageChannel("s1", "Discovery", 0)]);
	const p = projectSidebarProjection(detail, setupOf({ stages: [stageSetup("s1", "  ", 0)] }));
	assertEquals(p.stages[0].name, "Stage 1");
});

Deno.test("a stage added in the form appears, is NOT navigable, and asks for a re-read", () => {
	const detail = detailOf([stageChannel("s1", "Discovery", 0)]);
	const p = projectSidebarProjection(
		detail,
		setupOf({
			stages: [stageSetup("s1", "Discovery", 0), stageSetup("stage-draft-1", "Build", 1)],
		}),
	);

	assertEquals(p.stages.map((r) => r.name), ["Discovery", "Build"]);
	assertEquals(p.stages[1].channel, null);
	assertEquals(p.staleKey, "stage-draft-1|");
	// With no baseline supplied every row reads as acknowledged — the safe error, since claiming a
	// saved stage is unsaved is a false statement about work the owner has already done.
	assertEquals(p.stages[1].pending, "unlinked");
	// The projected detail carries only channels that exist, so nothing downstream can link to it.
	assertEquals(p.detail.channels.stages.length, 1);
});

Deno.test("a stage removed in the form takes its channel with it, and asks for a re-read", () => {
	const detail = detailOf([stageChannel("s1", "Discovery", 0), stageChannel("s2", "Build", 1)]);
	const p = projectSidebarProjection(
		detail,
		setupOf({ stages: [stageSetup("s1", "Discovery", 0)] }),
	);

	assertEquals(p.stages.length, 1);
	assertEquals(p.detail.channels.stages.map((s) => s.stageId), ["s1"]);
	assertEquals(p.staleKey, "|s2");
});

Deno.test("a reorder moves the rows and renumbers their order", () => {
	const detail = detailOf([stageChannel("s1", "Discovery", 0), stageChannel("s2", "Build", 1)]);
	const p = projectSidebarProjection(
		detail,
		setupOf({ stages: [stageSetup("s2", "Build", 0), stageSetup("s1", "Discovery", 1)] }),
	);

	assertEquals(p.stages.map((r) => r.id), ["s2", "s1"]);
	assertEquals(p.stages.map((r) => r.channel?.order), [0, 1]);
	// A reorder is fully expressible here, so it must NOT provoke a round trip.
	assertEquals(isStale(p), false);
});

Deno.test("the stale key describes the state, not the order it was walked in", () => {
	const detail = detailOf([stageChannel("s1", "A", 0), stageChannel("s2", "B", 1)]);
	const forward = projectSidebarProjection(
		detail,
		setupOf({ stages: [stageSetup("stage-draft-2", "X", 0), stageSetup("stage-draft-1", "Y", 1)] }),
	);
	const reversed = projectSidebarProjection(
		detail,
		setupOf({ stages: [stageSetup("stage-draft-1", "Y", 0), stageSetup("stage-draft-2", "X", 1)] }),
	);

	// The same unresolved state either way, so the lane must not read the engagement twice for it.
	assertEquals(forward.staleKey, reversed.staleKey);
	assertEquals(forward.staleKey, "stage-draft-1,stage-draft-2|s1,s2");
});
// #endregion

// #region The Direct Deliverable
Deno.test("a Direct Deliverable's empty stage list never erases the stored channels", () => {
	// `single_task` is staffed by roles and its form renders no stage list at all, so an empty array
	// is silence rather than a deletion. The root stage every project has must survive it.
	const detail = detailOf([stageChannel("s1", "Delivery", 0)]);
	const p = projectSidebarProjection(
		detail,
		setupOf({ structure: "single_task", format: "one_off", stages: [] }),
	);

	assertEquals(p.stages.map((r) => r.name), ["Delivery"]);
	assertEquals(p.stages[0].channel?.id, "chan-s1");
	assertEquals(p.detail.channels.stages.length, 1);
	// Nothing is outstanding: the draft was never describing this list.
	assertEquals(isStale(p), false);
	// Identity still follows the draft.
	assertEquals(p.detail.title, "Draft Title");
});

Deno.test("a flat pipeline DOES govern its stage list", () => {
	// `single_stage` hides the stage SECTION but still edits the root stage, so unlike `single_task`
	// its draft is a real statement about the list.
	const detail = detailOf([stageChannel("s1", "Delivery", 0)]);
	const p = projectSidebarProjection(
		detail,
		setupOf({ structure: "single_stage", stages: [stageSetup("s1", "The work", 0)] }),
	);

	assertEquals(p.stages[0].name, "The work");
});
// #endregion

// #region Why a stage has no channel
Deno.test("a stage the server has not acknowledged reads as unsaved", () => {
	// The baseline is the acknowledged copy, so a row the draft has and it does not is new work.
	const detail = detailOf([stageChannel("s1", "Discovery", 0)]);
	const baseline = setupOf({ stages: [stageSetup("s1", "Discovery", 0)] });
	const draft = setupOf({
		stages: [stageSetup("s1", "Discovery", 0), stageSetup("stage-draft-1", "Build", 1)],
	});
	const p = projectSidebarProjection(detail, draft, baseline);

	assertEquals(p.stages[0].pending, null);
	assertEquals(p.stages[1].pending, "unsaved");
});

Deno.test("a SAVED stage whose room is not provisioned is unlinked, never unsaved", () => {
	// The live path's ordinary state: rooms are created on first open, so every stage of a project
	// nobody has opened has none. Reporting that as unsaved would be a false claim about stored work.
	const detail = detailOf([]);
	const saved = setupOf({ stages: [stageSetup("s1", "Discovery", 0)] });
	const p = projectSidebarProjection(detail, saved, saved);

	assertEquals(p.stages.map((r) => r.name), ["Discovery"]);
	assertEquals(p.stages[0].pending, "unlinked");
});

Deno.test("a baseline for another engagement is not consulted", () => {
	// It would answer the wrong question, and answering it wrongly marks stored stages as unsaved.
	const detail = detailOf([]);
	const draft = setupOf({ stages: [stageSetup("s1", "Discovery", 0)] });
	const foreign = setupOf({ id: "22222222-2222-4222-8222-222222222222", stages: [] });
	const p = projectSidebarProjection(detail, draft, foreign);

	assertEquals(p.stages[0].pending, "unlinked");
});
// #endregion
