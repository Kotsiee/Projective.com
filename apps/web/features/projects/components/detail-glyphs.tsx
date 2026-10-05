import { cloneElement, type JSX } from "preact";
import type { ProjectDetail, ProjectFormat } from "../types/projects-types.ts";
import { IconShell } from "@projective/ui/icons";
import { ChatIcon, FilesIcon } from "./channel-glyphs.tsx";
import { discussionLinkOf } from "../core/chat-context.ts";
import { isTaskDetail } from "../core/task-project.ts";

/**
 * Project Details sidebar glyphs — minimal 1em `currentColor` stroke icons for the deep single-project
 * view (back nav, the core view links, the four channel-tree groups). Co-located inline SVG, matching
 * the feed's `glyphs.tsx` convention (the package has no icon registry). Each inherits font-size so
 * the sidebar can size them precisely against the type ramp.
 */

// #region Base
function Svg(props: JSX.SVGAttributes<SVGSVGElement>): JSX.Element {
	return <IconShell {...props} />;
}
// #endregion

// #region Header
/** A left-pointing arrow — the Back-to-feed control. */
export const BackIcon = (
	<Svg>
		<path d="M15 6l-6 6 6 6" />
	</Svg>
);
// #endregion

// #region Core view links
/** Overview / details — a document with lines. */
export const DetailsIcon = (
	<Svg>
		<rect x="5" y="3.5" width="14" height="17" rx="2" />
		<path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
	</Svg>
);

/** Pipeline board (Kanban) — columns. */
export const PipelineIcon = (
	<Svg>
		<rect x="3" y="4" width="5" height="16" rx="1.2" />
		<rect x="10" y="4" width="5" height="11" rx="1.2" />
		<rect x="17" y="4" width="4" height="7" rx="1.2" />
	</Svg>
);

/** Timeline board (one-off) — a horizontal track with milestone nodes. */
export const TimelineIcon = (
	<Svg>
		<path d="M3 12h18" />
		<circle cx="7" cy="12" r="2" />
		<circle cx="13" cy="12" r="2" />
		<circle cx="19" cy="12" r="2" />
	</Svg>
);

/** Calendar board (service sessions). */
export const CalendarIcon = (
	<Svg>
		<rect x="4" y="5" width="16" height="15" rx="2" />
		<path d="M4 9h16M8 3v4M16 3v4" />
	</Svg>
);

/** Members — a small group of people. */
export const MembersIcon = (
	<Svg>
		<circle cx="9" cy="9" r="3" />
		<path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
		<path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19a5.5 5.5 0 0 0-3-4.9" />
	</Svg>
);

/** Attachments — a paperclip. */
export const AttachmentsIcon = (
	<Svg>
		<path d="M8 12.5l6.5-6.5a3 3 0 0 1 4.2 4.2l-8 8a5 5 0 0 1-7-7l7.5-7.5" />
	</Svg>
);

/** Submissions — an outbox tray with an up arrow. */
export const SubmissionsIcon = (
	<Svg>
		<path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
		<path d="M12 16V4M8 8l4-4 4 4" />
	</Svg>
);

/** Finances — a wallet. */
export const FinancesIcon = (
	<Svg>
		<rect x="3.5" y="6" width="17" height="13" rx="2.5" />
		<path d="M3.5 10h17" />
		<circle cx="16.5" cy="14" r="1.1" fill="currentColor" stroke="none" />
	</Svg>
);

/** Settings — a gear. */
export const SettingsIcon = (
	<Svg>
		<circle cx="12" cy="12" r="3" />
		<path d="M9.89 5.11L10.19 2.67A9.5 9.5 0 0 1 13.81 2.67L14.11 5.11A7.2 7.2 0 0 1 16.91 6.73L19.17 5.77A9.5 9.5 0 0 1 20.98 8.91L19.02 10.38A7.2 7.2 0 0 1 19.02 13.62L20.98 15.09A9.5 9.5 0 0 1 19.17 18.23L16.91 17.27A7.2 7.2 0 0 1 14.11 18.89L13.81 21.33A9.5 9.5 0 0 1 10.19 21.33L9.89 18.89A7.2 7.2 0 0 1 7.09 17.27L4.83 18.23A9.5 9.5 0 0 1 3.02 15.09L4.98 13.62A7.2 7.2 0 0 1 4.98 10.38L3.02 8.91A9.5 9.5 0 0 1 4.83 5.77L7.09 6.73A7.2 7.2 0 0 1 9.89 5.11Z" />
	</Svg>
);
// #endregion

// #region Channel-tree group glyphs
/** General group — a hash / channel mark. */
export const HashIcon = (
	<Svg>
		<path d="M9 4L7 20M17 4l-2 16M4 9h16M3 15h16" />
	</Svg>
);

