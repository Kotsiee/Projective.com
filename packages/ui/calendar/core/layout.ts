/**
 * @projective/ui/calendar — overlap geometry: the PLACEMENT ENGINE.
 *
 * Given the entries of a single day, this resolves where each one's box goes when several of them
 * claim the same minutes. It is pure and unit-free — epoch milliseconds in, fractions and flags out —
 * so the pixel/timezone mapping stays in the view and this stays testable without a canvas.
 *
 * THE RULE THE WHOLE MODULE PROTECTS: overlap is resolved VERTICALLY first. A calendar column is a
 * time axis, and a card's vertical extent is the one thing on it that means something; splitting the
 * column horizontally spends the reader's only reliable cue — width — on a fact that has nothing to
 * do with width. So the default for a colliding card is FULL column width, and the four placements
 * below are ordered by how much they have to give that up:
 *
 *  - `solo`   — no collision it has to yield to. Full band.
 *  - `nested` — its whole span falls INSIDE another's, so it is drawn inside that card at (almost)
 *               full width. A review inside a workshop is a fact about the workshop; drawing it as a
 *               sibling half-column asserts a rivalry that does not exist.
 *  - `split`  — the explicit fallback, for the overlap containment cannot express: two events that
 *               genuinely straddle each other, or that share an identical extent so neither contains
 *               the other. Only here does a card give up width.
 *  - `folded` — collapsed under an earlier card, drawing no pixels, counted by that card's `+N` chip
 *               until the reader unfolds the cluster. What a `split` degrades to when the lanes would
 *               be too narrow to read, which is the honest end of the line: three slivers nobody can
 *               read is strictly worse than one card that says there are three.
 *
 * NOTHING IS EVER DROPPED. Every entry gets a {@link DaySlot} whatever its placement — a folded card
 * is still in the day's data, so the accessible layer built from this list stays complete and a
 * reader who cannot see the pixels can still reach the event. `drawn` says whether the paint pass
 * spends pixels on it; it never says whether the event exists.
 *
 * A POINT IN TIME SURVIVES AS ONE. An entry with `end === start` is a deadline, and it is admitted
 * here as an {@link DaySlot.instant} rather than filtered out or given a synthetic duration. It takes
 * a placement like anything else — a deadline inside a sprint review really is inside it — but it
 * carries no height for the view to honour, so the view draws it as a pin.
 */

import type { CalendarEvent } from "./types.ts";

// #region Placement vocabulary
/**
 * How one card's box was resolved against everything it collides with.
 *
 * Restated structurally — NOT imported — by `core/grid-paint.ts`, which imports nothing at all so the
 * scene contract stays free of a type cycle. The two declarations carry comments naming each other;
 * a fifth member is added in both or `SceneEvent` silently stops accepting a placement.
 */
export type PlacementMode = "solo" | "nested" | "split" | "folded";

/** A timed entry with its resolved placement within one overlap cluster. */
export interface DaySlot {
	event: CalendarEvent;
	/**
	 * The transitive collision cluster this entry belongs to, day-scoped.
	 *
	 * Stable across a re-layout — it is minted from the cluster's EARLIEST member, which cannot change
	 * without the cluster itself changing — and it is what an unfold is addressed by, so the fold is a
	 * property of the GROUP rather than of whichever card happens to draw the `+N` chip this frame.
	 */
	clusterId: string;
	/** How many entries share the cluster. `1` means it collides with nothing. */
	clusterSize: number;
	/** How this entry's box was resolved. */
	mode: PlacementMode;
	/** Containment level: 0 at the top of a cluster, +1 per nest. */
	nestDepth: number;
	/** The event id of the card this one is drawn inside, or null. */
	parentId: string | null;
	/** DIRECTLY nested children — what a "contains N" clause counts, not the whole cluster. */
	childCount: number;
	/** What this card's `+N` chip prints. `0` when nothing is folded under it. */
	foldedCount: number;
	/** Inline start as a fraction of one column, `0..1`. */
	insetStart: number;
	/** Inline width as a fraction of one column, `0..1`. */
	insetWidth: number;
	/** `end === start`: a point in time. Carries no height for the view to honour. */
	instant: boolean;
	/** Whether the paint pass spends pixels on this card. `false` only for `folded`. */
	drawn: boolean;
	/**
	 * Draw this card as a PLAIN COLOUR BLOCK — its fill and its shape, and nothing else.
	 *
	 * True only for a member of an EXPANDED cluster of more than one, which is the one situation where
	 * text is a liability rather than the point. Six concurrent cards at their true vertical positions
	 * are six narrow lanes, and six titles clipped to three characters each is not six titles — it is
	 * six pieces of noise where the reader is trying to read a SHAPE. The names live in the list
	 * popover that opens with the expansion, where they have a full line each and a hover that points
	 * back at the block; the grid's job in that moment is to answer "when, and how long", which colour
	 * and position answer on their own.
	 *
	 * It is a PRESENTATION flag and never an accessibility one: the card is still in this list, still
	 * in the accessible layer, and still announces its full name — see `eventAccessibleName`.
	 */
	bare: boolean;
	/**
	 * Cluster size, under its pre-placement name.
	 *
	 * Kept because the Day timeline and the engine's own tests address a cluster through it. It is
	 * exactly {@link clusterSize}; the two are one number with two names rather than two numbers that
	 * could disagree.
	 */
	stackSize: number;
	/** 0-based position within the cluster, ordered by start time. `0` is the earliest member. */
	stackDepth: number;
}

