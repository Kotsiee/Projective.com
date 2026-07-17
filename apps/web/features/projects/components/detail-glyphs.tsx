import type { JSX } from "preact";
import type { ProjectDetail, ProjectFormat } from "../types/projects-types.ts";

/**
 * Project Details sidebar glyphs — minimal 1em `currentColor` stroke icons for the deep single-project
 * view (back nav, the core view links, the four channel-tree groups). Co-located inline SVG, matching
 * the feed's `glyphs.tsx` convention (the package has no icon registry). Each inherits font-size so
 * the sidebar can size them precisely against the type ramp.
 */

// #region Base
function Svg(props: JSX.SVGAttributes<SVGSVGElement>): JSX.Element {
	return (
		<svg
			viewBox="0 0 24 24"
			width="1em"
			height="1em"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			{...props}
		/>
	);
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
		<path d="M12 3v2.5M12 18.5V21M4.2 7.5l2.2 1.3M17.6 15.2l2.2 1.3M4.2 16.5l2.2-1.3M17.6 8.8l2.2-1.3" />
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

/** One core view destination of a Project Details engagement (Details · Board · … · Settings). */
export interface ProjectViewLink {
	key: string;
	label: string;
	icon: JSX.Element;
	/** Sub-path segment after `/projects/{slug}` (`""` for the Details root). */
	seg: string;
}

/**
 * The ordered core view links for an engagement, with the Board entry DYNAMICALLY labelled off the
 * engagement format/kind (Pipeline · Timeline · Calendar). Shared by the expanded footer nav
 * ({@link ProjectViewNav}) and the collapsed icon rail so both stay in lockstep.
 */
export function projectViewLinks(detail: ProjectDetail): ProjectViewLink[] {
	const board = boardView(detail.format, detail.kind);
	return [
		{ key: "details", label: "Details", icon: DetailsIcon, seg: "" },
		{ key: "board", label: board.label, icon: board.icon, seg: "board" },
		{ key: "members", label: "Members", icon: MembersIcon, seg: "members" },
		{ key: "attachments", label: "Attachments", icon: AttachmentsIcon, seg: "attachments" },
		{ key: "submissions", label: "Submissions", icon: SubmissionsIcon, seg: "submissions" },
		{ key: "finances", label: "Finances", icon: FinancesIcon, seg: "finances" },
		{ key: "settings", label: "Settings", icon: SettingsIcon, seg: "settings" },
	];
}
// #endregion
