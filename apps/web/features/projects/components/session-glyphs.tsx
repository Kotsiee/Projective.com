import type { JSX } from "preact";

/**
 * session-glyphs — the minimal 1em `currentColor` stroke icons unique to the session-based service
 * sidebars (the 1-1 mini-calendar + upcoming-session widget and the group-session sub-group/voting
 * panel). Co-located inline SVG, matching the sibling `detail-glyphs.tsx`/`glyphs.tsx` convention (the
 * feature has no icon registry). Each inherits font-size so the sidebar can size it against the type
 * ramp. Kept distinct from `detail-glyphs.tsx` so a shared VNode is never mounted in two subtrees at
 * once (the documented Preact reuse hazard).
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

// #region Mini-calendar navigation
/** Previous month — a left chevron. */
export const ChevronLeftIcon = (
	<Svg>
		<path d="M14 6l-6 6 6 6" />
	</Svg>
);

/** Next month — a right chevron. */
export const ChevronRightIcon = (
	<Svg>
		<path d="M10 6l6 6-6 6" />
	</Svg>
);
// #endregion

// #region Session widget
/** Propose / book a time — a calendar with a plus. */
export const CalendarPlusIcon = (
	<Svg>
		<rect x="4" y="5" width="16" height="15" rx="2" />
		<path d="M4 9h16M8 3v4M16 3v4M12 12.5v5M9.5 15h5" />
	</Svg>
);

/** A live session — a video camera (the upcoming-session marker). */
export const VideoIcon = (
	<Svg>
		<rect x="3" y="6.5" width="12" height="11" rx="2" />
		<path d="M15 10l6-3v10l-6-3z" />
	</Svg>
);

/** Shared resources / files — a folder. */
export const FolderIcon = (
	<Svg>
		<path d="M3.5 7a2 2 0 0 1 2-2h3l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
	</Svg>
);

/** Upload a recorded asset — a tray with an up arrow. */
export const UploadIcon = (
	<Svg>
		<path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
		<path d="M12 16V4M8 8l4-4 4 4" />
	</Svg>
);
// #endregion

// #region Group session
/** Proficiency levels / sub-groups — ascending signal bars. */
export const LevelsIcon = (
	<Svg>
		<path d="M5 20v-4M12 20V10M19 20V4" />
	</Svg>
);

/** A schedule overlap — two intersecting rings (the overlapping-session indicator). */
export const OverlapIcon = (
	<Svg>
		<circle cx="9.5" cy="12" r="5.5" />
		<circle cx="14.5" cy="12" r="5.5" />
	</Svg>
);

/** A cohort vote — a poll with a tallied bar. */
export const PollIcon = (
	<Svg>
		<path d="M6 20V10M12 20V4M18 20v-6" />
		<path d="M3 20h18" />
	</Svg>
);

/** Continue one-to-one — an arrow to a person (the 1-1 continuation CTA). */
export const ContinuationIcon = (
	<Svg>
		<path d="M3 12h11M11 8l4 4-4 4" />
		<circle cx="19" cy="8.5" r="2" />
		<path d="M16 19a3 3 0 0 1 6 0" />
	</Svg>
);
// #endregion
