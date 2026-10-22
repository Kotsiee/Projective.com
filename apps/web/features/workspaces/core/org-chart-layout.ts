import type { WorkspaceMember } from "@projective/types/workspace";

/**
 * org-chart-layout — the Members org chart as GEOMETRY (Decision #319): who reports to whom, where
 * each card sits on the canvas, the connector between a manager and each report, and the viewport
 * arithmetic (fit, zoom about a point, clamp) the canvas and the footer rig share.
 *
 * **A reporting graph is not always a tree, and the chart says so.** Three shapes are surfaced rather
 * than swallowed: a member whose manager is not in the roster (they left, or the row is stale), a
 * member inside a reporting CYCLE, and a roster where nobody has a null `reportsTo`. All of them land in
 * the "Not placed" group under the chart. Rooting them silently would draw a chart that lies about who
 * answers to whom; dropping them would show fewer people than the roster.
 *
 * **The layout** is a tidy top-down tree: a subtree is as wide as its card or its children side by
 * side, whichever is wider, and a manager is centred over their reports. Several people at the top
 * sit side by side as several trees. A collapsed branch keeps its card and hides its reports. The
 * unit is the CSS pixel at zoom 1, so the canvas's transform is the only scale.
 *
 * Pure: no signals, no DOM. The canvas renders what this returns; the tests pin it.
 */

// #region Geometry constants
/** A card's size at zoom 1 — the `OrgChartNode`'s three rows: avatar and role, name and handle, figures. */
export const NODE_W = 220;
export const NODE_H = 136;
/** The room between two sibling subtrees. */
export const GAP_X = 24;
/** The room between a manager's card and their reports' — the connector's run. */
export const GAP_Y = 64;
/** The room between the charted trees and the "Not placed" group under them. */
export const GROUP_GAP = 96;
/** How many unplaced cards share a row. */
export const UNPLACED_PER_ROW = 4;
/** The rounding on a connector's elbows. */
const ELBOW_RADIUS = 10;
// #endregion

// #region Vocabulary
/** The fields of a member the shape reads — the canvas carries the whole member through. */
export type ChartMember = Pick<WorkspaceMember, "id" | "reportsTo">;

/** One card, placed. */
export interface ChartNode<M extends ChartMember = WorkspaceMember> {
	member: M;
	/** Top-left corner on the canvas, at zoom 1. */
	x: number;
	y: number;
	/** 1 for a person at the top (and every unplaced person); the tree's `aria-level`. */
	level: number;
	/** The manager's id, `null` at the top or when not placed. */
	parentId: string | null;
	/** Everyone reporting to them directly, whether or not the branch is open. */
	reports: number;
	/** Everyone below them — so a collapsed card can say how many people it hides. */
	descendants: number;
	/** Whether their reports are drawn. `false` for a person with nobody reporting to them. */
	open: boolean;
	/** In the "Not placed" group. */
	unplaced: boolean;
}

/** One manager → report connector. */
export interface ChartEdge {
	/** `${parentId}>${childId}`. */
	id: string;
	from: string;
	to: string;
	/** An SVG path: down from the manager, across, down into the report. */
	d: string;
}

/** An axis-aligned box on the canvas. */
export interface ChartBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** The whole chart, placed. */
export interface ChartLayout<M extends ChartMember = WorkspaceMember> {
	/** Every drawn card in reading order: each tree depth-first, then the unplaced group. */
	nodes: ChartNode<M>[];
	edges: ChartEdge[];
	/** Where the "Not placed" label sits, or `null` when everyone is placed. */
	unplacedLabel: { x: number; y: number } | null;
	/** Whether anybody is charted at all — `false` when every member is unplaced. */
	rooted: boolean;
	/** The box around every card (and the label), or an empty box at the origin for no one. */
	bounds: ChartBox;
}

/** The canvas's view: a translation, then a uniform scale. Screen = canvas × `k` + (`x`, `y`). */
export interface ChartView {
	x: number;
	y: number;
	k: number;
}
// #endregion

// #region Shape
/** The reporting structure: the placed people's managers and reports, and everyone else. */
export interface ChartShape<M extends ChartMember> {
	/** The people at the top, in the order given. */
	roots: M[];
	/** Each placed manager's reports, in the order given. */
	reportsOf: Map<string, M[]>;
	/** Each placed person's manager. */
	managerOf: Map<string, string>;
	unplaced: M[];
}