/** What the placement engine needs to know that the events themselves do not carry. */
export interface PackOptions {
	/**
	 * Local midnight of the day being packed, epoch ms — the scope of a {@link DaySlot.clusterId}.
	 *
	 * Optional, because an event that runs past midnight is clipped into one card per day and a cluster
	 * id that was not day-scoped would name two of them. A standalone caller with one day and no
	 * ambition to address folds may leave it out.
	 */
	dayStart?: number;
	/**
	 * Clusters the reader has UNFOLDED, by {@link DaySlot.clusterId}.
	 *
	 * An unfolded cluster is laid out in full — every member placed at its true position — however
	 * narrow the lanes get. The reader asked to see them; refusing on their behalf because the result
	 * is cramped is deciding for them twice.
	 */
	unfolded?: ReadonlySet<string>;
	/**
	 * Collapse every overlap cluster to a SINGLE merged card at rest. Defaults to `true`.
	 *
	 * This is the resting contract the 2026-08-22 interaction pass made explicit: overlapping entries
	 * are one card carrying a `+N` chip until the reader asks for more, whatever their containment
	 * relationship. It supersedes the previous resting behaviour, where a plain straddle folded but a
	 * PROPER containment (a review inside a workshop) drew both cards nested, and a demoted nest drew
	 * both side by side — three different resting answers to "these two overlap", which is two too
	 * many for a reader to hold.
	 *
	 * The containment engine is not discarded by it: an UNFOLDED cluster is still resolved by the full
	 * forest, so nesting and lanes are what the reader gets when they open one. `false` restores the
	 * pre-2026-08-22 resting layout wholesale, for a consumer whose grid is sparse enough that the
	 * nesting was doing more good than the merge does.
	 */
	merge?: boolean;
	/**
	 * The zoom, in px per hour.
	 *
	 * Absent → the vertical-room tests are skipped and containment is decided on time alone. Present →
	 * a nest that would not survive at this scale falls back to a split, which is the whole point of
	 * the fallback: the same two events nest comfortably at one zoom and cannot at another, and only a
	 * pixel can answer which.
	 */
	pxPerHour?: number;
	/**
	 * One column's drawn width in px.
	 *
	 * Absent → {@link DEFAULT_MAX_LANES} caps the lane count instead. Present → the cap is derived from
	 * what a lane would actually measure, so a wide Day column tolerates lanes a narrow Week column
	 * cannot.
	 */
	columnWidth?: number;
}
// #endregion

// #region Constants
/**
 * A nested child's inline margin, as a fraction of the band it nests into.
 *
 * "Minimal" is the requirement and it is load-bearing in both directions: enough that the parent's
 * own fill reads as a container around the child, little enough that the child is still a full-width
 * card rather than a sibling that has been shoved sideways.
 */
export const NEST_INSET_FRAC = 0.06;
/**
 * Vertical room (px) a parent needs between its own top edge and a nested child's, so its title
 * survives being a container.
 *
 * A child that starts at or near its parent's start has nowhere to sit that is not on top of the
 * parent's only label, so it is not nested at all — it splits. This is the "available vertical pixels
 * are too small to render" fallback, stated as the pixel it actually is.
 */
