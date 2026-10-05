import type { ChannelKind, ProjectDetail, ProjectFormat } from "../types/projects-types.ts";
import { discussionOf, findStageChannel, isDiscussionRef } from "@projective/types/projects";
import { isSession, type SessionKind } from "./session-model.ts";
import { isTaskDetail } from "./task-project.ts";

/**
 * channel-view — the pure, DOM-free model behind a project channel/chat view
 * (`/projects/[projectId]/[channelId]/…`). It owns two concerns the SSR layout and the contextual
 * {@link ChannelHeader} both read: the ordered set of view **tabs** (with URL-driven active resolution)
 * and the {@link resolveChannelMeta} lookup that turns a routed `channelId` into the header's identity
 * (title + sub-line + kind). Kept side-effect-free so route SSR and any island derive identical results.
 */

// #region Tabs
/** One channel view tab. `seg` is the sub-path after the channel base (`""` = the default Chat/index). */
export interface ChannelTab {
	key: string;
	label: string;
	seg: string;
}

/**
 * The channel view tabs, in display order. Chat is the default (its `seg` is empty so the bare channel
 * base resolves to it). Each maps 1:1 to a route file under `[channelId]/` — the tabs are real anchors,
 * so active state is URL-driven and deep-links land on the right view.
 *
 * The order is the one every archetype's tab set in {@link CHANNEL_TAB_MATRIX} reads in — the work
 * views (Submissions · Tasks · Timeline) between Files and Members — so a set is always a SUBSEQUENCE
 * of this list and the header can render it by filtering.
 */
export const CHANNEL_TABS: ChannelTab[] = [
	{ key: "chat", label: "Chat", seg: "" },
	{ key: "files", label: "Files", seg: "files" },
	{ key: "submissions", label: "Submissions", seg: "submissions" },
	{ key: "calendar", label: "Calendar", seg: "calendar" },
	{ key: "tasks", label: "Tasks", seg: "tasks" },
	{ key: "timeline", label: "Timeline", seg: "timeline" },
	{ key: "members", label: "Members", seg: "members" },
	// LAST, and that is a placement rather than an ordering accident: it is the only tab that edits
	// the engagement rather than working inside it, and it is the only one most viewers never see.
	{ key: "details", label: "Details", seg: "details" },
];

/**
 * The active tab key for a channel pathname given its base (`/projects/{projectId}/{channelId}`). The
 * bare base and any unknown trailing segment both resolve to `chat` (the default tab / index route).
 */
export function activeTabOf(pathname: string, base: string): string {
	if (!pathname.startsWith(base)) return "chat";
	const rest = pathname.slice(base.length).replace(/^\/+/, "").split("/")[0] ?? "";
	const match = CHANNEL_TABS.find((t) => t.seg === rest);
	return match ? match.key : "chat";
}
// #endregion

// #region Tab visibility (Stage Access & Channel Header Tab Visibility)
/**
 * The task/deliverable tabs a stage channel shows only to a reviewer or to a freelancer assigned to
 * that stage — a freelancer not part of the stage loses them.
 */
export const STAGE_GATED_TAB_KEYS = ["submissions", "tasks", "timeline"] as const;

/** Which of the four project types a channel belongs to — the axis the tab matrix is keyed on. */
export type ChannelArchetype = "task" | "one_off" | "pipeline" | "session";

/**
 * The channel tab sets, by project type and by room — the maximum a viewer can see, before the role
 * gates in {@link visibleChannelTabKeys} narrow it.
 *
 *   - **Task** — Discussion: Chat. No stage channels.
 *   - **One-off** — Discussion: Chat · Files · Members · Details. Stage: Chat · Files · Submissions ·
 *     Members · Details.
 *   - **Pipeline** — Discussion: Chat · Files · Members · Details. Stage: Chat · Files · Submissions ·
 *     Tasks · Timeline · Members · Details.
 *   - **Session** — Discussion: Chat. No stage channels.
 *
 * `stage: null` means the type has no stage channels; a stage room reached by address there shows
 * Chat alone. Every other room (a team room, a DM, a session sub-group) shows Chat · Files · Members.
 */
export const CHANNEL_TAB_MATRIX: Record<
	ChannelArchetype,
	{ discussion: readonly string[]; stage: readonly string[] | null }
> = {
	task: { discussion: ["chat"], stage: null },
	one_off: {
		discussion: ["chat", "files", "members", "details"],
		stage: ["chat", "files", "submissions", "members", "details"],
	},
	pipeline: {
		discussion: ["chat", "files", "members", "details"],
		stage: ["chat", "files", "submissions", "tasks", "timeline", "members", "details"],
	},
	session: { discussion: ["chat"], stage: null },
};

