/**
 * @projective/ui/calendar — the composed Calendar & Schedule island (DESIGN_SYSTEM.md §C.1). The ONE
 * hydrated entry: it owns the view state (mode · focus date · zoom · search · filters), wires the
 * gesture continuum (Ctrl+wheel zooms in place AND transitions Day↔Week↔Month across thresholds), and
 * lays out the two-panel structure — a narrow left panel (mini-map mini-map + availability summary)
 * and the main viewport (header + Day/Week time grid or Month grid). It is CONTROLLED: the consumer
 * owns the events/availability and reacts to {@link CalendarProps.onSelectRange} /
 * {@link CalendarProps.onOpenEvent}; the engine owns navigation + gestures. Portable + token-only.
 */
import type { JSX } from "preact";
import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/calendar.css";
import { cx } from "../../core/cx.ts";
import type {
	CalendarEvent,
	CalendarEventKind,
	CalendarProps,
	CalendarRange,
	CalendarViewMode,
} from "../core/types.ts";
import {
	addZonedDays,
	addZonedMonths,
	fmtDayLabel,
	fmtFullDate,
	fmtMonthYear,
	localTimezone,
	startOfDay,
	weekDays,
} from "../core/time.ts";
import { CALENDAR_KIND_LABEL } from "../core/kinds.ts";
import { useNowTick } from "../hooks/useNowTick.ts";
import { MiniMonth } from "../components/MiniMonth.tsx";
import { AvailabilityPanel } from "../components/AvailabilityPanel.tsx";
import { CalendarHeader } from "../components/CalendarHeader.tsx";
import { TimeGrid } from "../components/TimeGrid.tsx";
import { DayTimeline } from "../components/DayTimeline.tsx";
import { MonthGrid } from "../components/MonthGrid.tsx";
import { EventPopoverLayer } from "../components/EventPopoverLayer.tsx";
import type { EventPopoverState } from "../components/EventPopoverLayer.tsx";

const DEFAULT_PPH = 48;
const MIN_PPH = 26;
const MAX_PPH = 168;
/** One wheel notch's scale factor. Small enough that a trackpad reads as continuous. */
const ZOOM_STEP = 1.12;
/**
 * The bounds the interpolating spring and the pinch gesture clamp into.
 *
 * The same pair the threshold continuum reads, handed to the viewport rather than restated inside it:
 * a spring allowed past MAX_PPH would sail through the week→day threshold the continuum is watching
 * for, and the crossing would be decided by whichever of the two noticed first.
 */
const ZOOM_RANGE: readonly [number, number] = [MIN_PPH, MAX_PPH];
/**
 * The layout zones the popover must never sit on top of, as live CSS selectors.
 *
 * They are re-measured on every reposition rather than captured once, so a collapsing rail or a
 * dragged lane stays honoured. The engine names the SHELL's zones rather than its own because a
 * popover anchored to a card near the inline start would otherwise open straight onto the site
 * navigation — which is a higher-level surface than anything this package owns.
 */
const POPOVER_AVOID = [".ui-app-shell__sidebar", ".ui-middle-nav__lane"] as const;

/**
 * The "nothing is expanded" set, shared rather than minted per read.
 *
 * `useComputed` notifies on every new VALUE, and a fresh empty `Set` is a new value every time — which
 * would re-run the placement engine for every day on screen on any unrelated popover change. One
 * frozen instance makes the common case genuinely free.
 */
const EMPTY_CLUSTERS: ReadonlySet<string> = new Set<string>();

