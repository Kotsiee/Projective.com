import type { JSX } from "preact";

/**
 * Members roster glyphs — the few 1em `currentColor` stroke icons the roster needs that the feed's
 * `glyphs.tsx` / `detail-glyphs.tsx` don't already provide (assign / unassign / role / view toggle /
 * contributor / resend). Co-located inline SVG, matching the feature's glyph convention (the package
 * has no icon registry). Reuse the shared feed glyphs for the common ones (Plus · Search · Kebab · Edit
 * · Trash · Mail · Eye · Check · Close · ExternalLink · Chevron).
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

/** A person with a plus — assign to the current stage/channel. */
export const UserPlusIcon = (
	<Svg>
		<circle cx="9" cy="8" r="3.2" />
		<path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
		<path d="M18 8v6M15 11h6" />
	</Svg>
);

/** A person with a minus — unassign from the current stage/channel. */
export const UserMinusIcon = (
	<Svg>
		<circle cx="9" cy="8" r="3.2" />
		<path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
		<path d="M15 11h6" />
	</Svg>
);

/** A shield — edit member role / permissions. */
export const ShieldIcon = (
	<Svg>
		<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
		<path d="m9 12 2 2 4-4" />
	</Svg>
);

/** A small grid — the card-view toggle. */
export const GridIcon = (
	<Svg>
		<rect x="4" y="4" width="6.5" height="6.5" rx="1.4" />
		<rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4" />
		<rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4" />
		<rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4" />
	</Svg>
);

/** Stacked rows — the table-view toggle. */
export const ListIcon = (
	<Svg>
		<path d="M8 6h12M8 12h12M8 18h12" />
		<circle cx="4" cy="6" r="1.1" fill="currentColor" stroke="none" />
		<circle cx="4" cy="12" r="1.1" fill="currentColor" stroke="none" />
		<circle cx="4" cy="18" r="1.1" fill="currentColor" stroke="none" />
	</Svg>
);

/** A badge check — an assigned contributor. */
export const ContributorIcon = (
	<Svg>
		<path d="M12 3l2.3 1.7 2.8-.2.9 2.7 2.3 1.6-.9 2.7.9 2.7-2.3 1.6-.9 2.7-2.8-.2L12 21l-2.3-1.7-2.8.2-.9-2.7L3.7 15l.9-2.7-.9-2.7 2.3-1.6.9-2.7 2.8.2z" />
		<path d="m9 12 2 2 4-4" />
	</Svg>
);

/** A circular arrow — resend a pending invitation. */
export const ResendIcon = (
	<Svg>
		<path d="M20 11a8 8 0 1 0-.9 4.5" />
		<path d="M20 5v6h-6" />
	</Svg>
);