export const NEST_HEADER_PX = 26;
/** A nested child shorter than this cannot carry a legible line of its own, so it splits instead. */
export const NEST_MIN_H = 16;
/** Containment deeper than this stops being read as containment and starts being read as noise. */
export const MAX_NEST_DEPTH = 3;
/** A split lane narrower than this cannot hold a glyph and a word, so the group folds instead. */
export const MIN_LANE_PX = 96;
/** Lane cap when no column width was measured. */
export const DEFAULT_MAX_LANES = 3;
/**
 * How close (px) two instants in the same band have to be before they fold into one pin.
 *
 * Two deadlines eleven minutes apart at a shallow zoom are two rules on the same pixel row; drawing
 * both is drawing one, illegibly, twice.
 */
export const INSTANT_FOLD_PX = 7;
// #endregion

// #region Internals
interface Node {
	event: CalendarEvent;
	instant: boolean;
	start: number;
	end: number;
	children: Node[];
	parent: Node | null;
	depth: number;
	/**
	 * This node WAS contained by another and was pushed out to be its sibling because the pixels could
	 * not hold the nest.
	 *
	 * It is the trigger for the one case the design allows a card to give up width: "if available
	 * vertical pixels are too small to render, place them side-by-side". A plain straddle — two events
	 * that overlap without either containing the other — is NOT this case, and stacks instead.
	 */
	demoted: boolean;
	/** Filled by {@link place}. */
	mode: PlacementMode;
	insetStart: number;
	insetWidth: number;
	foldedCount: number;
}

/**
 * PROPER containment: `a` spans every minute of `b` AND is strictly wider on at least one side.
 *
 * The strictness is what stops two events of IDENTICAL extent from each claiming to contain the
 * other — the one overlap containment genuinely cannot express, and the reason `split` exists.
 */
function contains(a: Node, b: Node): boolean {
	return a.start <= b.start && b.end <= a.end && (a.start < b.start || b.end < a.end);
}

/** Minutes → px at the current zoom, or `null` when no zoom was supplied. */
function pxOf(ms: number, pxPerHour: number | undefined): number | null {
	if (pxPerHour === undefined || !(pxPerHour > 0)) return null;
	return (ms / 3_600_000) * pxPerHour;
}

/**
 * Whether `child` has the room to be drawn INSIDE `parent` at this zoom.
 *
 * Two independent tests, both about pixels rather than about time: the child must start far enough
 * below the parent's top edge to clear its title, and (unless it is an instant, which has no height
 * to be too small) must itself be tall enough to read. Either failure demotes it to a sibling.
 */
function nestFits(parent: Node, child: Node, pxPerHour: number | undefined): boolean {
	if (child.depth > MAX_NEST_DEPTH) return false;
	const headroom = pxOf(child.start - parent.start, pxPerHour);
	if (headroom !== null && headroom < NEST_HEADER_PX) return false;
	if (child.instant) return true;
	const h = pxOf(child.end - child.start, pxPerHour);
	return h === null || h >= NEST_MIN_H;
}

/**
 * Greedy lane assignment over siblings, by start time — the classic interval colouring.
 *
 * Siblings only: a lane is a horizontal share of ONE band, and two events in different bands are not
 * competing for the same pixels. Instants take no lane at all (a zero-width-in-time mark cannot
 * collide horizontally with anything), so they neither widen the group nor get pushed sideways.
 */
function assignLanes(siblings: Node[]): { lanes: number[]; laneCount: number } {
	const laneEnds: number[] = [];
	const lanes: number[] = [];
	for (const node of siblings) {
		if (node.instant) {
			lanes.push(-1);
			continue;
		}
		let lane = laneEnds.findIndex((end) => end <= node.start);
		if (lane === -1) {
			lane = laneEnds.length;
			laneEnds.push(node.end);
		} else laneEnds[lane] = node.end;
		lanes.push(lane);
	}
	return { lanes, laneCount: Math.max(1, laneEnds.length) };
}

/** Mark a node and everything under it folded — a hidden card's children are hidden with it. */
function foldSubtree(node: Node): void {
	node.mode = "folded";
	node.foldedCount = 0;
	for (const child of node.children) foldSubtree(child);
}

function countDescendants(node: Node): number {
	let n = 0;
	for (const child of node.children) n += 1 + countDescendants(child);
	return n;
}

/**
 * Resolve `siblings` into `band`, then recurse into each one's own children.
 *
 * The band is `[start, width]` as fractions of ONE column, so an inset can never exceed the column it
 * insets into however deep the recursion goes — every level multiplies into its parent's share rather
 * than adding to it.
 */