/** The tabs of a room that is neither the discussion nor a stage — a team room, a DM, a sub-group. */
const OTHER_ROOM_TABS: readonly string[] = ["chat", "files", "members"];

/**
 * The channel's project type: a session archetype (real, or dev-simulated through `sessionKind`) wins,
 * then a Task, then the stored format.
 */
export function channelArchetype(
	access: Pick<ChannelTabAccess, "format" | "sessionKind" | "isTask">,
): ChannelArchetype {
	if (isSession(access.sessionKind) || access.format === "session") return "session";
	if (access.isTask) return "task";
	return access.format === "one_off" ? "one_off" : "pipeline";
}

/** The viewer capabilities that decide stage-tab visibility (resolved by the caller). */
export interface ChannelTabAccess {
	/** The channel's tree group — the gated tabs only ever apply on a `stage` channel. */
	channelKind: ChannelKind;
	/**
	 * The effective service archetype (task §2). A session (`normal`/`group`) shows the Calendar tab and
	 * hides Tasks/Submissions everywhere; a standard project (`none`) is the reverse.
	 */
	sessionKind: SessionKind;
	/** Client / project owner / admin / manager — always sees the stage surfaces. */
	isReviewer: boolean;
	/** Provider-side submitter. */
	isFreelancer: boolean;
	/** For a freelancer, whether they are assigned to THIS stage (an unassigned one loses the tabs). */
	stageAssigned: boolean;
	/**
	 * Whether the viewer may CONFIGURE the engagement — the project's owner, or a platform admin.
	 *
	 * Narrower than {@link ChannelTabAccess.isReviewer} on purpose, and the difference is the point.
	 * `isReviewer` answers "may this person review the work", which a client, a manager and an admin
	 * all can; this answers "may this person change the terms the work is being done under", which is
	 * the owner's alone. A stage's ticket price and its scope are what a freelancer accepted, so the
	 * seat that can rewrite them is not the same seat that can approve a submission.
	 */
	canConfigure: boolean;
	/**
	 * Whether the engagement is a Task (`isTaskDetail`). A Task has no Timeline and no Calendar
	 * (`TASK_ABSENT_VIEWS`) — one bar on one lane, and the window of a stage it does not have — so both
	 * tabs are absent whatever else is true, and the routes behind them refuse on the same set.
	 */
	isTask: boolean;
	/** The engagement's stored format — what tells a one-off's tab set from a pipeline's. */
	format: ProjectFormat;
	/** Whether the room is the engagement's Discussion (`/projects/{slug}/discussion`). */
	isDiscussion: boolean;
}

/**
 * The visible channel tab keys for a viewer: the room's set from {@link CHANNEL_TAB_MATRIX}, narrowed
 * by two role gates on a STAGE room.
 *
 * - `Submissions` / `Tasks` / `Timeline` — only for a reviewer (client/admin/manager) or a freelancer
 *   assigned to that stage.
 * - `Details` — only for a viewer who may configure the engagement
 *   ({@link ChannelTabAccess.canConfigure}): it edits the terms the stage's work is done under.
 *
 * The Discussion's `Details` is not gated: it opens the engagement's own Details page (the owner's
 * configuration workspace, a member's dashboard), which every member has.
 *
 * Absence, not refusal, for a gated viewer: a tab rendered and disabled advertises a capability and
 * then withholds it, and the route behind it refuses independently anyway.
 */
export function visibleChannelTabKeys(access: ChannelTabAccess): string[] {
	const sets = CHANNEL_TAB_MATRIX[channelArchetype(access)];
	const stageRoom = access.channelKind === "stage" && !access.isDiscussion;
	const allowed = access.isDiscussion
		? sets.discussion
		: stageRoom
		? sets.stage ?? ["chat"]
		: OTHER_ROOM_TABS;
	const stageGated = new Set<string>(STAGE_GATED_TAB_KEYS);
	const seated = access.isReviewer || (access.isFreelancer && access.stageAssigned);

	return CHANNEL_TABS.filter((t) => {
		if (!allowed.includes(t.key)) return false;
		if (!stageRoom) return true;
		if (t.key === "details") return access.canConfigure;
		if (stageGated.has(t.key)) return seated;
		return true;
	}).map((t) => t.key);
}

/**
 * Whether a viewer may open the stage Details tab — the ONE rule the tab, the route guard and the
 * write path all read.
 *
 * Stated as its own function rather than inlined into the filter above so the ROUTE can ask the same
 * question. A tab hidden by one predicate and a route guarded by another is how a link disappears
 * while its URL stays open, which is a gate that only holds for people who do not type addresses.
 */
