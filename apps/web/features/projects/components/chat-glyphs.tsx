import type { JSX } from "preact";
import { IconShell } from "@projective/ui/icons";

/**
 * Chat-feed glyphs — the icons unique to the message feed (hover toolbar, audio transport, pinned
 * banner, system notices, empty state, the favourite "wonky star") that the feed
 * ({@link file://./glyphs.tsx}) and channel-header ({@link file://./channel-glyphs.tsx}) sets don't
 * already cover. Co-located inline SVG matching those sets — 1em `currentColor` strokes that inherit
 * font-size. Reused from elsewhere: Pin (channel-glyphs), Star/Kebab/Flag/Close/Check/Chevron/Ticket/
 * Revision/Hourglass (glyphs).
 */

// #region Base
function Svg(props: JSX.SVGAttributes<SVGSVGElement>): JSX.Element {
	return <IconShell {...props} />;
}
// #endregion

// #region Hover toolbar
/** Reply — a curved back arrow. */
export const ReplyIcon = (
	<Svg>
		<path d="M9 7 4 12l5 5" />
		<path d="M4 12h9a6 6 0 0 1 6 6v1" />
	</Svg>
);

/** Add reaction — a smiley with a small plus. */
export const ReactIcon = (
	<Svg>
		<path d="M20.9 12.8A9 9 0 1 1 11.2 3.1" />
		<path d="M9 10h.01M14.5 10h.01" />
		<path d="M8.5 14.5a4.5 4.5 0 0 0 6 .6" />
		<path d="M18 4v4M20 6h-4" />
	</Svg>
);

/** Copy — two stacked cards. */
export const CopyIcon = (
	<Svg>
		<rect x="9" y="9" width="11" height="11" rx="2" />
		<path d="M5 15V6a2 2 0 0 1 2-2h9" />
	</Svg>
);
// #endregion

// #region Audio transport
/** Play — a right-pointing triangle. */
export const PlayIcon = (
	<Svg fill="currentColor" stroke="none">
		<path d="M8 5.5v13l11-6.5z" />
	</Svg>
);

/** Pause — two bars. */
export const PauseIcon = (
	<Svg fill="currentColor" stroke="none">
		<rect x="7" y="5" width="3.4" height="14" rx="1.2" />
		<rect x="13.6" y="5" width="3.4" height="14" rx="1.2" />
	</Svg>
);
// #endregion

// #region Pinned banner
/** Previous pinned message. */
export const ChevronLeftIcon = (
	<Svg>
		<path d="m14 6-6 6 6 6" />
	</Svg>
);

/** Next pinned message. */
export const ChevronRightIcon = (
	<Svg>
		<path d="m10 6 6 6-6 6" />
	</Svg>
);

/** Expand a pinned message inline (diagonal arrows out). */
export const ExpandIcon = (
	<Svg>
		<path d="M9 4H4v5M20 15v5h-5" />
		<path d="M4 4l6 6M20 20l-6-6" />
	</Svg>
);

/** Collapse an expanded pinned message. */
export const CollapseIcon = (
	<Svg>
		<path d="M4 9h5V4M15 20v-5h5" />
		<path d="M9 9 4 4M15 15l5 5" />
	</Svg>
);
// #endregion

// #region System activity
/** Submission made — an upward tray/upload. */
export const SubmissionActivityIcon = (
	<Svg>
		<path d="M12 15V4M8.5 7.5 12 4l3.5 3.5" />
		<path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
	</Svg>
);

/** Member joined — a person with a plus. */
export const MemberJoinedIcon = (
	<Svg>
		<circle cx="9" cy="8" r="3.2" />
		<path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
		<path d="M18 8v6M15 11h6" />
	</Svg>
);

/** Member left — a person with a minus. */
export const MemberLeftIcon = (
	<Svg>
		<circle cx="9" cy="8" r="3.2" />
		<path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
		<path d="M15 11h6" />
	</Svg>
);

/** Payment released — a coin with a check. */
export const PaymentIcon = (
	<Svg>
		<circle cx="12" cy="12" r="8" />
		<path d="m8.7 12 2.2 2.2 4.4-4.4" />
	</Svg>
);
// #endregion

// #region Empty state
/** No messages yet — overlapping speech bubbles. */
export const EmptyChatIcon = (
	<Svg stroke-width="1.4">
		<path d="M4 6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8l-4 3z" />
		<path d="M8.5 16.5a2 2 0 0 0 2 1.5h6l3.5 2.5V13a2 2 0 0 0-1.4-1.9" opacity="0.55" />
	</Svg>
);
// #endregion

// #region Favourite mark
/**
 * The "wonky star" — a deliberately irregular, hand-drawn favourite mark straddling a bubble's border
 * (§C.4 custom asset). Filled via `currentColor`; its lopsided points read as a unique, non-geometric
 * badge rather than the tidy `StarIcon` used for channel/engagement starring.
 */
export const WonkyStarIcon = (
	<IconShell filled>
		<path d="M12.4 2.1c.4-.2.8 0 .95.42l1.7 4.3c.08.2.26.34.47.37l4.9.5c.5.05.68.63.32.95l-3.5 3.05a.5.5 0 0 0-.16.5l1.02 4.8c.1.47-.4.82-.8.57l-4.2-2.42a.5.5 0 0 0-.53.02l-4.5 2.9c-.42.27-.95-.12-.83-.6l1.3-4.9a.5.5 0 0 0-.14-.5L4.2 11.4c-.37-.34-.16-.94.34-.97l4.6-.3a.5.5 0 0 0 .43-.3l2.05-4.5.02-.04c-.05.5-.02.6.06.35z" />
	</IconShell>
);
// #endregion
