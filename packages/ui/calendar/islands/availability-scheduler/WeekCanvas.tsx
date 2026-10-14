import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { cx } from "../../../core/cx.ts";
import { styleVars } from "../../../core/style.ts";
import { bandLabel, ruleName, weekdayName } from "./announce.ts";
import { clamp, DAY_MINUTES, fmtMinutes, weekColumns } from "./civil.ts";
import { useScheduler } from "./context.ts";
import { dragOutcome, type DragPoint, type DragSpec, type GhostPart } from "./drag.ts";
import { keyToAction } from "./keymap.ts";
import { bandsOnDay, type CanvasBand, type SchedulerAction, type Selection } from "./reducer.ts";
import type { Band, Layer, RuleDraft, Weekday } from "./types.ts";

// #region Geometry
/** Minutes per grid row. */
export const SLOT_MINUTES = 15;
/** Rows in the day (plan §5.4: 96 quarter hours). */
export const ROWS = DAY_MINUTES / SLOT_MINUTES;
const FIRST_VISIBLE_ROW = 7 * (60 / SLOT_MINUTES);
const DRAG_SLOP = 4;

function bandVars(band: Band) {
	return styleVars({
		"--avsched-offset": (band.start % SLOT_MINUTES) / SLOT_MINUTES,
		"--avsched-span": (band.end - band.start) / SLOT_MINUTES,
	});
}

function layerClass(layer: Layer): string {
	return layer === "working_hours" ? "ui-avsched__band--working" : "ui-avsched__band--call";
}

function pointAt(grid: HTMLElement, x: number, y: number): DragPoint | null {
	const heads = [...grid.querySelectorAll<HTMLElement>("[data-col]")];
	const first = grid.querySelector<HTMLElement>('[data-row="0"]');
	const last = grid.querySelector<HTMLElement>(`[data-row="${ROWS - 1}"]`);
	if (!heads.length || !first || !last) return null;
	const rects = heads.map((h) => h.getBoundingClientRect());
	let index = rects.findIndex((r) => x >= r.left && x < r.right);
	if (index < 0) {
		const leftmost = rects.reduce((m, r, i) => r.left < rects[m].left ? i : m, 0);
		const rightmost = rects.reduce((m, r, i) => r.right > rects[m].right ? i : m, 0);
		index = x < rects[leftmost].left ? leftmost : rightmost;
	}
	const top = first.getBoundingClientRect().top;
	const bottom = last.getBoundingClientRect().bottom;
	return {
		day: Number(heads[index].dataset.col) as Weekday,
		minute: clamp(((y - top) / (bottom - top)) * DAY_MINUTES, 0, DAY_MINUTES),
	};
}

function selectionOf(el: HTMLElement): Selection {
	return {
		ruleId: el.dataset.rule ?? "",
		bandIndex: Number(el.dataset.index),
		day: Number(el.dataset.day) as Weekday,
	};
}
// #endregion

// #region Band
interface BandButtonProps {
	id: string;
	day: Weekday;
	item: CanvasBand;
	label: string;
	selected: boolean;
	continuesOut: boolean;
	continuesIn: boolean;
}

function BandButton(props: BandButtonProps): JSX.Element {
	const { id, day, item, label, selected, continuesOut, continuesIn } = props;
	return (
		<button
			type="button"
			tabIndex={-1}
			id={id}
			data-band=""
			data-rule={item.rule.id}
			data-index={item.bandIndex}
			data-day={day}
			class={cx(
				"ui-avsched__band",
				layerClass(item.rule.layer),
				selected && "ui-avsched__band--selected",
			)}
			style={bandVars(item.band)}
			aria-label={label}
		>
			<span
				class="ui-avsched__band-handle ui-avsched__band-handle--start"
				data-handle="start"
				aria-hidden="true"
			/>
			<span class="ui-avsched__band-time" aria-hidden="true">
				{fmtMinutes(item.band.start)}–{fmtMinutes(item.band.end)}
			</span>
			<span
				class="ui-avsched__band-handle ui-avsched__band-handle--end"
				data-handle="end"
				aria-hidden="true"
			/>
			{continuesIn && (
				<span class="ui-avsched__continuation ui-avsched__continuation--in" aria-hidden="true" />
			)}
			{continuesOut && (
				<span class="ui-avsched__continuation ui-avsched__continuation--out" aria-hidden="true" />
			)}
		</button>
	);
}
// #endregion

// #region WeekCanvas
/**
 * The weekly add-rules as a `role="grid"` of 7 day columns × 96 quarter-hour rows, with each band an
 * absolutely positioned button. Drag on empty time creates, drag a band or its edges moves or
 * resizes, Alt-drag duplicates, Shift-click applies the selected band to another day; the full
 * keyboard map runs through {@link keyToAction}.
 */