export function canConfigureStage(
	access: Pick<ChannelTabAccess, "channelKind" | "canConfigure">,
): boolean {
	return access.channelKind === "stage" && access.canConfigure;
}
// #endregion

// #region Channel meta
/** The header identity for a resolved channel — its display title, context sub-line, and group kind. */
export interface ChannelMeta {
	/**
	 * The segment that ADDRESSED this channel — a stage's `stg-…` slug, or a general/team/DM channel
	 * id. What a link is rebuilt from, and never what a channel is looked up by.
	 *
	 * Separate from {@link ChannelMeta.channelId} because for a stage the two are different strings:
	 * the URL carries the stage's permanent address while the room behind it is a `comms` row whose id
	 * appears nowhere in the path. Collapsing them into one field is how a slug ends up posted as a
	 * channel id — which type-checks, because both are `string`.
	 */
	ref: string;
	/**
	 * The `comms.project_channels` row this address opens — the id every channel-scoped read and write
	 * takes. Unchanged in meaning by stage-slug routing: a stage's ref resolves THROUGH to its room.
	 */
	channelId: string;
	/**
	 * The `projects.project_stages` row behind a stage channel; `null` on general/team/DM.
	 *
	 * Carried here so a surface that needs the configuration row does not have to re-walk the tree to
	 * find it — the walk that produced this object is the only place all three keys are held at once.
	 */
	stageId: string | null;
	/** The channel name shown as the header title (e.g. "General", a stage name, a DM party name). */
	title: string;
	/** A short context sub-line under the title (the engagement it belongs to). */
	sub: string;
	/** Which of the four tree groups the channel belongs to (drives the leading mark glyph). */
	kind: ChannelKind;
}

/**
 * Resolve the header identity for a routed `channelId` within a {@link ProjectDetail}, or `null` when the
 * segment names no channel (e.g. a project-view path like `/projects/{slug}/board`, which is NOT a
 * channel and gets no channel header). The route-id convention mirrors {@link channelHref}/`ChannelTree`:
 * general + team channels key off `channel.id`, stages off `stage.id`, and DMs off the unified `chatId`.
 *
 * `discussion` resolves to the engagement's discussion room (`discussionOf`, the rule the server
 * resolves the same word by): a Task's stage room, headed as the Task, or the project-wide room,
 * headed "Discussion". Its `ref` stays the word, so every tab under it keeps the canonical address.
 */
export function resolveChannelMeta(detail: ProjectDetail, ref: string): ChannelMeta | null {
	const { general, stages, teams, dms } = detail.channels;

	if (isDiscussionRef(ref)) {
		const room = discussionOf(detail);
		if (!room) return null;
		if (room.kind === "stage") {
			return {
				ref,
				channelId: room.stage.id,
				stageId: room.stage.stageId,
				title: detail.title,
				sub: "Task discussion",
				kind: "stage",
			};
		}
		return {
			ref,
			channelId: room.channel.id,
			stageId: null,
			title: "Discussion",
			sub: detail.title,
			kind: "general",
		};
	}

	for (const c of general) {
		if (c.id === ref) {
			return { ref, channelId: c.id, stageId: null, title: c.name, sub: detail.title, kind: "general" };
		}
	}
	// Delegated rather than written out, so the stage-addressing rule has ONE implementation. It lives
	// in the types package beside the schema that declares the three keys, which is also the only place
	// it can be unit-tested: this module reaches `dev-seam` transitively, and that reads
	// `import.meta.env`, which exists only under Vite.
	const stage = findStageChannel(stages, ref);
	if (stage) {
		// A Task's one stage IS the Task — the reader never configured it as a stage and the setup form
		// shows no stage list — so its room is headed as the Task's discussion rather than as "Delivery ·
		// Stage", a name for machinery the Task does not expose. It stays `kind: "stage"`, because that is
		// what the room is and what its Tasks and Submissions tabs are gated on.
		const task = isTaskDetail(detail);
		return {
			ref,
			channelId: stage.id,
			stageId: stage.stageId,
			title: task ? detail.title : stage.name,
			sub: task ? "Task discussion" : `${detail.title} · Stage`,
			kind: "stage",
		};
	}
	for (const t of teams) {
		for (const c of t.channels) {
			if (c.id === ref) {
				return { ref, channelId: c.id, stageId: null, title: c.name, sub: t.teamName, kind: "team" };
			}
		}
	}
	for (const d of dms) {
		if (d.chatId === ref) {
			return { ref, channelId: d.chatId, stageId: null, title: d.party.name, sub: detail.title, kind: "dm" };
		}
	}
	return null;
}
// #endregion
