import type { JSX } from "preact";
import type { ProjectFormat } from "../types/projects-types.ts";
import { IconShell } from "@projective/ui/icons";

/**
 * Feed glyphs — minimal 1em `currentColor` stroke icons for the projects lane. Co-located inline SVG
 * (the package has no icon registry; the shell does the same in `core/nav-icons.tsx`). Each inherits
 * font-size so the high-density list can size them precisely against the type ramp.
 */

// #region Base
function Svg(props: JSX.SVGAttributes<SVGSVGElement>): JSX.Element {
	return <IconShell {...props} />;
}
// #endregion

// #region Format glyphs (Pipeline = board columns, One-off = single sprint, Session = calendar)
const PIPELINE = (
	<Svg>
		<rect x="3" y="4" width="5" height="16" rx="1.2" />
		<rect x="10" y="4" width="5" height="11" rx="1.2" />
		<rect x="17" y="4" width="4" height="7" rx="1.2" />
	</Svg>
);

const ONE_OFF = (
	<Svg>
		<path d="M5 4v16" />
		<path d="M5 5h11l-2 3 2 3H5" />
	</Svg>
);

const SESSION = (
	<Svg>
		<rect x="4" y="5" width="16" height="15" rx="2" />
		<path d="M4 9h16M8 3v4M16 3v4" />
	</Svg>
);

/** The glyph for an engagement's work-flow format. */
export function FormatGlyph({ format }: { format: ProjectFormat }): JSX.Element {
	if (format === "pipeline") return PIPELINE;
	if (format === "session") return SESSION;
	return ONE_OFF;
}
// #endregion

// #region UI glyphs
/** A plus for the Create action. */
export const PlusIcon = (
	<Svg>
		<path d="M12 5v14M5 12h14" />
	</Svg>
);

/** A magnifier for the search field. */
export const SearchIcon = (
	<Svg>
		<circle cx="11" cy="11" r="7" />
		<path d="m20 20-3.2-3.2" />
	</Svg>
);

/** An eye — the "Preview" (how freelancers see it) tab. */
export const EyeIcon = (
	<Svg>
		<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" />
		<circle cx="12" cy="12" r="2.6" />
	</Svg>
);

/** A pencil — the "Edit" tab / inline project editor. */
export const EditIcon = (
	<Svg>
		<path d="M12 20h9" />
		<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
	</Svg>
);

/** A star outline (filled via CSS when starred). */
export const StarIcon = (
	<Svg>
		<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
	</Svg>
);

/** Envelope — the Unread state toggle in the utility bar. */
export const MailIcon = (
	<Svg>
		<rect x="3" y="5" width="18" height="14" rx="2.4" />
		<path d="m4 7 8 6 8-6" />
	</Svg>
);

/** A small down chevron for the sort control + the advanced-filters disclosure. */
export const ChevronIcon = (
	<Svg>
		<path d="m6 9 6 6 6-6" />
	</Svg>
);

/** Horizontal sliders — the Smart Filter popover trigger. */
export const SlidersIcon = (
	<Svg>
		<path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
		<circle cx="16" cy="7" r="2.2" />
		<circle cx="8" cy="17" r="2.2" />
	</Svg>
);

/** A check mark — a confirmed combo option / active service. */
export const CheckIcon = (
	<Svg>
		<path d="m5 12.5 4.5 4.5L19 6.5" />
	</Svg>
);

/** A small close cross — removes a workspace tag from the combo / a rejected-review badge. */
export const CloseIcon = (
	<Svg>
		<path d="M6 6l12 12M18 6L6 18" />
	</Svg>
);

/** A vertical three-dot kebab — the per-card action menu trigger. */
export const KebabIcon = (
	<Svg fill="currentColor" stroke="none">
		<circle cx="12" cy="5" r="1.7" />
		<circle cx="12" cy="12" r="1.7" />
		<circle cx="12" cy="19" r="1.7" />
	</Svg>
);

/** A horizontal ticket stub — the "new ticket available" involvement badge. */
export const TicketIcon = (
	<Svg>
		<path d="M4 9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2 2 0 0 0 0-4z" />
		<path d="M14 7.5v9" stroke-dasharray="1.6 1.8" />
	</Svg>
);
// #endregion

// #region Card-menu glyphs (leading icons for the kebab dropdown)
/** Open the engagement in a new browser tab. */
export const ExternalLinkIcon = (
	<Svg>
		<path d="M14 4h6v6" />
		<path d="M20 4l-8 8" />
		<path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
	</Svg>
);

/** Share / copy a link to the engagement. */
export const ShareIcon = (
	<Svg>
		<circle cx="6" cy="12" r="2.3" />
		<circle cx="17" cy="6" r="2.3" />
		<circle cx="17" cy="18" r="2.3" />
		<path d="M8.1 11l6.8-3.9M8.1 13l6.8 3.9" />
	</Svg>
);

