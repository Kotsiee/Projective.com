/**
 * @projective/ui/gantt — the generic, presentational contract for the Timeline / Gantt engine
 * (DESIGN_SYSTEM.md §C.1). Plain TypeScript, NO Zod: the package stays copy-paste-portable and
 * depends only on the token contract. Every consuming surface — the project timeline, the ticket
 * modal's stage run, the calendar's Timeline view — maps its OWN domain data (a Zod projection from
 * `@projective/types/*`) into these shapes, so the one engine renders them all.
 *
 * Time is always **epoch milliseconds (UTC)**; the display timezone is an explicit, separate concern
 * (`GanttProps.timezone`, resolved through the calendar engine's own zoned-time matrix) so SSR and
 * the hydrated island place a tick on the same pixel.
 *
 * A LANE is a row and an ITEM is a thing on it. An item is either a `bar` (a span) or a `milestone`
 * (an instant, `end === start`) — and an instant is drawn as a diamond rather than as a box, because a
 * point in time has no width that could honestly encode a duration.
 */
import type { ComponentChildren, VNode } from "preact";
import type { Signal } from "@preact/signals";

// #region Lanes + items
/** One row of the timeline. */
export interface GanttLane {
	id: string;
	/** The row's name — the task list's label and the item's accessible context. */
	label: string;
	/** A quieter second line under the label (a stage brief, a status word). */
	sublabel?: string;
	/**
	 * A CSS custom-property NAME (e.g. `"--primary"`) for the lane's own mark in the task list. Items
	 * carry their own accents; this only colours the row's leading dot.
	 */
	accent?: string;
	/** Nesting depth, `0` at the root — indents the label one step per level. */
	depth?: number;
	/** A short trailing figure the task list prints beside the label ("4 tickets"). */
	meta?: string;
	/** The party the row belongs to, drawn as a small face beside the label. */
	avatar?: { name: string; url?: string | null };
	/** Whether a drag across this lane's empty space may create. Defaults to the island's `canCreate`. */
	creatable?: boolean;
	/** Where the row's label links, if anywhere. */
	href?: string;
}

/** What kind of mark an item draws: a span, or an instant. */
export type GanttItemKind = "bar" | "milestone";

/** One thing on a lane. Times are epoch ms (UTC). */
export interface GanttItem {
	id: string;
	laneId: string;
	/** The drawn label — inside the bar where it fits, trailing it where it does not. */
	label: string;
	kind: GanttItemKind;
	/** Epoch ms (UTC) of the start. */
	start: number;
	/** Epoch ms (UTC) of the end. `=== start` for a milestone. */
	end: number;
	/** A CSS custom-property NAME accenting the item (e.g. `"--primary"`). Defaults to `--primary`. */
	accent?: string;
	/**
	 * Completion in `0..1`, drawn as a solid strip along the bar's base. `null`/absent means the item
	 * has no progress channel at all — which is a different fact from `0`, and is drawn differently.
	 */
	progress?: number | null;
	/** Ids of the items this one starts after — each drawn as a dependency link. */
	dependsOn?: readonly string[];
	/** A short secondary line ("Due Aug 4 · 3 tasks") for the popover and the accessible name. */
	meta?: string;
	/** The lifecycle word for the popover and the accessible name ("Active", "Overdue"). */
	status?: string;
	/** Whether a drag may move it — honoured only when the host supplies `onMoveItem`. */
	movable?: boolean;
	/** Where opening the item navigates, when the host has no richer surface for it. */
	href?: string;
	/** Opaque host data, handed back untouched in every callback. */
	data?: unknown;
}
// #endregion

// #region Geometry + state
/** A time span, epoch ms (UTC). */
export interface GanttRange {
	start: number;
	end: number;
}

/**
 * Where a popover points, in VIEWPORT (client) px — the frame `getBoundingClientRect` reports in,
 * so a canvas rect is translated to the screen exactly once and nothing downstream has to know which
 * surface painted it.
 */