function place(
	siblings: Node[],
	bandStart: number,
	bandWidth: number,
	unfolded: boolean,
	opts: PackOptions,
): void {
	if (siblings.length === 0) return;

	const { lanes, laneCount } = assignLanes(siblings);
	const measured = opts.columnWidth !== undefined && opts.columnWidth > 0;
	const maxLanes = measured
		? Math.max(1, Math.floor((opts.columnWidth as number) * bandWidth / MIN_LANE_PX))
		: DEFAULT_MAX_LANES;

	/*
	 * WHEN A CARD MAY GIVE UP WIDTH. Two reasons, and only two:
	 *
	 *  - the reader UNFOLDED the cluster, having asked to see every member at once, and lanes are the
	 *    only way concurrent cards can all be visible at their true vertical positions; or
	 *  - a nest was DEMOTED here because the pixels could not hold it — the design's one stated
	 *    fallback.
	 *
	 * A plain straddle at rest is neither, so it STACKS: one card drawn, the rest folded under a `+N`.
	 * That is what keeps the resting grid free of horizontal offsets.
	 */
	const maySplit = unfolded || siblings.some((s) => s.demoted);
	// Legibility still overrules a demotion: lanes nobody can read are not a better answer than a
	// stack that says how many there are. An explicit unfold overrules even that — the reader asked.
	const mustFold = laneCount > 1 && (!maySplit || (!unfolded && laneCount > maxLanes));

	if (mustFold) {
		const head = siblings[0];
		head.mode = "solo";
		head.insetStart = bandStart;
		head.insetWidth = bandWidth;
		let hidden = 0;
		for (let i = 1; i < siblings.length; i++) {
			foldSubtree(siblings[i]);
			hidden += 1 + countDescendants(siblings[i]);
		}
		// The head keeps its own children — folding a group hides the RIVALS, not the contents of the
		// card that survived.
		head.foldedCount = hidden;
		place(
			head.children,
			bandStart + bandWidth * NEST_INSET_FRAC,
			bandWidth * (1 - NEST_INSET_FRAC * 2),
			unfolded,
			opts,
		);
		return;
	}

	for (let i = 0; i < siblings.length; i++) {
		const node = siblings[i];
		const lane = lanes[i];
		// An instant spans the whole band: a pin is a mark ACROSS the column, and giving it a lane
		// would make it look like it competes for width with something.
		const shares = node.instant || laneCount === 1;
		const share = shares ? bandWidth : bandWidth / laneCount;
		const start = shares ? bandStart : bandStart + (bandWidth / laneCount) * Math.max(0, lane);
		node.insetStart = start;
		node.insetWidth = share;
		node.mode = node.parent !== null ? "nested" : shares ? "solo" : "split";
		place(
			node.children,
			start + share * NEST_INSET_FRAC,
			share * (1 - NEST_INSET_FRAC * 2),
			unfolded,
			opts,
		);
	}
}

/**
 * Collapse a resting cluster to ONE card — the default resting contract since 2026-08-22.
 *
 * It runs AFTER {@link place} rather than instead of it, and that is the whole reason it is a
 * separate pass. A cluster's rivalry is not visible from any one level of the containment forest: two
 * events where one properly contains the other are a PARENT and a CHILD, never siblings, so they
 * never meet in the same `assignLanes` call and no test inside `place` can see that they overlap. The
 * only place the question "do these two collide" has a complete answer is the cluster itself, which
 * is exactly what the cluster sweep built.
 *
 * INSTANTS ARE EXEMPT, and deliberately. A pin has no height and takes no lane, so it cannot be one
 * of the squeezed slivers the merge exists to prevent — it is drawn ACROSS whatever it sits on, and
 * hiding a deadline behind a chip would cost a reader a marker that was costing them nothing. The one
 * clutter a pin can cause is two of them on the same pixel row, and `foldCrowdedInstants` (which runs
 * straight after this) already answers that. They are re-rooted rather than left where the forest put
 * them, because their parent may be one of the cards this pass just folded — a pin insetting itself
 * into a band nothing is drawing is a pin in the wrong place.
 *
 * A cluster whose only overlaps are with a pin therefore does not merge at all: one card and one
 * deadline is a legible day, and collapsing it would hide the card's own title behind a `+1`.
 */
