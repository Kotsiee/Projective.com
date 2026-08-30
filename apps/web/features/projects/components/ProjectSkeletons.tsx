import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/skeletons.css";
import { Skeleton } from "@projective/ui/feedback";

/**
 * ProjectSkeletons — loading placeholders SHAPED LIKE THE ROWS THEY REPLACE, for the projects
 * workspace islands (files · submissions · board · chat).
 *
 * The point is geometry, not decoration. Three of these surfaces virtualize against the WINDOW, so
 * the block a skeleton occupies is about to be replaced by an absolutely-positioned sizer: a
 * placeholder sized by eye re-flows the instant real data lands, which is the jump it was supposed
 * to prevent. So every metric is passed in from the SAME source of truth the virtualizer reads —
 * `gridColWidth(zoom)` / `listRowHeight(zoom)` / the grid gap / the card meta strip — and the
 * skeleton renders from INSIDE the item renderer, beside the real viewport it stands in for, rather
 * than being swapped in above it where the two could drift apart.
 *
 * The blocks are `@projective/ui` `Skeleton`s. That primitive is `aria-hidden` and purely
 * decorative, so each shape pairs it with a visually-hidden `role="status"` line — the placeholder
 * is what a sighted reader gets, the announcement is what everyone else gets.
 */

// #region Props
/** How many placeholders a shape draws when the caller has no better number. */
const DEFAULTS = { grid: 12, list: 10, columns: 4, tickets: 3, chat: 2 } as const;

interface SkeletonAnnouncement {
	/**
	 * The announcement for the paired status region. Name the thing being loaded — "Loading…" alone
	 * tells a screen-reader user that something is happening but not what.
	 */
	label: string;
}

export type ProjectSkeletonProps =
	& SkeletonAnnouncement
	& (
		| {
			shape: "grid";
			/** Cells to draw — pass the outgoing item count so a refine redraws at the same extent. */
			count?: number;
			/** `gridColWidth(zoom)` — the live minimum column width (px) the real grid packs to. */
			colWidth: number;
			/** The grid gap (px) — the real grid's `gap`, and the remainder of its row pitch. */
			gap: number;
			/** The card meta strip height (px) below the square thumbnail. */
			metaHeight: number;
		}
		| {
			shape: "list";
			count?: number;
			/** `listRowHeight(zoom)` — the live row height (px) the real table virtualizes at. */
			rowHeight: number;
			/** Whether the live row shows an inline thumbnail at this density. */
			thumbnails?: boolean;
		}
		| {
			/**
			 * The submissions drill-down list. Its rows are NOT virtualized and NOT a fixed height —
			 * they are content-sized — so this shape takes no metrics and instead rebuilds the row from
			 * the same ingredients the live one uses (its padding, its lead square, and a two-line
			 * identity stack at the same type sizes), which keeps the heights equal by construction.
			 */
			shape: "node-list";
			count?: number;
		}
		| { shape: "board"; columns?: number; tickets?: number }
		| { shape: "chat"; count?: number }
	);
// #endregion

// #region Shapes
function gridCells(count: number): JSX.Element[] {
	return Array.from({ length: count }, (_, i) => (
		<div class="pj-skel__cell" key={i}>
			<div class="pj-skel__thumb">
				<Skeleton height="100%" radius="var(--card-radius)" />
			</div>
			<div class="pj-skel__meta">
				<Skeleton shape="text" width="78%" />
				<Skeleton shape="text" width="46%" />
			</div>
		</div>
	));
}

function listRows(count: number): JSX.Element {
	return (
		<div class="pj-skel__table">
			<div class="pj-skel__thead">
				{[0, 1, 2, 3].map((i) => (
					<div class="pj-skel__th" key={i}>
						<Skeleton shape="text" width="60%" height="0.6875rem" />
					</div>
				))}
			</div>
			{Array.from({ length: count }, (_, i) => (
				<div class="pj-skel__row" key={i}>
					<span class="pj-skel__rowmark">
						<Skeleton shape="rect" width="1.75rem" height="1.75rem" radius="var(--radius-sm)" />
					</span>
					<span class="pj-skel__rowname">
						<Skeleton shape="text" width={i % 3 === 0 ? "42%" : "64%"} />
					</span>
					<span class="pj-skel__rowcell">
						<Skeleton shape="text" width="80%" />
					</span>
					<span class="pj-skel__rowcell">
						<Skeleton shape="text" width="70%" />
					</span>
					<span class="pj-skel__rowcell">
						<Skeleton shape="text" width="50%" />
					</span>
				</div>
			))}
		</div>
	);
}

function nodeRows(count: number): JSX.Element {
	return (
		<div class="pj-skel__nodelist">
			{Array.from({ length: count }, (_, i) => (
				<div class="pj-skel__noderow" key={i}>
					<span class="pj-skel__nodelead">
						<Skeleton shape="rect" width="1.75rem" height="1.75rem" radius="var(--radius-sm)" />
					</span>
					<span class="pj-skel__nodeid">
						<Skeleton
							shape="text"
							width={i % 3 === 0 ? "38%" : "56%"}
							height="calc(0.875rem * var(--leading-normal))"
						/>
						<Skeleton shape="text" width="30%" height="calc(0.75rem * var(--leading-normal))" />
					</span>
					<span class="pj-skel__nodecount">
						<Skeleton shape="text" width="2.5rem" />
					</span>
				</div>
			))}
		</div>
	);
}