export interface GanttAnchor {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** The provisional range a drag-to-create leaves on a lane while its composer is open. */
export interface GanttDraft {
	laneId: string;
	start: number;
	end: number;
}

/**
 * What the built-in popover is showing, or `null` for nothing.
 *
 * A discriminated union rather than optional fields: an item popover has no range and a create
 * popover has no item, and a shape able to express both at once would need a rule about which wins.
 */
export type GanttPopoverState =
	| { kind: "item"; item: GanttItem; lane: GanttLane | null; anchor: GanttAnchor }
	| {
		kind: "create";
		laneId: string;
		lane: GanttLane | null;
		range: GanttRange;
		anchor: GanttAnchor;
	};

/**
 * A one-shot instruction a host sends the engine through {@link GanttProps.commands}.
 *
 * `today` glides the viewport to the reference instant; `fit` re-zooms so the range (or every item)
 * fills the viewport; `center` glides to an instant without changing the zoom. The engine CONSUMES
 * the command — it writes the signal back to `null` once acted on — so the same instruction can be
 * issued twice in a row, which a plain "focus" prop that only reacts to CHANGE cannot express.
 */
export type GanttCommand =
	| { kind: "today" }
	| { kind: "fit"; range?: GanttRange }
	| { kind: "center"; ms: number };

/** What the host's popover action slot is handed. */
export interface GanttItemActionContext {
	item: GanttItem;
	lane: GanttLane | null;
	/** Dismiss the popover. */
	close: () => void;
}
// #endregion

// #region Props
/**
 * The controlled props for the {@link Gantt} island. The consumer owns the data (lanes + items) and
 * reacts to the open/create/move callbacks; the engine owns view state (scroll, zoom, hover, focus).
 */
export interface GanttProps {
	lanes: readonly GanttLane[];
	items: readonly GanttItem[];
	/** IANA display timezone. Defaults to the viewer's resolved zone. */
	timezone?: string;
	/** 12-hour clock for the hour tier and the popover. Default `true`. */
	hour12?: boolean;
	/**
	 * The instant the viewport centres on when it first lays out, and is re-centred on whenever the
	 * prop CHANGES afterwards — a host that owns a period trail drives the engine through it.
	 */
	focus?: number;
	/**
	 * "Now", epoch ms. Drawn as the today rule and used by the return-to-today control. Absent → the
	 * real clock; a fixture-driven host passes its own reference instant so the two agree.
	 */
	now?: number;
	/**
	 * Freeze every write gesture: no drag-to-create, no drag-to-move. Reading, scrolling, zooming and
	 * opening an item are never gated — a viewer who may not change a plan may still read it.
	 */
	readOnly?: boolean;
	/** Offer drag-to-create on empty lane space (needs `onCreateRange`, and not `readOnly`). */
	canCreate?: boolean;
	/**
	 * The zoom, in px per day, as a host-owned signal. Absent → the engine owns it (and persists it
	 * under `storageKey`). A host that renders a zoom control elsewhere passes its own signal and the
	 * engine writes cursor-anchored wheel zooms back into it.
	 */
	zoom?: Signal<number>;
	/** localStorage key the engine persists its own zoom under. */
	storageKey?: string;
	/**
	 * Called when an item is opened (a click, a tap, Enter on the focused item). The anchor is where
	 * the item was on screen at that moment, so a host popover can point at it.
	 *
	 * With `popover="builtin"` (the default) the engine opens its own popover FIRST and this is what
	 * the popover's "Open" control calls; with `popover="host"` this fires directly.
	 */
	onOpenItem?: (item: GanttItem, anchor: GanttAnchor) => void;
	/**
	 * Called when a drag across empty lane space is released. Supplying it (with `canCreate`) is what
	 * ENABLES the gesture; the range is snapped to the live tier's grain.
	 */
	onCreateRange?: (
		laneId: string,
		range: GanttRange,
		anchor: GanttAnchor,
		/** What the built-in composer already held when the reader expanded — never lost on the way. */
		title?: string,
	) => void;
	/**
	 * Commit a quick-create from the built-in popover's composer (title + range). Absent → the
	 * composer offers no title field and no submit; the popover only reports the range and offers the
	 * expand route through {@link onCreateRange}.
	 */
	onQuickCreate?: (laneId: string, range: GanttRange, title: string) => void;
	/**
	 * Move an item to a new range by dragging its bar. Supplying it is what ENABLES the gesture —
	 * without it a drag on a bar stays a click, because offering a rearrangement the host cannot keep
	 * is worse than not offering it.
	 */
	onMoveItem?: (item: GanttItem, range: GanttRange) => void;
	/** Fired when the viewport centre crosses into a new day — a host trail tracks it. */
	onFocusChange?: (ms: number) => void;
	/** Fired whenever the zoom settles at a new px-per-day. */
	onZoomChange?: (pxPerDay: number) => void;
	/**
	 * Fired whenever the header's time tier changes — the host's zoom control prints the unit the
	 * scale is currently divided into ("Weeks", "Days").
	 */
	onTierChange?: (tier: { top: string; bottom: string }) => void;
	/**
	 * A host-owned command channel — a footer rig's Today and Fit controls write here and the engine
	 * acts and clears. See {@link GanttCommand}.
	 */
	commands?: Signal<GanttCommand | null>;
	/**
	 * Which popover opens on an item: the engine's own (`builtin`, default) or none — the host is told
	 * through `onOpenItem` and draws its own (`host`).
	 */
	popover?: "builtin" | "host";
	/**
	 * Draw the built-in popover's action row for one item (an "Open ticket" button). Absent → no
	 * action row is drawn at all, rather than an empty one.
	 */
	renderItemActions?: (ctx: GanttItemActionContext) => VNode | null;
	/**
	 * The live DRAFT block — a range the reader has begun creating and has not committed. A host that
	 * owns its own composer passes its own signal so the two agree; absent → the engine keeps one.
	 */
	draft?: Signal<GanttDraft | null>;
	/** Hide the left task list (the calendar's Timeline view keeps its own lane labels elsewhere). */
	hideTaskList?: boolean;
	/** The task list's width (a CSS length). Defaults to the `--gantt-lanes-w` token. */
	laneWidth?: string;
	/** What the list column is called to a screen reader ("Stages", "Event types"). */
	laneHeading?: string;
	/** Rendered when there are no lanes at all. */
	empty?: ComponentChildren;
	/** The accessible name of the whole timeline region. */
	ariaLabel?: string;
	/**
	 * Selectors the built-in popover must never overlap — the site-nav sidebar, the middle-nav lane.
	 * Re-measured on every reposition.
	 */
	avoid?: readonly string[];
	class?: string;
}
// #endregion