/** Stages group — stacked layers. */
export const StagesIcon = (
	<Svg>
		<path d="M12 3l8 4.5-8 4.5-8-4.5z" />
		<path d="M4 12l8 4.5 8-4.5M4 16.5l8 4.5 8-4.5" />
	</Svg>
);

/** Teams group — people (reused shape, distinct from Members' link icon by context). */
export const TeamsIcon = (
	<Svg>
		<circle cx="8" cy="8.5" r="2.6" />
		<circle cx="16" cy="8.5" r="2.6" />
		<path d="M3 18a5 5 0 0 1 10 0M13 18a5 5 0 0 1 8-3.7" />
	</Svg>
);

/** Direct messages group — a chat bubble. */
export const DmIcon = (
	<Svg>
		<path d="M5 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3.5V7a2 2 0 0 1 2-2z" />
	</Svg>
);

/** A right chevron for accordion disclosure (rotates down when open, via CSS). */
export const DiscloseIcon = (
	<Svg>
		<path d="M9 6l6 6-6 6" />
	</Svg>
);
// #endregion

// #region Channel-header action glyphs (kebab menu + drawer)
/** Mute notifications — a bell. */
export const BellIcon = (
	<Svg>
		<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" />
		<path d="M10 20a2 2 0 0 0 4 0" />
	</Svg>
);

/** Muted notifications — a bell with a slash. */
export const BellOffIcon = (
	<Svg>
		<path d="M8.5 4.5A6 6 0 0 1 18 9c0 3 1 4.5 1.6 5.3M6 9c0 5-2 6-2 6h11" />
		<path d="M10 20a2 2 0 0 0 4 0" />
		<path d="M3 3l18 18" />
	</Svg>
);

/** Pin channel — a push-pin. */
export const PinIcon = (
	<Svg>
		<path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6z" />
		<path d="M12 18v3" />
	</Svg>
);

/** Channel info — a circled i. */
export const InfoIcon = (
	<Svg>
		<circle cx="12" cy="12" r="8.5" />
		<path d="M12 11v5" />
		<circle cx="12" cy="7.8" r="0.6" fill="currentColor" stroke="none" />
	</Svg>
);

/** Copy link — two chain links. */
export const LinkIcon = (
	<Svg>
		<path d="M9.5 13.5l5-5" />
		<path d="M8 11l-2 2a3 3 0 0 0 4.2 4.2l2-2" />
		<path d="M16 13l2-2a3 3 0 0 0-4.2-4.2l-2 2" />
	</Svg>
);

/** A clock — the stage/session deadline row. */
export const ClockIcon = (
	<Svg>
		<circle cx="12" cy="12" r="8.5" />
		<path d="M12 7.5V12l3 2" />
	</Svg>
);
// #endregion

// #region Helpers
/**
 * The dynamic Board-view label + icon for an engagement, per PRODUCT_SPEC: a pipeline renders a
 * Kanban ("Pipeline"), a one-off renders a "Timeline", and a service renders a "Calendar".
 */
export function boardView(format: ProjectFormat, kind: "project" | "service"): {
	label: string;
	icon: JSX.Element;
} {
	if (kind === "service" || format === "session") {
		return { label: "Calendar", icon: CalendarIcon };
	}
	if (format === "one_off") return { label: "Timeline", icon: TimelineIcon };
	return { label: "Pipeline", icon: PipelineIcon };
}

/** The lane's primary view set — which archetype's top tier to draw. */
export type ProjectNavArchetype = "task" | "one_off" | "pipeline" | "session";

/**
 * Which top tier an engagement gets. A session archetype (real or dev-simulated) wins, exactly as it
 * wins the lane's body; then a Task; then the stored format.
 */
export function projectNavArchetype(
	detail: Pick<ProjectDetail, "format" | "structure">,
	sessionKind: "none" | "normal" | "group" = "none",
): ProjectNavArchetype {
	if (sessionKind !== "none" || detail.format === "session") return "session";
	if (isTaskDetail(detail)) return "task";
	return detail.format === "one_off" ? "one_off" : "pipeline";
}

/** One primary view of an engagement — a top-tier lane destination (Discussion · Board · Files · …). */
export interface ProjectViewLink {
	key: string;
	label: string;
	icon: JSX.Element;
	/** Sub-path segment after `/projects/{slug}` (`""` for the Details root). */
	seg: string;
	/**
	 * Whether the link stays current on every page BENEATH it, not only on its own. True for the
	 * Discussion, whose room has its own tabs (Files, Members, Tasks, …): a reader on the room's Files
	 * view is still in the discussion, and the link going dark there would say they had left it.
	 */
	prefix?: boolean;
	/**
	 * The link's status mark — something under it is awaiting the viewer (§D.1: a dot, never a count).
	 * `label` is what the dot means, spoken in the link's accessible name and shown in the collapsed
	 * rail's tooltip; `null` when there is nothing to report.
	 */
	status: { label: string } | null;
}