/** Flag / report the engagement. */
export const FlagIcon = (
	<Svg>
		<path d="M5 21V4" />
		<path d="M5 5h11l-1.6 3L16 11H5" />
	</Svg>
);

/** Leave / step out of the engagement. */
export const LeaveIcon = (
	<Svg>
		<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
		<path d="M15 8l4 4-4 4" />
		<path d="M19 12H9" />
	</Svg>
);

/** A waste bin — the destructive delete action. */
export const TrashIcon = (
	<Svg>
		<path d="M4 7h16" />
		<path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
		<path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
		<path d="M10 11v6M14 11v6" />
	</Svg>
);
// #endregion

// #region Activity glyphs (the single icon-only footer Status Icon per card)
/** Revision requested — a curved revise/redo arrow. */
export const RevisionIcon = (
	<Svg>
		<path d="M4 9h9a5 5 0 0 1 0 10H7" />
		<path d="M7 6 4 9l3 3" />
	</Svg>
);

/** Pending review — an hourglass (submission sent, awaiting the client). */
export const HourglassIcon = (
	<Svg>
		<path d="M7 4h10M7 20h10" />
		<path d="M8 4c0 4 4 5 4 8 0-3 4-4 4-8" />
		<path d="M8 20c0-4 4-5 4-8 0 3 4 4 4 8" />
	</Svg>
);

/** Client invite / incoming hire request — a person with a plus. */
export const InviteIcon = (
	<Svg>
		<circle cx="9" cy="8" r="3.2" />
		<path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
		<path d="M18 7v6M15 10h6" />
	</Svg>
);

/** Paid service request awaiting acceptance — an inbox tray with an incoming arrow. */
export const ServiceRequestIcon = (
	<Svg>
		<path d="M4 13v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
		<path d="M4 13h4l1.5 2.5h5L18 13h2" />
		<path d="M12 3v6M9.5 6.5 12 9l2.5-2.5" />
	</Svg>
);
// #endregion

// #region Ownership glyphs (the subtle per-card Owner vs. Worker marker)
/** All involvements — a 2×2 grid standing for "every engagement". */
export const AllRolesIcon = (
	<Svg>
		<rect x="4" y="4" width="7" height="7" rx="1.6" />
		<rect x="13" y="4" width="7" height="7" rx="1.6" />
		<rect x="4" y="13" width="7" height="7" rx="1.6" />
		<rect x="13" y="13" width="7" height="7" rx="1.6" />
	</Svg>
);

/** Owner / client / admin — a small key (holds the engagement). */
export const OwnerRoleIcon = (
	<Svg>
		<circle cx="8" cy="8" r="3.5" />
		<path d="M10.5 10.5 19 19" />
		<path d="M16 16l2-2M18.5 18.5l1.5-1.5" />
	</Svg>
);

/** Worker / contributor — a small wrench (does the work). */
export const WorkerRoleIcon = (
	<Svg>
		<path d="M15.5 4.5a4 4 0 0 0-5 5L4 16v4h4l6.5-6.5a4 4 0 0 0 5-5l-2.6 2.6-2.5-.4-.4-2.5z" />
	</Svg>
);
// #endregion

// #region Lane chrome glyphs
/** An inbox tray — the footer's combined "incoming requests" toggle (badge-counted). */
export const InboxIcon = (
	<Svg>
		<path d="M6 4h12l2 9v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5z" />
		<path d="M4 13h4a4 4 0 0 0 8 0h4" />
	</Svg>
);
// #endregion

// #region Status glyphs (the icon-only Status matrix in the filter popover)
const STATUS_DRAFT = (
	<Svg>
		<path d="M4 12h4M11 12h2M16 12h4" />
	</Svg>
);
const STATUS_ACTIVE = (
	<Svg>
		<circle cx="12" cy="12" r="7" />
		<path d="M12 8v4l2.5 2.5" />
	</Svg>
);
const STATUS_HOLD = (
	<Svg>
		<path d="M9 6v12M15 6v12" />
	</Svg>
);
const STATUS_DONE = (
	<Svg>
		<circle cx="12" cy="12" r="8" />
		<path d="m8.5 12 2.5 2.5 4.5-5" />
	</Svg>
);
const STATUS_CANCELLED = (
	<Svg>
		<circle cx="12" cy="12" r="8" />
		<path d="m8.5 8.5 7 7" />
	</Svg>
);

/** The glyph for a lifecycle status in the icon-only Status matrix. */
export function StatusGlyph({ status }: { status: string }): JSX.Element {
	switch (status) {
		case "active":
			return STATUS_ACTIVE;
		case "on_hold":
			return STATUS_HOLD;
		case "completed":
			return STATUS_DONE;
		case "cancelled":
			return STATUS_CANCELLED;
		default:
			return STATUS_DRAFT;
	}
}
// #endregion
