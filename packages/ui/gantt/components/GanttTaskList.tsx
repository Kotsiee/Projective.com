/**
 * @projective/ui/gantt — the LANE LIST (SYSTEM_ARCHITECTURE.md §Charts "GanttTaskList"): the HTML
 * column of row labels beside the canvas.
 *
 * Its rows are in NORMAL FLOW, and that is what keeps them aligned with the canvas for free: the
 * hovered row grows by the expansion the store publishes, and every row below it is pushed down by
 * exactly that amount — the same arithmetic `core/layout.ts` does for the pixels. Only the rows in
 * the visible window are rendered, behind a spacer sized to the rows above them.
 *
 * Like the header, it has two channels: the window (a computed the island hands over, re-rendering
 * this component only when the set of visible rows changes) and the per-frame values (the vertical
 * offset, the row height, the expansion), which are written straight to the DOM from signal
 * subscriptions.
 */
import type { JSX } from "preact";
import type { ReadonlySignal } from "@preact/signals";
import { useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import type { GanttStore } from "../core/gantt-store.ts";
import { laneTop } from "../core/layout.ts";
import type { GanttLane } from "../core/types.ts";

export interface GanttTaskListProps {
	store: GanttStore;
	lanes: readonly GanttLane[];
	/** The inclusive lane window to render. */
	window: ReadonlySignal<{ first: number; last: number }>;
	/** How many items each lane holds — printed as the row's trailing figure when the lane has no `meta`. */
	countByLane: ReadonlyMap<string, number>;
	/** The column's own name to assistive tech. */
	heading: string;
	/** Which lane holds the selected item. */
	selectedLane: number | null;
	onHoverLane?: (index: number | null) => void;
	onActivateLane?: (lane: GanttLane, index: number) => void;
}

function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	return parts.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("") || "?";
}

export function GanttTaskList(props: GanttTaskListProps): JSX.Element {
	const { store, lanes, heading } = props;
	const listRef = useRef<HTMLDivElement>(null);
	const win = props.window.value;
	const rowH = store.rowH.value;

	// Vertical offset + live row height: written per frame, no render.
	useSignalEffect(() => {
		const y = store.scrollY.value;
		const h = store.rowH.value;
		const el = listRef.current;
		if (!el) return;
		el.style.transform = `translateY(${-y}px)`;
		el.style.setProperty("--gantt-row-h-live", `${h}px`);
	});
	// The hovered lane's expansion: one row's inline variable, cleared from the previous one.
	const lastExpanded = useRef<HTMLElement | null>(null);
	useSignalEffect(() => {
		const lane = store.hoverLane.value;
		const px = store.expandPx.value;
		const list = listRef.current;
		const prev = lastExpanded.current;
		const next = lane === null || !list
			? null
			: list.querySelector<HTMLElement>(`[data-lane="${lane}"]`);
		if (prev && prev !== next) prev.style.removeProperty("--gantt-expand");
		if (next) next.style.setProperty("--gantt-expand", `${Math.max(0, px)}px`);
		lastExpanded.current = next;
	});

	const rows: JSX.Element[] = [];
	for (let i = win.first; i <= win.last && i < lanes.length; i++) {
		const lane = lanes[i];
		const count = props.countByLane.get(lane.id) ?? 0;
		const trailing = lane.meta ?? (count > 0 ? `${count}` : "");
		const content = (
			<>
				{lane.avatar
					? (
						<span class="gantt-lane__face" aria-hidden="true">
							{lane.avatar.url
								? <img class="gantt-lane__photo" src={lane.avatar.url} alt="" loading="lazy" />
								: initials(lane.avatar.name)}
						</span>
					)
					: (
						<span
							class="gantt-lane__dot"
							aria-hidden="true"
							style={lane.accent
								? styleVars({ "--gantt-lane-accent": `var(${lane.accent})` })
								: undefined}
						/>
					)}
				<span class="gantt-lane__text">
					<span class="gantt-lane__label">{lane.label}</span>
					{lane.sublabel ? <span class="gantt-lane__sub">{lane.sublabel}</span> : null}
				</span>
				{trailing ? <span class="gantt-lane__meta">{trailing}</span> : null}
			</>
		);
		rows.push(
			<div
				key={lane.id}
				class={cx("gantt-lane", props.selectedLane === i && "gantt-lane--selected")}
				data-lane={i}
				style={styleVars({ "--gantt-lane-depth": lane.depth ?? 0 })}
				onPointerEnter={() => props.onHoverLane?.(i)}
				onPointerLeave={() => props.onHoverLane?.(null)}
			>
				{lane.href
					? <a class="gantt-lane__row gantt-lane__row--link" href={lane.href}>{content}</a>
					: props.onActivateLane
					? (
						<button
							type="button"
							class="gantt-lane__row gantt-lane__row--button"
							onClick={() => props.onActivateLane?.(lane, i)}
						>
							{content}
						</button>
					)
					: <div class="gantt-lane__row">{content}</div>}
			</div>,
		);
	}

	// The spacer stands in for every row above the window — including a hovered lane that has been
	// scrolled out of it, whose expansion still shifts everything beneath.
	const spacer = win.last >= win.first ? laneTop(win.first, store.geometry()) : 0;

	return (
		<div class="gantt-lanes" role="list" aria-label={heading}>
			<div
				class="gantt-lanes__list"
				ref={listRef}
				style={styleVars({
					"--gantt-row-h-live": `${rowH}px`,
					"--gantt-lanes-spacer": `${spacer}px`,
				})}
			>
				{rows}
			</div>
		</div>
	);
}
