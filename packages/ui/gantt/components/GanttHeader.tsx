/**
 * @projective/ui/gantt — the tiered TIME HEADER, in HTML.
 *
 * Two rows — the coarse context (years · months · days) over the fine grain (quarters · months ·
 * weeks · days · hours) — whose pair is chosen by the zoom (`tierFor`). They are real elements
 * rather than pixels because a header is chrome: it is read, it is selectable, and find-in-page
 * should reach it.
 *
 * TWO CHANNELS, TWO COSTS. The CELL SET changes only when the visible range crosses a tick boundary
 * or the tier changes — the island hands it over as a computed signal, so this component re-renders
 * when the value changes and not otherwise. The OFFSET changes on every scroll frame, and is applied
 * by writing a `transform` straight to the strip from a signal subscription: sixty translations a
 * second cost no VDOM work at all.
 *
 * Labels are chosen by WIDTH from the tick's three forms (full · short · narrow), never truncated:
 * "Ju…" is not a month, and a cell that cannot fit "J" says nothing rather than something wrong.
 */
import type { JSX } from "preact";
import type { ReadonlySignal } from "@preact/signals";
import { useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import type { GanttStore } from "../core/gantt-store.ts";
import type { TimeTick } from "../core/time-scale.ts";

export interface GanttHeaderProps {
	store: GanttStore;
	/** The coarse row's ticks for the current window — one more than visible, so the last cell has a width. */
	top: ReadonlySignal<TimeTick[]>;
	/** The fine row's ticks. */
	bottom: ReadonlySignal<TimeTick[]>;
	/** The instant "today" sits at, or null. The fine cell holding it is marked. */
	nowMs: number | null;
}

/** Approximate px per character at the header's type size — what decides which label form fits. */
const CHAR_PX = 6.6;
/** Horizontal padding a cell keeps around its label. */
const CELL_PAD = 8;

function labelFor(tick: TimeTick, cellW: number): string {
	const fits = (s: string) => s.length * CHAR_PX + CELL_PAD <= cellW;
	if (fits(tick.label)) return tick.label;
	if (fits(tick.short)) return tick.short;
	if (fits(tick.narrow)) return tick.narrow;
	return "";
}

function Row(
	{ store, ticks, nowMs, fine }: {
		store: GanttStore;
		ticks: TimeTick[];
		nowMs: number | null;
		fine: boolean;
	},
): JSX.Element {
	const ppd = store.pxPerDay.value;
	const cells: JSX.Element[] = [];
	for (let i = 0; i < ticks.length - 1; i++) {
		const t = ticks[i];
		const next = ticks[i + 1];
		const x = store.xOf(t.ms);
		const w = store.xOf(next.ms) - x;
		if (w <= 0) continue;
		const today = nowMs !== null && nowMs >= t.ms && nowMs < next.ms;
		cells.push(
			<span
				key={t.ms}
				class={cx(
					"gantt-head__cell",
					t.major && "gantt-head__cell--major",
					fine && today && "gantt-head__cell--today",
				)}
				style={styleVars({ "--gantt-cell-x": `${x}px`, "--gantt-cell-w": `${w}px` })}
				title={t.label}
			>
				{labelFor(t, w)}
			</span>,
		);
	}
	// `ppd` is read so the row re-renders when the zoom moves the cells under a stable tick set.
	return <div class="gantt-head__row" data-ppd={Math.round(ppd)}>{cells}</div>;
}

export function GanttHeader({ store, top, bottom, nowMs }: GanttHeaderProps): JSX.Element {
	const stripRef = useRef<HTMLDivElement>(null);

	// The scroll offset is written straight to the strip — no render per frame.
	useSignalEffect(() => {
		const x = store.scrollX.value;
		const rtl = store.rtl.value;
		const el = stripRef.current;
		if (el) el.style.transform = `translateX(${rtl ? x : -x}px)`;
	});

	return (
		<div class="gantt-head" aria-hidden="true">
			<div class="gantt-head__strip" ref={stripRef}>
				<Row store={store} ticks={top.value} nowMs={nowMs} fine={false} />
				<Row store={store} ticks={bottom.value} nowMs={nowMs} fine />
			</div>
		</div>
	);
}