function mergeCluster(nodes: Node[], unfolded: boolean, opts: PackOptions): void {
	if (opts.merge === false || unfolded) return;
	const solid = nodes.filter((n) => !n.instant);
	if (solid.length < 2) return;

	const head = solid[0];
	for (const node of nodes) {
		node.parent = null;
		node.depth = 0;
		node.children = [];
		node.foldedCount = 0;
		if (node === head || node.instant) {
			// The head and every pin claim the whole column: there is no longer anything beside them to
			// yield width to, and a band inherited from the forest would inset them into nothing.
			node.mode = "solo";
			node.insetStart = 0;
			node.insetWidth = 1;
		} else {
			node.mode = "folded";
		}
	}
	// One number, one meaning: N is how many entries the reader cannot currently see. It has to agree
	// with what the list popover opens with, or the chip is promising something the list will not
	// deliver.
	head.foldedCount = solid.length - 1;
}

/**
 * Fold instants that land on the same pixel row within one band.
 *
 * Applied AFTER placement, because whether two pins collide is a question about the zoom rather than
 * about the tree, and the survivor's `+N` counts the pins it stands for.
 */
function foldCrowdedInstants(nodes: Node[], opts: PackOptions, unfolded: boolean): void {
	if (unfolded) return;
	const byBand = new Map<string, Node[]>();
	for (const node of nodes) {
		if (!node.instant || node.mode === "folded") continue;
		const key = `${node.insetStart.toFixed(4)}:${node.insetWidth.toFixed(4)}`;
		const list = byBand.get(key);
		if (list) list.push(node);
		else byBand.set(key, [node]);
	}
	for (const list of byBand.values()) {
		list.sort((a, b) => a.start - b.start);
		let anchor: Node | null = null;
		for (const node of list) {
			if (anchor === null) {
				anchor = node;
				continue;
			}
			const gap = pxOf(node.start - anchor.start, opts.pxPerHour);
			if (gap !== null && gap < INSTANT_FOLD_PX) {
				node.mode = "folded";
				anchor.foldedCount += 1;
			} else anchor = node;
		}
	}
}
// #endregion

// #region The pass
/**
 * Resolve the placement of one day's timed entries.
 *
 * A single sweep builds the transitive overlap CLUSTERS (contiguous once sorted by start, because no
 * event can overlap a cluster it was not adjacent to without also overlapping something already in
 * it), then each cluster is turned into a containment FOREST with an ancestor stack, demoted where
 * the pixels do not support a nest, and placed recursively into fractional bands.
 *
 * Sorting is by start ascending then end DESCENDING, so a container is always seen before anything it
 * contains — which is what lets the ancestor stack be built in one pass rather than by searching.
 */