/**
 * Resolve the reporting structure. `members` arrive in the order siblings should read (the caller's
 * sort), and every list here keeps it.
 *
 * The cycle guard walks each member's manager chain at most `members.length` steps: a chain that
 * revisits a member, or outlasts the roster, cannot end at a root, so the member is unplaced rather
 * than recursed into. That bound is what makes this total — a self-referential row cannot hang it.
 */
export function shapeChart<M extends ChartMember>(members: readonly M[]): ChartShape<M> {
	const byId = new Map(members.map((m) => [m.id, m]));

	const reachesRoot = (member: M): boolean => {
		const seen = new Set<string>([member.id]);
		let cursor = member.reportsTo;
		for (let step = 0; step <= members.length; step++) {
			if (cursor === null) return true;
			if (seen.has(cursor)) return false;
			const parent = byId.get(cursor);
			if (!parent) return false;
			seen.add(cursor);
			cursor = parent.reportsTo;
		}
		return false;
	};

	const roots: M[] = [];
	const reportsOf = new Map<string, M[]>();
	const managerOf = new Map<string, string>();
	const unplaced: M[] = [];
	for (const member of members) {
		if (!reachesRoot(member)) {
			unplaced.push(member);
			continue;
		}
		if (member.reportsTo === null) {
			roots.push(member);
			continue;
		}
		managerOf.set(member.id, member.reportsTo);
		const siblings = reportsOf.get(member.reportsTo) ?? [];
		siblings.push(member);
		reportsOf.set(member.reportsTo, siblings);
	}
	return { roots, reportsOf, managerOf, unplaced };
}

/** The managers above a placed member, nearest first — empty at the top or when not placed. */
export function managersAbove<M extends ChartMember>(shape: ChartShape<M>, id: string): string[] {
	const out: string[] = [];
	let cursor = shape.managerOf.get(id);
	while (cursor !== undefined && !out.includes(cursor)) {
		out.push(cursor);
		cursor = shape.managerOf.get(cursor);
	}
	return out;
}
// #endregion

// #region Layout
/**
 * Place every card. `closed` holds the managers whose reports are hidden; everyone else's are drawn.
 * The trees sit side by side from the origin; the unplaced group sits under them, left-aligned.
 */
export function layoutChart<M extends ChartMember>(
	members: readonly M[],
	closed: ReadonlySet<string> = new Set(),
): ChartLayout<M> {
	const shape = shapeChart(members);
	const nodes: ChartNode<M>[] = [];
	const edges: ChartEdge[] = [];

	/** Everyone below `id`, open or not. */
	const descendantsOf = (id: string): number =>
		(shape.reportsOf.get(id) ?? []).reduce((sum, r) => sum + 1 + descendantsOf(r.id), 0);
	const isOpen = (id: string) => (shape.reportsOf.get(id)?.length ?? 0) > 0 && !closed.has(id);

	/** The width a subtree takes, as drawn. */
	const widths = new Map<string, number>();
	const widthOf = (member: M): number => {
		const known = widths.get(member.id);
		if (known !== undefined) return known;
		const reports = isOpen(member.id) ? shape.reportsOf.get(member.id) ?? [] : [];
		const row = reports.reduce((sum, r) => sum + widthOf(r), 0) +
			GAP_X * Math.max(0, reports.length - 1);
		const width = Math.max(NODE_W, row);
		widths.set(member.id, width);
		return width;
	};

	const place = (member: M, left: number, level: number, parentId: string | null): void => {
		const width = widthOf(member);
		const x = left + (width - NODE_W) / 2;
		const y = (level - 1) * (NODE_H + GAP_Y);
		const reports = shape.reportsOf.get(member.id) ?? [];
		const open = isOpen(member.id);
		nodes.push({
			member,
			x,
			y,
			level,
			parentId,
			reports: reports.length,
			descendants: descendantsOf(member.id),
			open,
			unplaced: false,
		});
		if (!open) return;
		const row = reports.reduce((sum, r) => sum + widthOf(r), 0) + GAP_X * (reports.length - 1);
		let cursor = left + (width - row) / 2;
		for (const report of reports) {
			const childWidth = widthOf(report);
			const childX = cursor + (childWidth - NODE_W) / 2;
			edges.push({
				id: `${member.id}>${report.id}`,
				from: member.id,
				to: report.id,
				d: connectorPath(x + NODE_W / 2, y + NODE_H, childX + NODE_W / 2, y + NODE_H + GAP_Y),
			});
			place(report, cursor, level + 1, member.id);
			cursor += childWidth + GAP_X;
		}
	};

	let left = 0;
	for (const root of shape.roots) {
		place(root, left, 1, null);
		left += widthOf(root) + GAP_X;
	}

	let unplacedLabel: ChartLayout["unplacedLabel"] = null;
	if (shape.unplaced.length > 0) {
		const top = nodes.length > 0 ? Math.max(...nodes.map((n) => n.y)) + NODE_H + GROUP_GAP : 0;
		unplacedLabel = { x: 0, y: top };
		shape.unplaced.forEach((member, i) => {
			nodes.push({
				member,
				x: (i % UNPLACED_PER_ROW) * (NODE_W + GAP_X),
				y: top + LABEL_ROOM + Math.floor(i / UNPLACED_PER_ROW) * (NODE_H + GAP_X),
				level: 1,
				parentId: null,
				reports: 0,
				descendants: 0,
				open: false,
				unplaced: true,
			});
		});
	}

	return {
		nodes,
		edges,
		unplacedLabel,
		rooted: shape.roots.length > 0,
		bounds: boundsOf(nodes, unplacedLabel),
	};
}

