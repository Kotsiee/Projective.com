import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import ChannelHeader, { type ChannelDetailInfo } from "../islands/ChannelHeader.island.tsx";
import { activeTabOf, resolveChannelMeta, visibleChannelTabKeys } from "./channel-view.ts";
import { resolveSessionKind } from "./session-model.ts";
import { resolveProjectDetail } from "./detail-ssr.ts";
import type { ChannelMeta } from "./channel-view.ts";
import type { ProjectDetail, ProjectStatus } from "../types/projects-types.ts";

/**
 * channel-header-slot — the SSR-idiomatic resolver for the middle-nav content pane's configurable
 * header slot. It is the server equivalent of a page "registering" a header with the shell: rather
 * than a client React context (which cannot paint the slot on the first SSR byte and does not persist
 * across Fresh's per-navigation renders), the `(dashboard)` layout calls {@link channelHeaderFor} with
 * the request URL and the acting context, and threads the result into `UserShell`'s `middleNavHeader`
 * → the frame's header band. So the correct header (or none) ships in the first byte with no
 * client-context flash, exactly as the lane itself is resolved by `laneFor`.
 *
 * Server-only (it reaches `@server/services` via {@link resolveProjectDetail}); never imported by an
 * island.
 */

// #region Detail-info builder (the Stage Details / Channel Info drawer summary)
const STATUS_LABEL: Record<ProjectStatus, string> = {
	draft: "Draft",
	active: "Active",
	on_hold: "On hold",
	completed: "Completed",
	cancelled: "Cancelled",
};

const KIND_LABEL: Record<ChannelMeta["kind"], string> = {
	general: "General channel",
	stage: "Stage",
	team: "Team channel",
	dm: "Direct message",
};

/** A deterministic due-date label (no `Date` — SSR/hydration stable), keyed off the channel id. */
const DEADLINE_POOL = [
	"Mon · Jul 21",
	"Wed · Jul 23",
	"Fri · Jul 25",
	"Tue · Jul 29",
	"Thu · Jul 31",
];

/** A tiny stable hash → non-negative int. */
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

/**
 * Build the serializable summary the details drawer renders. Stage channels get a deadline + a progress
 * meter + assigned members; other channels get their kind + member roster. All derived deterministically
 * from the SSR-resolved {@link ProjectDetail} so the drawer agrees with the engagement it belongs to.
 */
function buildDetailInfo(detail: ProjectDetail, meta: ChannelMeta): ChannelDetailInfo {
	const members = detail.members.slice(0, 6).map((m) => ({
		name: m.party.name,
		avatar: m.party.avatar,
	}));

	if (meta.kind !== "stage") {
		return { kindLabel: KIND_LABEL[meta.kind], members };
	}

	const stage = detail.channels.stages.find((s) => s.id === meta.channelId);
	const status = stage?.status ?? detail.status;
	const h = hash(meta.channelId);
	const total = 4 + (h % 5); // 4–8 tasks
	const done = status === "completed"
		? total
		: status === "active"
		? Math.max(1, Math.round(total * 0.5))
		: 0;

	return {
		kindLabel: KIND_LABEL.stage,
		statusLabel: STATUS_LABEL[status],
		deadlineLabel: status === "completed" ? undefined : DEADLINE_POOL[h % DEADLINE_POOL.length],
		progress: { done, total },
		members,
	};
}
// #endregion

/**
 * Resolve the pane header for a request: the contextual {@link ChannelHeader} on a specific project
 * channel route (`/projects/[projectId]/[channelId]` and its tab sub-paths), else `null` so the slot
 * collapses and the page body fills the top of the pane (no empty bar).
 *
 * A channel route is recognised by looking the second path segment up in the resolved project's channel
 * set — so a project-view path that shares the URL space (e.g. `/projects/{slug}/board`) is NOT a
 * channel and correctly yields no header.
 */
export function channelHeaderFor(url: URL, context: UserContext): ComponentChildren {
	const segs = url.pathname.split("/").filter(Boolean); // ["projects", projectId, channelId, ...tab]
	if (segs[0] !== "projects" || segs.length < 3 || segs[1] === "create") return null;

	const [, projectId, channelId] = segs;
	const { detail } = resolveProjectDetail(projectId, context);
	if (!detail) return null;

	const meta = resolveChannelMeta(detail, channelId);
	if (!meta) return null;

	const base = `/projects/${projectId}/${channelId}`;
	// SSR-resolved service archetype baseline (task §2): a `session`-format engagement is a 1-1 session,
	// anything else a standard project. The island re-derives it live from the dev Context Switcher.
	const sessionKind = resolveSessionKind(detail.format, null);
	// SSR-resolved tab visibility from the REAL session (Stage Access + Session matrix): a reviewer is
	// the client; a real freelancer opening a stage channel is assigned to it. The island re-derives this
	// live from the dev Context Switcher after hydration, so the first byte matches the real capabilities.
	const isReviewer = detail.viewerIsClient;
	const visibleTabs = visibleChannelTabKeys({
		channelKind: meta.kind,
		sessionKind,
		isReviewer,
		isFreelancer: !isReviewer,
		stageAssigned: true,
	});

	return (
		<ChannelHeader
			base={base}
			meta={meta}
			activeTab={activeTabOf(url.pathname, base)}
			starred={detail.starred}
			visibleTabs={visibleTabs}
			viewerIsClient={detail.viewerIsClient}
			sessionKind={sessionKind}
			detailInfo={buildDetailInfo(detail, meta)}
		/>
	);
}
