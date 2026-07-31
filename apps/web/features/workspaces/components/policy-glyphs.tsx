import type { JSX, VNode } from "preact";
import { IconShell } from "@projective/ui/icons";

/**
 * policy-glyphs — the icons the money-policy editors need and the shared workspace register does not
 * carry.
 *
 * `core/workspace-glyphs.tsx` is the surface's register for **module identity** (one glyph per lane
 * item), so it holds no hold/release mark, no ledger direction arrows, no decline mark and no padlock.
 * Those are row-level and verdict-level marks that only the payout and spend editors draw, which is
 * exactly the split the codebase already makes elsewhere (`projects/components/detail-glyphs.tsx`,
 * `board-glyphs.tsx`, `file-glyphs.tsx`): module glyphs live in the registry, surface glyphs live beside
 * the surface that draws them.
 *
 * Same drawing contract as the register so the two read as one icon system: a `0 0 24 24` box at `1em`
 * in `currentColor` with `stroke-width: 1.8`, exported as **VNode constants** (write `{HoldGlyph}`, never
 * `<HoldGlyph />`), and all `aria-hidden` — every icon-only control on this surface carries a portal
 * `Tooltip` plus an `aria-label`, never a native `title` (§B.6).
 *
 * A single VNode object cannot be mounted twice concurrently. Nothing here is currently rendered in two
 * places at once, but if that changes, clone it through `cloneGlyph` from the register rather than
 * mounting the constant twice.
 */

// #region Base
function Svg(props: JSX.SVGAttributes<SVGSVGElement>): VNode {
	return <IconShell focusable="false" {...props} />;
}
// #endregion

// #region Split — holding and releasing a stake
/**
 * Hold — a pause mark. A held share is not *taken away*, it simply stops distributing automatically, so
 * the mark is a pause rather than a block or a strike-through.
 */
export const HoldGlyph: VNode = (
	<Svg>
		<path d="M9.5 5.5v13M14.5 5.5v13" />
	</Svg>
);

/** Release — resume automatic distribution of a held share. */
export const ReleaseGlyph: VNode = (
	<Svg>
		<path d="M8 5.5l11 6.5-11 6.5z" />
	</Svg>
);
// #endregion

// #region Money direction
/**
 * A contribution — value arriving into the pool. Drawn arriving at a tray rather than as a bare arrow so
 * it stays distinguishable from {@link OutflowGlyph} in greyscale and under every CVD overlay, since the
 * ledger's two directions must never rely on colour alone.
 */
export const InflowGlyph: VNode = (
	<Svg>
		<path d="M12 4v9M8.5 9.5l3.5 3.5 3.5-3.5" />
		<path d="M4.5 16.5v2A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-2" />
	</Svg>
);

/** A spend — value leaving the pool. An ordinary movement, never a failure, so it is achromatic. */
export const OutflowGlyph: VNode = (
	<Svg>
		<path d="M12 13V4M8.5 7.5L12 4l3.5 3.5" />
		<path d="M4.5 16.5v2A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-2" />
	</Svg>
);
// #endregion

// #region Decisions
/** Decline — a cross inside a ring, the exact counterpart of the register's `ApproveGlyph`. */
export const DeclineGlyph: VNode = (
	<Svg>
		<circle cx="12" cy="12" r="8.4" />
		<path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" />
	</Svg>
);

/** Awaiting a decision — a clock. A request in flight is a queue position, not a warning. */
export const ClockGlyph: VNode = (
	<Svg>
		<circle cx="12" cy="12" r="8.4" />
		<path d="M12 7.5V12l3.2 2" />
	</Svg>
);
// #endregion

// #region Gates
/**
 * The padlock. The **only** lock mark this surface draws, and only ever for the verification gate — a
 * capability the viewer lacks is expressed by ABSENCE, so nothing missing is ever drawn as locked.
 */
export const LockGlyph: VNode = (
	<Svg>
		<rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2" />
		<path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
	</Svg>
);

/** A pencil — open the editor for one row. */
export const EditGlyph: VNode = (
	<Svg>
		<path d="M4.5 19.5l.8-3.4 9.9-9.9 2.6 2.6-9.9 9.9z" />
		<path d="M15.2 6.2l1.6-1.6a1.4 1.4 0 0 1 2 0l.6.6a1.4 1.4 0 0 1 0 2l-1.6 1.6" />
	</Svg>
);

/** A tick — commit an inline row edit. */
export const DoneGlyph: VNode = (
	<Svg>
		<path d="M5 12.5l4.5 4.5L19 7" />
	</Svg>
);
// #endregion