/** The block room the "Not placed" label takes above its cards. */
export const LABEL_ROOM = 40;

/**
 * The connector from a manager's bottom-centre to a report's top-centre: straight down when they are
 * aligned, else down to the midline, across, and down, with rounded elbows that never overshoot a
 * short run.
 */
export function connectorPath(x1: number, y1: number, x2: number, y2: number): string {
	if (Math.abs(x2 - x1) < 0.5) return `M${x1} ${y1}V${y2}`;
	const mid = y1 + (y2 - y1) / 2;
	const dir = x2 > x1 ? 1 : -1;
	const r = Math.min(ELBOW_RADIUS, Math.abs(x2 - x1) / 2, (y2 - y1) / 2);
	return [
		`M${x1} ${y1}`,
		`V${mid - r}`,
		`Q${x1} ${mid} ${x1 + dir * r} ${mid}`,
		`H${x2 - dir * r}`,
		`Q${x2} ${mid} ${x2} ${mid + r}`,
		`V${y2}`,
	].join("");
}

function boundsOf(
	nodes: readonly ChartNode<ChartMember>[],
	label: { x: number; y: number } | null,
): ChartBox {
	if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const n of nodes) {
		minX = Math.min(minX, n.x);
		minY = Math.min(minY, n.y);
		maxX = Math.max(maxX, n.x + NODE_W);
		maxY = Math.max(maxY, n.y + NODE_H);
	}
	if (label) {
		minX = Math.min(minX, label.x);
		minY = Math.min(minY, label.y);
	}
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
// #endregion

// #region Viewport
/** Clamp a zoom into `[min, max]`. */
export function clampZoom(k: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, k));
}

/**
 * The view that fits `box` inside a `width` × `height` viewport with `pad` around it, centred, never
 * closer than `maxFit` (a three-person chart is not blown up to fill a monitor) nor further than
 * `min`.
 */
export function fitView(
	box: ChartBox,
	width: number,
	height: number,
	opts: { pad: number; min: number; maxFit: number },
): ChartView {
	if (box.width <= 0 || box.height <= 0 || width <= 0 || height <= 0) {
		return { x: width / 2 - box.x, y: opts.pad - box.y, k: 1 };
	}
	const k = clampZoom(
		Math.min((width - 2 * opts.pad) / box.width, (height - 2 * opts.pad) / box.height),
		opts.min,
		opts.maxFit,
	);
	return {
		x: (width - box.width * k) / 2 - box.x * k,
		y: (height - box.height * k) / 2 - box.y * k,
		k,
	};
}

/** The view zoomed to `k` about the screen point (`px`, `py`), which stays under the pointer. */
export function zoomAbout(view: ChartView, k: number, px: number, py: number): ChartView {
	const ratio = k / view.k;
	return { x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio, k };
}

/**
 * The view moved just enough to bring `box` fully on screen with `pad` to spare, or `view` itself when
 * it already is. A box larger than the viewport is centred instead.
 */
export function revealBox(
	view: ChartView,
	box: ChartBox,
	width: number,
	height: number,
	pad: number,
): ChartView {
	const axis = (offset: number, start: number, size: number, extent: number): number => {
		const a = start * view.k + offset;
		const b = a + size * view.k;
		if (b - a > extent - 2 * pad) return offset + (extent / 2 - (a + b) / 2);
		if (a < pad) return offset + (pad - a);
		if (b > extent - pad) return offset - (b - (extent - pad));
		return offset;
	};
	const x = axis(view.x, box.x, box.width, width);
	const y = axis(view.y, box.y, box.height, height);
	return x === view.x && y === view.y ? view : { x, y, k: view.k };
}
// #endregion