export function WeekCanvas(): JSX.Element | null {
	const { store, locale, weekStartsOn, idBase, run } = useScheduler();
	const describeRule = (rule: RuleDraft) => store.engine.describe(rule);
	const gridRef = useRef<HTMLDivElement>(null);
	const ghost = useSignal<GhostPart[]>([]);
	const state = store.state.value;
	const isWeek = state.view === "week";

	useEffect(() => {
		const grid = gridRef.current;
		const cell = grid?.querySelector<HTMLElement>(`[data-row="${FIRST_VISIBLE_ROW}"]`);
		const head = grid?.querySelector<HTMLElement>("[data-head]");
		if (grid && cell) grid.scrollTop = cell.offsetTop - (head?.offsetHeight ?? 0);
	}, [isWeek]);

	useEffect(() => {
		const grid = gridRef.current;
		if (!grid || document.activeElement !== grid) return;
		const id = grid.getAttribute("aria-activedescendant");
		if (id) document.getElementById(id)?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [state.cursor.day, state.cursor.minute, state.selection]);

	if (!isWeek) return null;

	const columns = weekColumns(weekStartsOn);
	const dayNames = columns.map((d) => weekdayName(d, locale));
	const shortNames = columns.map((d) => weekdayName(d, locale, "short"));
	const cellId = (day: number, row: number) => `${idBase}-c${day}-${row}`;
	const bandId = (s: Selection) => `${idBase}-b${s.day}-${s.ruleId}-${s.bandIndex}`;

	const byDay = new Map<number, CanvasBand[]>();
	for (const d of columns) byDay.set(d, bandsOnDay(state.draft, d));
	const touches = (day: number, layer: Layer, minute: number) =>
		(byDay.get(day) ?? []).some((c) =>
			c.rule.layer === layer && (minute === 0 ? c.band.start === 0 : c.band.end === DAY_MINUTES)
		);

	const sel = state.selection;
	const selVisible = sel !== null &&
		(byDay.get(sel.day) ?? []).some((c) =>
			c.rule.id === sel.ruleId && c.bandIndex === sel.bandIndex
		);
	const activeId = selVisible && sel
		? bandId(sel)
		: cellId(state.cursor.day, Math.floor(state.cursor.minute / SLOT_MINUTES));
	const cursorRow = Math.floor(state.cursor.minute / SLOT_MINUTES);

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		const command = keyToAction(e, store.state.peek(), { scope: "canvas", inTextInput: false });
		if (!command) return;
		e.preventDefault();
		e.stopPropagation();
		run(command);
	};

	const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		const grid = gridRef.current;
		if (e.button !== 0 || !grid) return;
		const target = e.target as HTMLElement;
		if (target.closest("[data-head]") && !e.shiftKey) return;
		const origin = pointAt(grid, e.clientX, e.clientY);
		if (!origin) return;
		const now = store.state.peek();
		const bandEl = target.closest<HTMLElement>("[data-band]");
		e.preventDefault();
		grid.focus({ preventScroll: true });

		if (!bandEl && e.shiftKey) {
			if (now.selection && origin.day !== now.selection.day) {
				store.duplicateBand(now.selection, origin.day);
			}
			return;
		}

		let spec: DragSpec;
		if (bandEl) {
			const picked = selectionOf(bandEl);
			const rule = now.draft.rules.find((r) => r.id === picked.ruleId);
			const band = rule?.bands[picked.bandIndex];
			if (!rule || !band) return;
			const handle = target.closest<HTMLElement>("[data-handle]")?.dataset.handle;
			const kind = handle === "start" || handle === "end" ? handle : e.altKey ? "copy" : "move";
			spec = { kind, origin, sel: picked, band, layer: rule.layer };
		} else {
			spec = { kind: "create", origin, layer: now.layer };
		}

		const x0 = e.clientX;
		const y0 = e.clientY;
		let moved = false;
		let pending: SchedulerAction | null = null;

		const onMove = (ev: PointerEvent) => {
			if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_SLOP) return;
			moved = true;
			const at = pointAt(grid, ev.clientX, ev.clientY);
			if (!at) return;
			const outcome = dragOutcome(spec, at, store.snap.peek(), weekStartsOn);
			ghost.value = outcome.ghost;
			pending = outcome.action;
		};
		const stop = () => {
			globalThis.removeEventListener("pointermove", onMove);
			globalThis.removeEventListener("pointerup", onUp);
			globalThis.removeEventListener("pointercancel", onCancel);
			ghost.value = [];
		};
		const onCancel = () => stop();
		const onUp = () => {
			stop();
			if (moved) {
				if (pending) store.dispatch(pending);
				return;
			}
			if (spec.sel && spec.band) {
				store.dispatch({ type: "select", selection: spec.sel });
				store.dispatch({
					type: "setCursor",
					cursor: { day: spec.sel.day, minute: spec.band.start },
				});
			} else {
				const snap = store.snap.peek();
				store.dispatch({ type: "select", selection: null });
				store.dispatch({
					type: "setCursor",
					cursor: { day: origin.day, minute: Math.floor(origin.minute / snap) * snap },
				});
			}
		};
		globalThis.addEventListener("pointermove", onMove);
		globalThis.addEventListener("pointerup", onUp);
		globalThis.addEventListener("pointercancel", onCancel);
	};

	const onDblClick = (e: JSX.TargetedMouseEvent<HTMLDivElement>) => {
		const bandEl = (e.target as HTMLElement).closest<HTMLElement>("[data-band]");
		if (bandEl) store.dispatch({ type: "edit", ruleId: selectionOf(bandEl).ruleId });
	};

	const ghosts = ghost.value;
	const hintId = `${idBase}-canvas-hint`;
	const otherRules =
		state.draft.rules.filter((r) => r.active && (r.pattern.type !== "weekly" || r.effect !== "add"))
			.length;

	return (
		<div class="ui-avsched__week">
			<p class="ui-avsched__meta" id={hintId}>
				Drag on empty time to add{" "}
				{state.layer === "working_hours" ? "working hours" : "call windows"}
				{" · "}arrow keys move · Enter adds · ? lists every shortcut
				{otherRules > 0 &&
					` · ${otherRules} more ${otherRules === 1 ? "rule shows" : "rules show"} in Month`}
			</p>
			<div
				ref={gridRef}
				class="ui-avsched__canvas"
				role="grid"
				aria-label="Weekly availability"
				aria-rowcount={ROWS + 1}
				aria-colcount={8}
				aria-describedby={hintId}
				aria-activedescendant={activeId}
				tabIndex={0}
				onKeyDown={onKeyDown}
				onPointerDown={onPointerDown}
				onDblClick={onDblClick}
			>
				<div role="row" aria-rowindex={1} class="ui-avsched__row" data-head="">
					<div role="columnheader" aria-colindex={1} class="ui-avsched__corner">
						<span class="ui-visually-hidden">Time</span>
					</div>
					{columns.map((d, i) => (
						<div
							role="columnheader"
							aria-colindex={i + 2}
							class="ui-avsched__day"
							data-col={d}
							key={d}
						>
							<span aria-hidden="true">{shortNames[i]}</span>
							<span class="ui-visually-hidden">{dayNames[i]}</span>
						</div>
					))}
				</div>
				{Array.from({ length: ROWS }, (_, row) => {
					const minute = row * SLOT_MINUTES;
					const time = fmtMinutes(minute);
					return (
						<div role="row" aria-rowindex={row + 2} class="ui-avsched__row" key={row}>
							<div
								role="rowheader"
								aria-colindex={1}
								class={cx("ui-avsched__gutter", row % 4 === 0 && "ui-avsched__gutter--hour")}
							>
								<span class={row % 4 === 0 ? "ui-avsched__hour" : "ui-visually-hidden"}>
									{time}
								</span>
							</div>
							{columns.map((d, i) => {
								const starting = (byDay.get(d) ?? []).filter((c) =>
									Math.floor(c.band.start / SLOT_MINUTES) === row
								);
								const ghostHere = ghosts.filter((g) =>
									g.day === d && Math.floor(g.band.start / SLOT_MINUTES) === row
								);
								return (
									<div
										role="gridcell"
										aria-colindex={i + 2}
										id={cellId(d, row)}
										aria-label={`${dayNames[i]} ${time}`}
										class={cx(
											"ui-avsched__slot",
											row % 4 === 0 && "ui-avsched__slot--hour",
											d === state.cursor.day && row === cursorRow && "ui-avsched__slot--cursor",
										)}
										data-day={d}
										data-row={row}
										key={d}
									>
										{starting.map((item) => {
											const s = { ruleId: item.rule.id, bandIndex: item.bandIndex, day: d };
											let label = bandLabel(
												d,
												item.band,
												item.rule.layer,
												ruleName(item.rule, describeRule),
												locale,
											);
											const continuesOut = item.band.end === DAY_MINUTES &&
												touches((d + 1) % 7, item.rule.layer, 0);
											const continuesIn = item.band.start === 0 &&
												touches((d + 6) % 7, item.rule.layer, DAY_MINUTES);
											if (continuesOut) {
												label += `, continues into ${weekdayName((d + 1) % 7, locale)}`;
											}
											if (continuesIn) {
												label += `, continued from ${weekdayName((d + 6) % 7, locale)}`;
											}
											return (
												<BandButton
													key={bandId(s)}
													id={bandId(s)}
													day={d}
													item={item}
													label={label}
													selected={sel !== null && sel.ruleId === item.rule.id &&
														sel.bandIndex === item.bandIndex}
													continuesOut={continuesOut}
													continuesIn={continuesIn}
												/>
											);
										})}
										{ghostHere.map((g, gi) => (
											<span
												key={`ghost-${gi}`}
												class={cx(
													"ui-avsched__band",
													layerClass(g.layer),
													"ui-avsched__band--dragging",
												)}
												style={bandVars(g.band)}
												aria-hidden="true"
											>
												<span class="ui-avsched__band-time">
													{fmtMinutes(g.band.start)}–{fmtMinutes(g.band.end)}
												</span>
											</span>
										))}
									</div>
								);
							})}
						</div>
					);
				})}
			</div>
		</div>
	);
}
// #endregion
