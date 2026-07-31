import type { JSX } from "preact";
import { IconShell } from "@projective/ui/icons";

/**
 * Channel Header glyphs — the icons unique to the channel/chat view Header that the feed
 * ({@link file://./glyphs.tsx}) and Project Details ({@link file://./detail-glyphs.tsx}) glyph sets
 * don't already cover: the Chat + Files tab marks and the right-rail action icons (details panel,
 * mute, pin). Co-located inline SVG, matching both existing sets — 1em `currentColor` strokes that
 * inherit font-size so the header can size them against the type ramp.
 *
 * Everything else the Header renders is reused: Members/Submissions/Calendar/Pipeline tab icons from
 * `detail-glyphs.tsx`, and Star/Kebab/Ticket/Share/Leave from `glyphs.tsx`.
 */

// #region Base
function Svg(props: JSX.SVGAttributes<SVGSVGElement>): JSX.Element {
	return <IconShell {...props} />;
}
// #endregion

// #region Tab glyphs
/** Chat — a speech bubble with message lines (the Chat tab + a group channel's leading mark). */
export const ChatIcon = (
	<Svg>
		<path d="M5 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3.5V7a2 2 0 0 1 2-2z" />
		<path d="M8.5 9.5h7M8.5 12.5h4.5" />
	</Svg>
);

/** Files — a folder (the Files tab). */
export const FilesIcon = (
	<Svg>
		<path d="M3.5 7.5a2 2 0 0 1 2-2h3.2l2 2.2H18.5a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
	</Svg>
);
// #endregion

// #region Action glyphs
/** View stage details — a right-side panel opening (the details drawer toggle). */
export const PanelIcon = (
	<Svg>
		<rect x="4" y="5" width="16" height="14" rx="2" />
		<path d="M14 5v14" />
	</Svg>
);

/** Mute notifications — a bell with a slash. */
export const BellOffIcon = (
	<Svg>
		<path d="M8.7 6.3A5 5 0 0 1 17 10c0 3 1 5 1 5H9" />
		<path d="M6.5 9.5V10s0 3-2 5h9.5" />
		<path d="M10 19a2 2 0 0 0 4 0" />
		<path d="M4 4l16 16" />
	</Svg>
);

/** Pin messages — a push-pin. */
export const PinIcon = (
	<Svg>
		<path d="M9 3h6l-1 5 3 3v2H7v-2l3-3-1-5z" />
		<path d="M12 15v6" />
	</Svg>
);
// #endregion