export default function Calendar(props: CalendarProps): JSX.Element {
	const tz = props.timezone ?? props.availability?.timezone ?? localTimezone();
	const hour12 = true;

	const view = useSignal<CalendarViewMode>(props.view ?? "week");
	const focusMs = useSignal<number>(props.focus ?? Date.now());
	const monthMs = useSignal<number>(props.focus ?? Date.now());
	const pph = useSignal<number>(DEFAULT_PPH);
	const query = useSignal("");
	const filtersOpen = useSignal(false);
	const hiddenKinds = useSignal<Set<CalendarEventKind>>(new Set());
	/**
	 * Which overlap clusters the reader has opened, and the popover the whole engine writes into.
	 *
	 * Both live HERE rather than in a view, because the Week grid and the Day timeline are two
	 * renderings of the same day: a fold the reader opened in one has not closed itself by the time
	 * they switch to the other, and a popover owned by a view would be torn down by the very view
	 * switch a zoom threshold triggers.
	 */
	const popover = useSignal<EventPopoverState | null>(null);
	/**
	 * The event a row in the overlap-list popover is currently under the pointer, published BY the
	 * panel and read by both grids so they can ring the block it stands for.
	 *
	 * It cannot be the grid's own hover: the panel is body-portalled, so travelling into it fires the
	 * grid viewport's `pointerleave` and clears that channel — on the very card the row stands for.
	 */
	const highlight = useSignal<string | null>(null);
	/**
	 * The live DRAFT: a range the reader has begun creating and has not committed, drawn on the grid
	 * as a dashed block they can still drag and resize while its quick-create popover is open.
	 */
	const draft = useSignal<CalendarRange | null>(null);
	/**
	 * Raised while a pointer is held on the draft BLOCK, so the composer beside it survives the press.
	 *
	 * The block is painted pixels, not an element, so the overlay-containment model reads a press on it
	 * as a click-away and closes the very panel the reader is dragging it for. Written by the grid,
	 * read by the layer — one fact, one writer.
	 */
	const pointerGuard = useSignal(false);

	/**
	 * WHICH OVERLAP CLUSTER IS EXPANDED — derived from the popover rather than held beside it.
	 *
	 * The two used to be separate facts and they disagreed: the `+N` chip expanded a cluster silently
	 * while pressing the merged card opened a list that expanded nothing, so the reader had two ways
	 * to ask the same question and got a different half of the answer from each. Deriving it means
	 * "the cluster is open" and "its list is open" cannot come apart, and it is what makes §1's
	 * collapse rules free rather than three more code paths: a click outside, an Escape and a
	 * committed pick all dismiss the popover, and the cluster refolds with it because there is nothing
	 * else holding it open.
	 *
	 * Kept as a `useComputed` over a `Set` so the props both grids already take are unchanged, and so
	 * a consumer's `onUnfoldChange` still hears about it.
	 */
	const unfolded = useComputed<ReadonlySet<string>>(() => {
		const p = popover.value;
		return p?.kind === "stack" ? new Set([p.clusterId]) : EMPTY_CLUSTERS;
	});
	const lastUnfold = useRef<string>("");
	useSignalEffect(() => {
		const set = unfolded.value;
		const key = Array.from(set).join(",");
		if (key === lastUnfold.current) return;
		lastUnfold.current = key;
		props.onUnfoldChange?.(set);
	});

	/**
	 * Refold a cluster — the "show fewer" control the Day timeline draws on an open cluster.
	 *
	 * Expanding is not routed through here: pressing a merged card or its `+N` chip goes through the
	 * grid's own `openCard`, which opens the list AND expands the cluster in one move. This handles
	 * only the other direction, and it does it by closing the popover, because the popover is what
	 * holds the cluster open.
	 */
	function toggleUnfold(clusterId: string): void {
		if (popover.peek()?.kind === "stack") popover.value = null;
		else if (clusterId) popover.value = null;
	}

	/**
	 * Commit the quick-create, then clear the draft.
	 *
	 * The draft is cleared HERE rather than left to the popover, because the draft belongs to the grid
	 * and the popover belongs to the panel: a committed event arrives through `props.events` on the
	 * next render, and a dashed block still sitting on top of it would be the same event drawn twice,
	 * once as provisional and once as real.
	 */
	function quickCreate(range: CalendarRange, title: string): void {
		draft.value = null;
		props.onQuickCreate?.(range, title);
	}

	/** Hand the composer's contents to the full creation surface, and take the draft off the grid. */
	function expandCreate(range: CalendarRange, title: string): void {
		draft.value = null;
		props.onExpandCreate?.(range, title);
	}

	/*
	 * A DISMISSED popover takes the draft with it (§3: "Escape cancels creation and removes the draft
	 * block from the grid").
	 *
	 * Watched here rather than handled inside the panel's own `close`, because there are three ways a
	 * create popover ends — Escape, an outside pointer, and a committed submit — and the first two are
	 * `useDismiss`'s to fire. One watcher on the fact they all produce is one code path instead of
	 * three that have to agree.
	 */
	useSignalEffect(() => {
		if (popover.value === null && draft.peek() !== null) draft.value = null;
	});

	/*
	 * THE RETURN LEG of `onExpandCreate` — a host minimising its full surface back into the composer.
	 *
	 * The anchor is deliberately EMPTY here. The composer is anchored to the draft BLOCK, and only the
	 * grid knows where that block currently is (it depends on the zoom, the scroll offset and which
	 * day column the range falls in) — so the grid re-anchors it on its next frame, which is also what
	 * keeps the panel attached while the reader drags the block around. Guessing a rect here would put
	 * the panel in the right place exactly once.
	 *
	 * The request is CLEARED as it is consumed: it is a message, not a second copy of the composer's
	 * state, and a host that kept holding it would be typing over the reader on every render.
	 */
	useSignalEffect(() => {
		const req = props.compose?.value;
		if (!req) return;
		props.compose!.value = null;
		draft.value = req.range;
		popover.value = {
			kind: "create",
			range: req.range,
			anchor: { x: 0, y: 0, w: 0, h: 0 },
			title: req.title,
		};
	});

	const { now, mounted } = useNowTick(60_000, props.focus ?? 0);
	/**
	 * The clock, QUANTISED to a day. `now` itself is never read in this render body: doing so made a
	 * minute tick re-render the header, the 42-button mini-map, the availability panel and every day
	 * column — re-running `packDayEvents` and re-rendering every event block — to move one 2px rule.
	 * A computed only notifies its subscribers when its VALUE changes, so this is silent until midnight
	 * while the raw signal travels on to the two leaves that genuinely need a minute: the now-line
	 * ({@link NowIndicator}) and the availability panel's clock.
	 */
	const todayMs = useComputed(() => (mounted.value ? startOfDay(now.value, tz) : null));
	const mainRef = useRef<HTMLDivElement>(null);

	// #region Persistence (optional)
	/**
	 * The engine persists only what it OWNS.
	 *
	 * A host that passes {@link CalendarProps.view} owns the view — it drives it from its own control
	 * and its own store — so restoring one from storage here would be a second owner: the load effect
	 * below restores the reader's last choice, the host-tracking effect further down then immediately
	 * writes the host's value over it, and the reader's preference is silently lost while the write
	 * effect keeps dutifully saving it. Zoom has no such competing owner and is always persisted.
	 */
	const hostOwnsView = props.view !== undefined;

	useEffect(() => {
		if (!props.storageKey || typeof localStorage === "undefined") return;
		try {
			if (!hostOwnsView) {
				const v = localStorage.getItem(`${props.storageKey}:view`);
				if (v === "day" || v === "week" || v === "month") view.value = v;
			}
			const z = localStorage.getItem(`${props.storageKey}:zoom`);
			if (z) pph.value = Math.max(MIN_PPH, Math.min(MAX_PPH, Number(z)));
		} catch { /* storage unavailable */ }
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	useEffect(() => {
		if (!props.storageKey || typeof localStorage === "undefined") return;
		try {
			if (!hostOwnsView) localStorage.setItem(`${props.storageKey}:view`, view.value);
			localStorage.setItem(`${props.storageKey}:zoom`, String(Math.round(pph.value)));
		} catch { /* no-op */ }
	}, [view.value, pph.value, props.storageKey, hostOwnsView]);
	// #endregion

	// #region Host-driven view state
	/*
	 * `view` and `focus` were read ONCE, as signal seeds, which made the engine controlled on its data
	 * and uncontrolled on its navigation: a host that moved either prop after mount saw nothing
	 * happen. That is fine while the engine draws its own header, and impossible for a host that has
	 * hoisted the period trail and the view switch into a shell band and now owns them.
	 *
	 * Tracking them costs a consumer passing a constant nothing — the dependency never changes, so
	 * the effect runs once and writes the value the signal was already seeded with.
	 */
	useEffect(() => {
		if (props.view && props.view !== view.value) view.value = props.view;
	}, [props.view]);
	useEffect(() => {
		if (props.focus === undefined || props.focus === focusMs.value) return;
		focusMs.value = props.focus;
		monthMs.value = props.focus;
	}, [props.focus]);
	// #endregion

	// #region Ctrl+wheel zoom / mode continuum (preventDefault → no browser page-zoom)
	/**
	 * The live view's interpolator, registered by whichever timed grid is mounted.
	 *
	 * The scale is the ISLAND's state — it is persisted and it drives the view continuum — but only the
	 * mounted viewport knows where the cursor is anchored and can re-solve the offset from it each
	 * frame. So the island holds the number and the viewport holds the journey.
	 */
	const zoomRef = useRef<
		((target: number, opts?: { onSettle?: () => void }) => () => void) | null
	>(null);
	const cancelZoom = useRef<(() => void) | null>(null);
	/** The scale the last notch AIMED at, while the interpolation is still travelling toward it. */
	const pendingPph = useRef<number | null>(null);
	useEffect(() => () => cancelZoom.current?.(), []);
	useEffect(() => {
		const el = mainRef.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			if (!(e.ctrlKey || e.metaKey)) return;
			e.preventDefault();
			zoom(e.deltaY < 0 ? "in" : "out");
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	/**
	 * Cross a view threshold.
	 *
	 * The ONE place the zoom continuum changes the mode, and it routes through the same notification
	 * the header's own switch does. That is not tidiness: the shipped `/calendar` hub renders this
	 * engine with `hideHeader` and owns the Day/Week/Month control in two OTHER hydration roots, so a
	 * threshold crossing that wrote `view.value` directly — which is what it used to do — left the grid
	 * showing Day while the segmented control and the period label still said Week. A view the host
	 * cannot hear about is a view the host cannot draw.
	 */
	function crossTo(next: CalendarViewMode, scale: number): void {
		cancelZoom.current?.();
		cancelZoom.current = null;
		pendingPph.current = null;
		pph.value = scale;
		if (view.peek() === next) return;
		view.value = next;
		props.onViewChange?.(next);
	}

	/**
	 * One zoom notch.
	 *
	 * Inside a view the scale INTERPOLATES toward its target (`zoomRef.current` is the live viewport's
	 * own tween, which re-pins the cursor anchor on every frame — see `TimeGridProps.onZoom`). Across a
	 * threshold it is written outright, because the two sides of a threshold are different geometries
	 * and there is no continuous scale to travel along: a week grid at 168px/hour and a day grid at
	 * 26px/hour are not two points on one ramp.
	 */
	function zoom(dir: "in" | "out"): void {
		const v = view.value;
		/*
		 * The PENDING scale, not the live one.
		 *
		 * A trackpad does not emit one wheel notch, it emits a burst of them inside a single frame —
		 * and the scale is interpolated, so `pph.value` has not moved yet when the second notch of that
		 * burst arrives. Reading the live signal therefore made every notch in a burst compute the same
		 * target from the same starting number, and six notches produced exactly one notch of zoom. The
		 * reader's flick has to compound, so each notch is measured from where the last one was AIMED.
		 */
		const cur = pendingPph.current ?? pph.value;
		if (dir === "in") {
			if (v === "month") return crossTo("week", MIN_PPH);
			if (v === "week" && cur >= MAX_PPH - 1) return crossTo("day", MIN_PPH);
			zoomTo(Math.min(MAX_PPH, cur * ZOOM_STEP));
		} else {
			if (v === "day" && cur <= MIN_PPH + 1) return crossTo("week", MAX_PPH);
			if (v === "week" && cur <= MIN_PPH + 1) return crossTo("month", cur);
			if (v === "month") return;
			zoomTo(Math.max(MIN_PPH, cur / ZOOM_STEP));
		}
	}

	/**
	 * Animate the scale toward `target`, through the live view's own viewport so the cursor anchor is
	 * honoured on every frame.
	 *
	 * `zoomRef` is filled by whichever timed view is mounted. When nothing has filled it — the Month
	 * view, or a first notch before the grid has laid out — the scale is written directly, which is
	 * also exactly what a reduced-motion reader and a hidden tab get.
	 */
	function zoomTo(target: number): void {
		const run = zoomRef.current;
		pendingPph.current = target;
		if (!run) {
			pph.value = target;
			pendingPph.current = null;
			return;
		}
		cancelZoom.current?.();
		cancelZoom.current = run(target, {
			// Cleared on settle rather than on the next notch, so a burst compounds while it is in
			// flight and the NEXT gesture starts from wherever the scale actually came to rest —
			// including a rest the consumer imposed by writing `pxPerHour` itself.
			onSettle: () => {
				pendingPph.current = null;
			},
		});
	}
	// #endregion

	// #region Navigation
	function setView(v: CalendarViewMode): void {
		view.value = v;
		pph.value = DEFAULT_PPH;
		props.onViewChange?.(v);
	}
	/**
	 * The ONE place the focus moves. Every path — nav step, Today, mini-map pick, the scroll centre
	 * crossing a day — routes through it, so a host reading {@link CalendarProps.onFocusChange} can
	 * never be told about some moves and not others.
	 */
	function setFocus(ms: number): void {
		if (focusMs.value === ms) return;
		focusMs.value = ms;
		monthMs.value = ms;
		props.onFocusChange?.(ms);
	}
	function step(delta: number): void {
		const v = view.value;
		const f = focusMs.value;
		setFocus(
			v === "day"
				? addZonedDays(f, delta, tz)
				: v === "week"
				? addZonedDays(f, delta * 7, tz)
				: addZonedMonths(f, delta, tz),
		);
	}
	function goToday(): void {
		setFocus(Date.now());
	}
	function miniPick(day: number): void {
		setFocus(day);
	}
	function toggleKind(k: CalendarEventKind): void {
		const s = new Set(hiddenKinds.value);
		s.has(k) ? s.delete(k) : s.add(k);
		hiddenKinds.value = s;
	}
	// #endregion

	// #region Derived
	const q = query.value.trim().toLowerCase();
	const hidden = hiddenKinds.value;
	const events: CalendarEvent[] = props.events.filter((e) => {
		if (hidden.has(e.kind)) return false;
		if (!q) return true;
		const hay = e.masked
			? `${e.status ?? ""} ${e.kind}`
			: `${e.title} ${e.meta ?? ""} ${e.location ?? ""}`;
		return hay.toLowerCase().includes(q);
	});

	const v = view.value;
	const days = v === "day"
		? [startOfDay(focusMs.value, tz)]
		: v === "week"
		? weekDays(focusMs.value, tz)
		: [];

	const periodLabel = v === "day"
		? fmtFullDate(focusMs.value, tz)
		: v === "week"
		? `${fmtDayLabel(days[0], tz)} – ${fmtDayLabel(days[6], tz)}`
		: fmtMonthYear(focusMs.value, tz);

	const presentKinds = Array.from(new Set(props.events.map((e) => e.kind)));
	// #endregion

	return (
		<div class={cx("cal", `cal--${v}`, props.class)}>
			{props.hideSidePanel ? null : (
				<aside class="cal__side" aria-label="Calendar navigation">
					<MiniMonth
						monthMs={monthMs.value}
						focusMs={focusMs.value}
						tz={tz}
						view={v}
						todayMs={todayMs.value}
						onPick={miniPick}
						onMonthStep={(d) => (monthMs.value = addZonedMonths(monthMs.value, d, tz))}
					/>
					{props.availability
						? (
							<AvailabilityPanel
								availability={props.availability}
								tz={tz}
								hour12={hour12}
								now={now}
								mounted={mounted}
							/>
						)
						: null}
				</aside>
			)}

			<div class="cal__main" ref={mainRef}>
				{props.hideHeader ? null : (
					<CalendarHeader
						title={props.title}
						periodLabel={periodLabel}
						view={v}
						query={query}
						actions={props.headerActions}
						filtersActive={filtersOpen.value || hidden.size > 0}
						onView={setView}
						onPrev={() => step(-1)}
						onNext={() => step(1)}
						onToday={goToday}
						onToggleFilters={presentKinds.length > 1
							? () => (filtersOpen.value = !filtersOpen.value)
							: undefined}
					/>
				)}

				{!props.hideHeader && filtersOpen.value
					? (
						<div class="cal__filters" role="group" aria-label="Filter by type">
							{presentKinds.map((k) => (
								<button
									key={k}
									type="button"
									class={cx(
										"cal__filterchip",
										!hidden.has(k) && "cal__filterchip--on",
										`cal__filterchip--${k}`,
									)}
									onClick={() => toggleKind(k)}
									aria-pressed={hidden.has(k) ? "false" : "true"}
								>
									<span class="cal__filterdot" aria-hidden="true" />
									{CALENDAR_KIND_LABEL[k]}
								</button>
							))}
						</div>
					)
					: null}

				<div class="cal__view">
					{v === "month"
						? (
							<MonthGrid
								focusMs={focusMs.value}
								tz={tz}
								hour12={hour12}
								events={events}
								availability={props.availability}
								todayMs={todayMs.value}
								canCreate={props.canCreate}
								renderSource={props.renderSource}
								onSelectRange={props.onSelectRange}
								onOpenEvent={props.onOpenEvent}
								onPage={step}
								onOpenDay={(d) => {
									setFocus(d);
									setView("day");
								}}
							/>
						)
						: v === "day"
						? (
							<DayTimeline
								tz={tz}
								hour12={hour12}
								events={events}
								availability={props.availability}
								pxPerHour={pph}
								now={now}
								mounted={mounted}
								todayMs={todayMs.value}
								focusMs={focusMs.value}
								canCreate={props.canCreate}
								renderSource={props.renderSource}
								onSelectRange={props.onSelectRange}
								onOpenEvent={props.onOpenEvent}
								onFocusDayChange={setFocus}
								unfolded={unfolded.value}
								onUnfold={toggleUnfold}
								highlightEventId={highlight.value}
								recede={highlight.value === null ? "none" : "focus"}
								popover={popover}
								onZoom={zoom}
								zoomRange={ZOOM_RANGE}
								registerZoom={(run) => {
									zoomRef.current = run;
								}}
							/>
						)
						: (
							<TimeGrid
								onFrame={props.onFrame}
								days={days}
								tz={tz}
								hour12={hour12}
								events={events}
								availability={props.availability}
								pxPerHour={pph}
								now={now}
								mounted={mounted}
								todayMs={todayMs.value}
								canCreate={props.canCreate}
								renderSource={props.renderSource}
								onSelectRange={props.onSelectRange}
								onOpenEvent={props.onOpenEvent}
								onMoveEvent={props.onMoveEvent}
								onFocusChange={setFocus}
								unfolded={unfolded.value}
								onUnfold={toggleUnfold}
								popover={popover}
								highlight={highlight}
								draft={draft}
								pointerGuard={pointerGuard}
								onZoom={zoom}
								zoomRange={ZOOM_RANGE}
								registerZoom={(run) => {
									zoomRef.current = run;
								}}
							/>
						)}
				</div>
			</div>

			{
				/*
				 * ONE popover layer for the whole engine, mounted beside the shell rather than inside a view.
				 *
				 * It portals to `document.body` regardless, so where it is written matters only for who owns
				 * it — and the owner has to outlive a view switch, because a zoom threshold can swap Week for
				 * Day underneath an open popover and a layer owned by the view would be torn down mid-read.
				 */
			}
			<EventPopoverLayer
				state={popover}
				tz={tz}
				hour12={hour12}
				renderEventActions={props.renderEventActions}
				onOpenEvent={props.onOpenEvent}
				onQuickCreate={quickCreate}
				onExpandCreate={props.onExpandCreate ? expandCreate : undefined}
				highlight={highlight}
				pointerGuard={pointerGuard}
				avoid={POPOVER_AVOID}
			/>
		</div>
	);
}