/**
 * The engagement's primary views, in lane order — the top tier under the project header, and the
 * collapsed rail's icon column. ONE set for both presentations, so they cannot disagree.
 *
 *   - **Task** — Discussion · Details · Files · Submissions · Members. No Board and no Timeline: one
 *     ticket on one stage has nothing to lay out (Decision #121). Its Discussion carries Chat alone, so
 *     the engagement's Details page is a view of its own here.
 *   - **One-off** — Discussion · Timeline · Files · Submissions · Members. A one-off's board IS its
 *     timeline (PRODUCT_SPEC §Project Types), so it gets the Gantt and no Kanban.
 *   - **Pipeline** — Discussion · Board · Files · Submissions · Members. Its timeline is a stage's view
 *     (the stage channel's Timeline tab), not a lane destination.
 *   - **Session** (a `session` engagement, or a dev-simulated session archetype) — Discussion · Calendar
 *     · Files · Members. A session has no stage submissions, and its time axis is a calendar.
 *
 * **Discussion** leads every set and is the engagement's one primary conversation at a fixed address
 * (`/projects/{slug}/discussion`); it is ABSENT when the engagement has no room for it
 * ({@link discussionLinkOf}) rather than a link to "no such channel". On every other type Details is
 * the lane footer's utility (and the Discussion's Details tab), not a view of the work.
 *
 * The status marks are the projection's own facts, never invented: the discussion room's unread; a
 * stage with a new ticket on the Board; a stage whose submission came back for revision on Submissions.
 */
export function projectViewLinks(
	detail: ProjectDetail,
	sessionKind: "none" | "normal" | "group" = "none",
): ProjectViewLink[] {
	const archetype = projectNavArchetype(detail, sessionKind);
	const stages = detail.channels.stages;
	const anyStage = (activity: string) => stages.some((s) => s.activity === activity);
	const links: ProjectViewLink[] = [];

	const discussion = discussionLinkOf(detail);
	if (discussion) {
		links.push({
			key: "discussion",
			label: "Discussion",
			icon: ChatIcon,
			seg: discussion.ref,
			prefix: true,
			status: discussion.unread ? { label: "unread messages" } : null,
		});
	}
	if (archetype === "task") {
		// A copy: the lane footer mounts `DetailsIcon` itself, and one VNode cannot be mounted twice.
		links.push({
			key: "details",
			label: "Details",
			icon: cloneElement(DetailsIcon),
			seg: "",
			status: null,
		});
	}
	if (archetype === "pipeline") {
		links.push({
			key: "board",
			label: "Board",
			icon: PipelineIcon,
			seg: "board",
			status: anyStage("new_ticket") ? { label: "new tickets" } : null,
		});
	}
	if (archetype === "one_off") {
		links.push({
			key: "timeline",
			label: "Timeline",
			icon: TimelineIcon,
			seg: "timeline",
			status: null,
		});
	}
	if (archetype === "session") {
		links.push({
			key: "calendar",
			label: "Calendar",
			icon: CalendarIcon,
			seg: "calendar",
			status: null,
		});
	}
	links.push({ key: "files", label: "Files", icon: FilesIcon, seg: "files", status: null });
	if (archetype !== "session") {
		links.push({
			key: "submissions",
			label: "Submissions",
			icon: SubmissionsIcon,
			seg: "submissions",
			// Submissions is a WILDCARD route: a stage, a submitter and a unit are pages beneath it.
			prefix: true,
			status: anyStage("revision_requested") ? { label: "revision requested" } : null,
		});
	}
	links.push({ key: "members", label: "Members", icon: MembersIcon, seg: "members", status: null });
	return links;
}

/**
 * How a view link marks the reader's current place: `page` when the path IS the link's own, `true`
 * when it is a page beneath a {@link ProjectViewLink.prefix} link (the section rather than the page),
 * `null` otherwise. One rule for the expanded top tier and the collapsed rail, so the two
 * presentations of one link set cannot disagree about where the reader is.
 */
export function viewLinkCurrent(
	currentPath: string,
	base: string,
	link: Pick<ProjectViewLink, "seg" | "prefix">,
): "page" | "true" | null {
	const href = link.seg ? `${base}/${link.seg}` : base;
	if (currentPath === href || currentPath === `${href}/`) return "page";
	if (link.prefix && currentPath.startsWith(`${href}/`)) return "true";
	return null;
}
// #endregion