export function packDayEvents(events: CalendarEvent[], opts: PackOptions = {}): DaySlot[] {
	const timed = events
		.filter((e) => !e.allDay && e.end >= e.start)
		.slice()
		.sort((a, b) => a.start - b.start || b.end - a.end);

	const out: DaySlot[] = [];
	const dayKey = opts.dayStart === undefined ? "" : `${opts.dayStart}:`;

	let i = 0;
	while (i < timed.length) {
		// #region Cluster
		const members: CalendarEvent[] = [timed[i]];
		let clusterEnd = timed[i].end;
		let j = i + 1;
		for (; j < timed.length; j++) {
			// STRICT: an event starting exactly where the cluster ends is back-to-back, not concurrent.
			if (!(timed[j].start < clusterEnd)) break;
			members.push(timed[j]);
			clusterEnd = Math.max(clusterEnd, timed[j].end);
		}
		i = j;
		// #endregion

		const clusterId = `${dayKey}${members[0].id}`;
		const unfolded = opts.unfolded?.has(clusterId) === true;

		// #region Containment forest
		const nodes: Node[] = members.map((event) => ({
			event,
			instant: event.end === event.start,
			start: event.start,
			end: event.end,
			children: [],
			parent: null,
			depth: 0,
			demoted: false,
			mode: "solo" as PlacementMode,
			insetStart: 0,
			insetWidth: 1,
			foldedCount: 0,
		}));

		const roots: Node[] = [];
		const stack: Node[] = [];
		/*
		 * AN EXPANDED CLUSTER IS FLAT, and that is the whole difference between the two states.
		 *
		 * The reader pressed a merged card to see the members SEPARATELY. Containment answers a
		 * different question — "which of these is inside which" — and answers it by drawing one card on
		 * top of another, so a nested member in the expanded state is the one thing the expansion was
		 * meant to stop: a block the reader can see the edge of but cannot point at. Skipping the
		 * parenting sweep hands every member to `assignLanes` as a root, and lanes are the only layout
		 * in which N concurrent entries are all visible at their true vertical positions at once.
		 *
		 * `maySplit` in `place` then resolves to `true` for the same `unfolded` reason, so the lanes are
		 * actually taken rather than folded back.
		 */
		const flat = unfolded && nodes.length > 1;
		for (const node of nodes) {
			if (flat) {
				roots.push(node);
				continue;
			}
			while (stack.length > 0 && !contains(stack[stack.length - 1], node)) stack.pop();
			const parent = stack.length > 0 ? stack[stack.length - 1] : null;
			node.parent = parent;
			node.depth = parent ? parent.depth + 1 : 0;
			// The demotion: a child the pixels cannot hold INSIDE its parent becomes its parent's
			// SIBLING, which is exactly what "place them side-by-side" means once the tree is the thing
			// doing the placing.
			if (parent !== null && !nestFits(parent, node, opts.pxPerHour)) {
				node.parent = parent.parent;
				node.depth = parent.depth;
				node.demoted = true;
				// The former parent shares the fallback: "place THEM side-by-side" is a statement about a
				// pair, and marking only the child would leave the parent claiming a full band the child
				// is now standing in.
				parent.demoted = true;
			}
			if (node.parent !== null) node.parent.children.push(node);
			else roots.push(node);
			stack.push(node);
		}
		// #endregion

		place(roots, 0, 1, unfolded, opts);
		mergeCluster(nodes, unfolded, opts);
		foldCrowdedInstants(nodes, opts, unfolded);

		// #region Emit
		const size = nodes.length;
		nodes.forEach((node, depth) => {
			out.push({
				event: node.event,
				clusterId,
				clusterSize: size,
				mode: node.mode,
				nestDepth: node.mode === "folded" ? 0 : node.depth,
				parentId: node.mode === "folded" || node.parent === null ? null : node.parent.event.id,
				childCount: node.children.filter((c) => c.mode !== "folded").length,
				foldedCount: node.foldedCount,
				insetStart: node.insetStart,
				insetWidth: node.insetWidth,
				instant: node.instant,
				drawn: node.mode !== "folded",
				// Only an EXPANDED cluster of more than one goes bare. A solo card in an expanded cluster
				// of one has nothing to be separated from, and a merged card is the one that most needs
				// its title — it is standing in for everything underneath it.
				bare: unfolded && size > 1 && node.mode !== "folded",
				stackSize: size,
				stackDepth: depth,
			});
		});
		// #endregion
	}
	return out;
}

// #region Day window
/**
 * The virtualized day window: which day indices are laid out this frame.
 *
 * Pure and total — no signal, no clock, no DOM — so it can be reasoned about and tested. Every input
 * is treated as untrusted: `NaN` and `±Infinity` are real values for a quotient whose divisor is a
 * caller-owned zoom, and the only safe answer to a nonsense viewport is the focused day rather than
 * a range that addresses the year 40,000.
 */
export function dayWindow(
	bounded: boolean,
	focusIdx: number,
	firstDay: number,
	lastDay: number,
	windowDays: number,
	maxDays: number,
): { startIdx: number; endIdx: number } {
	const focus = Number.isFinite(focusIdx) ? Math.trunc(focusIdx) : 0;
	const inAxis = (n: number) => Math.max(-windowDays, Math.min(windowDays, n));
	if (!bounded || !Number.isFinite(firstDay) || !Number.isFinite(lastDay)) {
		const centre = inAxis(focus);
		return { startIdx: inAxis(centre - 1), endIdx: inAxis(centre + 1) };
	}
	const first = Math.floor(firstDay);
	const start = inAxis(first - 1);
	// Two ceilings, and the tighter one wins: what is actually on screen, and a hard cap so a
	// degenerate zoom cannot ask for thousands of days at once. The cap counts the days it will
	// EMIT — `start` is already one day of overscan below `first`, so adding the budget to `first`
	// would quietly lay out two more days than the budget names.
	const end = inAxis(Math.min(Math.ceil(lastDay) + 1, start + maxDays - 1));
	return { startIdx: start, endIdx: Math.max(start, end) };
}

// #endregion

/** The all-day / multi-day events for a day, stacked (no column packing needed). */
export function allDayEvents(events: CalendarEvent[]): CalendarEvent[] {
	return events.filter((e) => e.allDay).sort((a, b) => a.start - b.start || a.end - b.end);
}
// #endregion
