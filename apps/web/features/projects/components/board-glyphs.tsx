import type { JSX } from "preact";

/**
 * Board glyphs — minimal `currentColor` stroke icons for the Kanban board + footer rig (view switchers,
 * basket/checkout, column locks, card meta). Co-located inline SVG (the feature has no icon registry;
 * the sibling `file-glyphs`/`glyphs` do the same). Each is a COMPONENT returning a FRESH VNode (never a
 * shared const) so the same icon can render in many cards at once without the Preact VNode-reuse hazard.
 */

interface GlyphProps {
	size?: number;
	class?: string;
}

function Svg(
	{ size = 18, class: c, children }: GlyphProps & { children: JSX.Element | JSX.Element[] },
) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			class={c}
		>
			{children}
		</svg>
	);
}

/** Kanban / board columns. */
export function KanbanIcon(p: GlyphProps): JSX.Element {
	return (
		<Svg {...p}>
			<rect x="3" y="4" width="5" height="16" rx="1.2" />
			<rect x="10" y="4" width="5" height="11" rx="1.2" />
			<rect x="17" y="4" width="4" height="7" rx="1.2" />
		</Svg>
	);
}

/** Stacked layers — the Stages grouping toggle. */
export function StagesToggleIcon(p: GlyphProps): JSX.Element {
	return (
		<Svg {...p}>
			<path d="M12 3l8 4.5-8 4.5-8-4.5z" />
			<path d="M4 12l8 4.5 8-4.5M4 16.5l8 4.5 8-4.5" />
		</Svg>
	);
}

/** Swimlane rows — the Status grouping toggle. */
export function StatusToggleIcon(p: GlyphProps): JSX.Element {
	return (
		<Svg {...p}>
			<path d="M4 6h16M4 12h16M4 18h16" />
			<circle cx="8" cy="6" r="1.4" fill="currentColor" stroke="none" />
			<circle cx="13" cy="12" r="1.4" fill="currentColor" stroke="none" />
			<circle cx="17" cy="18" r="1.4" fill="currentColor" stroke="none" />
		</Svg>
	);
}

/** A basket / cart — Add to Basket. */
export function BasketIcon(p: GlyphProps): JSX.Element {
	return (
		<Svg {...p}>
			<path d="M6 8h12l-1.2 9.5a2 2 0 0 1-2 1.5H9.2a2 2 0 0 1-2-1.5z" />
			<path d="M9 8V6a3 3 0 0 1 6 0v2" />
		</Svg>
	);
}

/** A card with a check — Checkout / commit escrow. */
export function CheckoutIcon(p: GlyphProps): JSX.Element {
	return (
		<Svg {...p}>
			<rect x="3" y="6" width="18" height="12" rx="2" />
			<path d="M3 10h18" />
			<path d="m9.5 14.5 1.5 1.5 3-3" />
		</Svg>
	);
}

/** A padlock — a locked/started stage column that cannot be reordered. */
export function LockIcon(p: GlyphProps): JSX.Element {
	return (
		<Svg {...p}>
			<rect x="5" y="11" width="14" height="9" rx="2" />
			<path d="M8 11V8a4 4 0 0 1 8 0v3" />
		</Svg>
	);
}

/** A plus. */
export function PlusIcon(p: GlyphProps): JSX.Element {
	return (
		<Svg {...p}>
			<path d="M12 5v14M5 12h14" />
		</Svg>
	);
}

/** A vertical grip — the (whole-card) drag affordance hint. */
export function GripIcon(p: GlyphProps): JSX.Element {
	return (
		<Svg {...p}>
			<circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none" />
			<circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none" />
			<circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" />
			<circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
			<circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none" />
			<circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none" />
		</Svg>
	);
}

/** A speech bubble — the card comment count. */
export function CommentIcon(p: GlyphProps): JSX.Element {
	return (
		<Svg {...p}>
			<path d="M5 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3.5V7a2 2 0 0 1 2-2z" />
		</Svg>
	);
}

/** A paperclip — the card attachment count. */
export function PaperclipIcon(p: GlyphProps): JSX.Element {
	return (
		<Svg {...p}>
			<path d="M8 12.5l6.5-6.5a3 3 0 0 1 4.2 4.2l-8 8a5 5 0 0 1-7-7l7.5-7.5" />
		</Svg>
	);
}

/** A checklist tick box — the card checklist progress. */
export function ChecklistIcon(p: GlyphProps): JSX.Element {
	return (
		<Svg {...p}>
			<rect x="4" y="4" width="16" height="16" rx="2.5" />
			<path d="m8 12 2.5 2.5L16 9" />
		</Svg>
	);
}

/** A flag — the card priority marker. */
export function PriorityFlagIcon(p: GlyphProps): JSX.Element {
	return (
		<Svg {...p}>
			<path d="M5 21V4" />
			<path d="M5 5h11l-1.6 3L16 11H5" />
		</Svg>
	);
}

/** A warning triangle — the reorder/claimed/revision warning modals. */
export function WarningIcon(p: GlyphProps): JSX.Element {
	return (
		<Svg {...p}>
			<path d="M12 4 2.5 20h19z" />
			<path d="M12 10v4M12 17.5v.5" />
		</Svg>
	);
}

/** An expand/maximize — the ticket modal open. */
export function TicketIcon(p: GlyphProps): JSX.Element {
	return (
		<Svg {...p}>
			<path d="M4 9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2 2 0 0 0 0-4z" />
			<path d="M14 7.5v9" stroke-dasharray="1.6 1.8" />
		</Svg>
	);
}