function boardColumns(columns: number, tickets: number): JSX.Element {
	return (
		<div class="pj-skel__board">
			{Array.from({ length: columns }, (_, c) => (
				<div class="pj-skel__col" key={c}>
					<div class="pj-skel__colhead">
						<Skeleton shape="text" width="7rem" />
						<Skeleton shape="circle" width="1.25rem" />
					</div>
					<div class="pj-skel__colbody">
						{Array.from({ length: tickets }, (_, t) => (
							<div class="pj-skel__ticket" key={t}>
								<Skeleton shape="text" width={t % 2 === 0 ? "86%" : "62%"} />
								<Skeleton shape="text" width="40%" />
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

function chatBubbles(count: number): JSX.Element {
	return (
		<div class="pj-skel__chat">
			{Array.from(
				{ length: count },
				(_, i) => (
					<div class={i % 2 === 1 ? "pj-skel__msg pj-skel__msg--own" : "pj-skel__msg"} key={i}>
						<Skeleton shape="circle" width="2rem" />
						<div class="pj-skel__bubble">
							<Skeleton shape="text" lines={2} />
						</div>
					</div>
				),
			)}
		</div>
	);
}
// #endregion

/**
 * Renders one shape-matched placeholder block plus its announcement.
 *
 * `grid` and `list` take their metrics from the caller because those two are the virtualized
 * viewports — pass the same values handed to `VirtualGrid`/`FileTable` and the placeholder and the
 * real thing occupy identical boxes.
 */
export function ProjectSkeleton(props: ProjectSkeletonProps): JSX.Element {
	const style = props.shape === "grid"
		? [
			"--pj-skel-col:" + props.colWidth + "px",
			"--pj-skel-gap:" + props.gap + "px",
			"--pj-skel-meta:" + props.metaHeight + "px",
		].join(";")
		: props.shape === "list"
		? "--pj-skel-row:" + props.rowHeight + "px"
		: undefined;

	const compact = props.shape === "list" && props.thumbnails === false;
	const cls = "pj-skel pj-skel--" + props.shape + (compact ? " pj-skel--compact" : "");

	return (
		<div class={cls} style={style}>
			<span class="ui-visually-hidden" role="status">{props.label}</span>
			<div aria-hidden="true">
				{props.shape === "grid" && (
					<div class="pj-skel__grid">{gridCells(props.count ?? DEFAULTS.grid)}</div>
				)}
				{props.shape === "list" && listRows(props.count ?? DEFAULTS.list)}
				{props.shape === "node-list" && nodeRows(props.count ?? DEFAULTS.list)}
				{props.shape === "board" &&
					boardColumns(props.columns ?? DEFAULTS.columns, props.tickets ?? DEFAULTS.tickets)}
				{props.shape === "chat" && chatBubbles(props.count ?? DEFAULTS.chat)}
			</div>
		</div>
	);
}

// #region Delay gate
/** Below this, a resolved fetch never paints a placeholder at all. */
const SKELETON_DELAY_MS = 180;

/**
 * The gate deciding whether a pending load has lasted long enough to be worth drawing.
 *
 * `visible` is the signal to render on; `begin`/`end` bracket the request.
 */
export interface SkeletonGate {
	visible: Signal<boolean>;
	/** Arm the gate where the request starts. A second call while armed keeps the first deadline. */
	begin(): void;
	/** Hide and disarm. Call on EVERY settled path — a failure that skips this strands the skeleton. */
	end(): void;
}

/**
 * useSkeletonDelay — holds a skeleton back until a load has actually been slow.
 *
 * These backends are stubbed by default, so most fetches resolve within a tick; painting a
 * placeholder for every one of them makes the 300ms-debounced search strobe. The gate ships with the
 * skeleton rather than beside it because "do not draw this yet" is part of the placeholder's
 * contract, not a detail of any one island.
 *
 * A second `begin()` while the gate is already armed or showing deliberately does NOT restart the
 * clock: back-to-back refines are one wait from the reader's point of view, and re-arming would keep
 * pushing the placeholder out of reach of the load it describes.
 *
 * `begin()` decides that from refs and never READS `visible`, which matters because two of its
 * callers start their fetch inside a `useSignalEffect`: reading the gate's own signal there would
 * subscribe the effect to it, and the gate opening 180ms later would re-run the effect that started
 * the load — firing the request a second time. Writes are safe (they do not subscribe); reads are not.
 */
export function useSkeletonDelay(delayMs: number = SKELETON_DELAY_MS): SkeletonGate {
	const visible = useSignal(false);
	const timer = useRef<number | null>(null);
	const shown = useRef(false);

	return {
		visible,
		begin(): void {
			if (shown.current || timer.current !== null) return;
			timer.current = setTimeout(() => {
				timer.current = null;
				shown.current = true;
				visible.value = true;
			}, delayMs) as unknown as number;
		},
		end(): void {
			if (timer.current !== null) {
				clearTimeout(timer.current);
				timer.current = null;
			}
			shown.current = false;
			visible.value = false;
		},
	};
}
// #endregion
