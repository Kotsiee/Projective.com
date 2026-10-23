/**
 * @projective/ui/calendar — the Month view: one continuous column of weeks.
 *
 * It scrolls VERTICALLY with no first or last row and shows `weeks` rows at a time (six by default,
 * up to ten zoomed out). Every scroll settles with a week at the top: a wheel notch, a fling or an
 * arrow key glides on the package spring and snaps to the nearest row boundary. The month the window
 * is about — the one with the most days on screen — is the FOCAL month: its days read normally,
 * every other day is muted, and it is reported through `onFocusChange` so a host's period label
 * follows the scroll.
 *
 * There is no scroll container. The position is a spring in ROWS written to one custom property on
 * the track, and rows are sized by the viewport through container units (`100cqb / weeks`), so the
 * first paint is correct with nothing measured and the server renders the framed month exactly as it
 * hydrates. Only the rows in view exist as controls; the overscan around them renders as inert
 * previews, which keeps off-screen buttons out of the tab order.
 *
 * Ctrl/Cmd + wheel zooms, anchored on the row under the cursor: it changes how many weeks are on
 * screen, and past the closest zoom it hands the day under the cursor to the engine, which opens
 * that week. An EMPTY cell creates: a click opens the composer on that day, all day; a drag across
 * days (on touch, a long press and then a drag) selects a range and opens the composer on it. A
 * focused day number creates on `C`.
 */
import type { JSX, VNode } from "preact";
import { effect, type Signal, useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useLayoutEffect, useMemo, useRef } from "preact/hooks";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { createSpring, SPRING_STANDARD } from "../../core/motion.ts";
import type { CalendarAvailability, CalendarEvent, CalendarRange } from "../core/types.ts";
import {
	addZonedDays,
	addZonedMonths,
	DAY,
	fmtFullDate,
	fmtMonthYear,
	fmtShortMonth,
	sameZonedDay,
	sameZonedMonth,
	startOfDay,
	startOfWeek,
	weekdayLabels,
	zonedDayNum,
} from "../core/time.ts";
import { centerRow, daysOfRow, frameRow, monthWindow, rowOfDay } from "../core/month-window.ts";
import type { EventPopoverState } from "./EventPopoverLayer.tsx";
import { EventBlock } from "./EventBlock.tsx";
import { TodayIcon } from "./glyphs.tsx";

// #region Constants
const FALLBACK_CHIPS = 3;
const FALLBACK_CHIP_H = 20;
const OVERSCAN = 2;
const DRAG_SLOP = 6;
const LONG_PRESS_MS = 450;
const WHEEL_LINE_PX = 16;
const WHEEL_IDLE_MS = 140;
const WHEEL_NOTCH_PX = 50;
const ZOOM_NOTCH_PX = 100;
const ZOOM_IDLE_MS = 320;
const ANCHOR_HOLD_MS = 700;
const FLING_MS = 220;
const VELOCITY_WINDOW_MS = 90;
const EDGE_PX = 28;
const EDGE_ROWS_PER_S = 8;
const CONTROL_SELECTOR = ".cal-event, button, a, input, select, textarea";
// #endregion

// #region Pure helpers
function occursOn(ev: CalendarEvent, dayStart: number): boolean {
	if (ev.end === ev.start) return ev.start >= dayStart && ev.start < dayStart + DAY;
	return ev.start < dayStart + DAY && ev.end > dayStart;
}

function wheelPx(deltaMode: number, value: number, pageH: number): number {
	if (deltaMode === 1) return value * WHEEL_LINE_PX;
	if (deltaMode === 2) return value * pageH;
	return value;
}

function dayOf(el: Element | null): number | null {
	const cell = el?.closest<HTMLElement>("[data-day]");
	const day = cell ? Number(cell.dataset.day) : NaN;
	return Number.isFinite(day) ? day : null;
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, n));
}
// #endregion

// #region One week
interface WeekRowProps {
	row: number;
	days: number[];
	tz: string;
	hour12: boolean;
	events: CalendarEvent[];
	availability?: CalendarAvailability;
	todayMs: number | null;
	/** The first day of the focal month; days of any other month are muted. */
	focal: number;
	capacity: number;
	interactive: boolean;
	canCreate?: boolean;
	/** Selected days, inclusive, as day-midnight epochs. */
	selected: { lo: number; hi: number } | null;
	renderSource?: (source: string) => VNode | null;
	onOpenEvent?: (event: CalendarEvent) => void;
	onOpenDay?: (dayStart: number) => void;
}

function WeekRow(props: WeekRowProps): JSX.Element {
	const { tz, hour12, todayMs, interactive, selected } = props;
	const chipIsButton = interactive && !!props.onOpenEvent;

	function isBlackout(dayStart: number): boolean {
		if (!props.availability) return false;
		const end = dayStart + DAY;
		return props.availability.blackouts.some((b) => b.start < end && b.end > dayStart);
	}

	return (
		<div
			class="cal-month__week"
			data-row={props.row}
			data-preview={interactive ? undefined : "true"}
			aria-hidden={interactive ? undefined : "true"}
			style={styleVars({ "--cal-month-row": String(props.row) })}
		>
			{props.days.map((d) => {
				const dayEvents = props.events
					.filter((e) => occursOn(e, d))
					.sort((a, b) => Number(!!b.allDay) - Number(!!a.allDay) || a.start - b.start);
				const outside = !sameZonedMonth(d, props.focal, tz);
				const today = todayMs != null && sameZonedDay(d, todayMs, tz);
				const picked = selected !== null && d >= selected.lo && d <= selected.hi;
				const num = zonedDayNum(d, tz);
				const label = num === 1 ? `${fmtShortMonth(d, tz)} ${num}` : String(num);
				const cap = dayEvents.length > props.capacity
					? Math.max(1, props.capacity - 1)
					: props.capacity;
				const shown = dayEvents.slice(0, cap);
				const overflow = dayEvents.length - shown.length;
				return (
					<div
						key={d}
						data-day={d}
						class={cx(
							"cal-month__cell",
							outside && "cal-month__cell--outside",
							today && "cal-month__cell--today",
							isBlackout(d) && "cal-month__cell--blackout",
							picked && "cal-month__cell--selected",
						)}
					>
						<div class="cal-month__cellhead">
							{interactive
								? (
									<button
										type="button"
										class={cx("cal-month__daynum", num === 1 && "cal-month__daynum--first")}
										onClick={() => props.onOpenDay?.(d)}
										aria-label={`Open ${fmtFullDate(d, tz)}`}
										aria-current={today ? "date" : undefined}
										aria-keyshortcuts={props.canCreate ? "C" : undefined}
									>
										{label}
									</button>
								)
								: (
									<span class={cx("cal-month__daynum", num === 1 && "cal-month__daynum--first")}>
										{label}
									</span>
								)}
						</div>
						<div class="cal-month__events" role={interactive ? "list" : undefined}>
							{shown.map((e) => (
								<div
									key={e.id}
									class={cx("cal-month__chip", e.end === e.start && "cal-month__chip--instant")}
									role={chipIsButton ? "listitem" : undefined}
								>
									<EventBlock
										event={e}
										tz={tz}
										hour12={hour12}
										compact
										renderSource={props.renderSource}
										onOpen={interactive ? props.onOpenEvent : undefined}
									/>
								</div>
							))}
							{overflow > 0
								? (
									<div class="cal-month__chip" role={interactive ? "listitem" : undefined}>
										{interactive
											? (
												<button
													type="button"
													class="cal-month__more"
													onClick={() => props.onOpenDay?.(d)}
												>
													+{overflow} more
												</button>
											)
											: <span class="cal-month__more">+{overflow} more</span>}
									</div>
								)
								: null}
						</div>
					</div>
				);
			})}
		</div>
	);
}
// #endregion

// #region Gestures
type Gesture =
	| {
		kind: "pending";
		id: number;
		touch: boolean;
		x0: number;
		y0: number;
		day: number | null;
		onControl: boolean;
		timer: ReturnType<typeof setTimeout> | undefined;
	}
	| {
		kind: "pan";
		id: number;
		y0: number;
		pos0: number;
		samples: { t: number; pos: number }[];
	}
	| {
		kind: "select";
		id: number;
		anchor: number;
		head: number;
		x: number;
		y: number;
	};

interface ZoomAnchor {
	/** Where the cursor sat in the viewport, 0 at the top and 1 at the bottom. */
	f: number;
	/** The fractional row under it. */
	row: number;
	until: number;
}
// #endregion

/** Props for {@link MonthGrid}. */
export interface MonthGridProps {
	focusMs: number;
	tz: string;
	hour12: boolean;
	events: CalendarEvent[];
	availability?: CalendarAvailability;
	/** Day-granular "today" (that day's midnight epoch), or null before mount. */
	todayMs: number | null;
	/** Week rows on screen: the Month view's own zoom, fractional while a slider is dragged. */
	weeks: number;
	canCreate?: boolean;
	/** Draw one of an event's sources (consumer-owned brand marks). */
	renderSource?: (source: string) => VNode | null;
	/** Told about every range a click or a drag selects, before the composer opens on it. */
	onSelectRange?: (range: CalendarRange) => void;
	onOpenEvent?: (event: CalendarEvent) => void;
	/** Open a specific day (the Day view) when its number is clicked. */
	onOpenDay?: (dayStart: number) => void;
	/** The window scrolled to show another stretch: a day inside the focal month, near the top. */
	onFocusChange?: (ms: number) => void;
	/** One Ctrl/Cmd + wheel notch, with the day under the cursor (`null` over no day). */
	onZoom?: (dir: "in" | "out", dayMs: number | null) => void;
	/** One-shot: centre this day's week rather than framing its month. Cleared once read. */
	center?: Signal<number | null>;
	/** The engine's popover layer — a click or a drag opens the create composer in it. */
	popover?: Signal<EventPopoverState | null>;
	/** The live draft, highlighted while its composer is open. */
	draft?: Signal<CalendarRange | null>;
}

export function MonthGrid(props: MonthGridProps): JSX.Element {
	const { tz, hour12, todayMs } = props;

	const viewportRef = useRef<HTMLDivElement>(null);
	const trackRef = useRef<HTMLDivElement>(null);
	const viewH = useRef(0);
	const capacity = useSignal(FALLBACK_CHIPS);
	const selection = useSignal<{ lo: number; hi: number } | null>(null);
	const focusedDay = useSignal<number | null>(null);

	const origin = useMemo(() => startOfWeek(props.focusMs, tz), []);
	const pos = useMemo(() => {
		const centred = props.center?.peek();
		const start = centred != null
			? centerRow(origin, centred, props.weeks, tz)
			: frameRow(origin, props.focusMs, tz);
		return createSpring(start, { config: SPRING_STANDARD, epsilon: 0.002 });
	}, []);
	const weeks = useMemo(
		() => createSpring(props.weeks, { config: SPRING_STANDARD, epsilon: 0.002 }),
		[],
	);
	useEffect(() => () => {
		pos.dispose();
		weeks.dispose();
	}, []);

	const top = useComputed(() => Math.floor(pos.value.value + 1e-6));
	const span = useComputed(() => Math.ceil(weeks.value.value - 1e-6));
	const restTop = useComputed(() => Math.round(pos.value.value));
	const restWeeks = useComputed(() => Math.max(1, Math.round(weeks.value.value)));
	const win = useComputed(() => monthWindow(origin, restTop.value, restWeeks.value, tz));

	const focusRef = useRef(props.focusMs);
	focusRef.current = props.focusMs;
	const reported = useRef(props.focusMs);

	// #region Painting the position
	useLayoutEffect(() =>
		effect(() => {
			trackRef.current?.style.setProperty("--cal-month-pos", String(pos.value.value));
		}), []);
	useLayoutEffect(() =>
		effect(() => {
			viewportRef.current?.style.setProperty("--cal-month-weeks", String(weeks.value.value));
		}), []);
	// #endregion

	// #region Measured chip capacity
	function measure(): void {
		const vp = viewportRef.current;
		if (!vp) return;
		viewH.current = vp.clientHeight;
		const box = vp.querySelector(".cal-month__week:not([data-preview]) .cal-month__events");
		if (!(box instanceof HTMLElement) || box.clientHeight <= 0) return;
		const chip = vp.querySelector(".cal-event");
		const chipH = chip instanceof HTMLElement && chip.offsetHeight > 0
			? chip.offsetHeight
			: FALLBACK_CHIP_H;
		const gap = parseFloat(getComputedStyle(box).rowGap) || 0;
		capacity.value = Math.max(1, Math.floor((box.clientHeight + gap) / (chipH + gap)));
	}

	useEffect(() => {
		const vp = viewportRef.current;
		if (!vp) return;
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(measure);
		ro.observe(vp);
		globalThis.addEventListener("resize", measure);
		return () => {
			ro.disconnect();
			globalThis.removeEventListener("resize", measure);
		};
	}, []);

	function rowPx(): number {
		const h = viewH.current || viewportRef.current?.clientHeight || 0;
		return h / Math.max(1, weeks.value.peek());
	}
	// #endregion

	// #region Zoom: weeks on screen, anchored
	const zoomAnchor = useRef<ZoomAnchor | null>(null);
	const activeAnchor = useRef<ZoomAnchor | null>(null);
	const zoomAcc = useRef<{ acc: number; timer: ReturnType<typeof setTimeout> | undefined }>({
		acc: 0,
		timer: undefined,
	});

	useEffect(() => {
		if (Math.abs(props.weeks - weeks.target.peek()) < 1e-6) return;
		const fresh = zoomAnchor.current && Date.now() <= zoomAnchor.current.until
			? zoomAnchor.current
			: null;
		activeAnchor.current = fresh ?? {
			f: 0.5,
			row: pos.value.peek() + 0.5 * weeks.value.peek(),
			until: 0,
		};
		weeks.set(props.weeks);
	}, [props.weeks]);

	useLayoutEffect(() =>
		effect(() => {
			const w = weeks.value.value;
			const a = activeAnchor.current;
			if (a) pos.jump(a.row - a.f * w);
		}), []);

	useEffect(() =>
		weeks.settled.subscribe((settled) => {
			if (!settled || !activeAnchor.current) return;
			activeAnchor.current = null;
			pos.set(Math.round(pos.value.peek()));
			measure();
		}), []);
	// #endregion

	// #region Focus in, focus out
	useEffect(() => {
		const ms = props.focusMs;
		if (ms === reported.current) return;
		reported.current = ms;
		if (!sameZonedMonth(ms, win.peek().focal, tz)) {
			pos.set(frameRow(origin, ms, tz));
			return;
		}
		const r = rowOfDay(origin, ms, tz);
		const t = restTop.peek();
		const n = restWeeks.peek();
		if (r < t || r >= t + n) pos.set(centerRow(origin, ms, n, tz));
	}, [props.focusMs]);

	useSignalEffect(() => {
		const w = win.value;
		const focus = focusRef.current;
		const r = rowOfDay(origin, focus, tz);
		const t = restTop.peek();
		const inView = r >= t && r < t + restWeeks.peek();
		if (inView && sameZonedMonth(focus, w.focal, tz)) return;
		if (w.anchor === reported.current) return;
		reported.current = w.anchor;
		props.onFocusChange?.(w.anchor);
	});

	useSignalEffect(() => {
		const ms = props.center?.value;
		if (ms == null || !props.center) return;
		props.center.value = null;
		pos.jump(centerRow(origin, ms, restWeeks.peek(), tz));
	});
	// #endregion

	// #region Creating
	const popoverWasOpen = useRef(false);
	useEffect(() => {
		const onDown = () => {
			popoverWasOpen.current = props.popover?.peek() != null;
		};
		document.addEventListener("pointerdown", onDown, true);
		return () => document.removeEventListener("pointerdown", onDown, true);
	}, []);

	function cellOf(day: number): HTMLElement | null {
		return viewportRef.current?.querySelector<HTMLElement>(
			`.cal-month__week:not([data-preview]) [data-day="${day}"]`,
		) ?? null;
	}

	function anchorOf(cell: HTMLElement | null) {
		const r = cell?.getBoundingClientRect();
		return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: 0, y: 0, w: 0, h: 0 };
	}

	function openCreate(a: number, b: number): void {
		const lo = startOfDay(Math.min(a, b), tz);
		const hi = startOfDay(Math.max(a, b), tz);
		const range: CalendarRange = { start: lo, end: addZonedDays(hi, 1, tz), allDay: true };
		selection.value = null;
		props.onSelectRange?.(range);
		if (props.draft) props.draft.value = range;
		if (props.popover) {
			props.popover.value = { kind: "create", range, anchor: anchorOf(cellOf(hi)) };
		}
	}

	useEffect(() =>
		pos.settled.subscribe((settled) => {
			const layer = props.popover;
			const cur = layer?.peek();
			const d = props.draft?.peek();
			if (!settled || !layer || !d || cur?.kind !== "create") return;
			const cell = cellOf(startOfDay(d.end - 1, tz));
			if (cell) layer.value = { ...cur, anchor: anchorOf(cell) };
		}), []);
	// #endregion

	// #region Pointer
	const gesture = useRef<Gesture | null>(null);
	const edgeRaf = useRef<number | null>(null);
	const edgeAt = useRef(-1);
	const swallowClick = useRef<ReturnType<typeof setTimeout> | null>(null);

	function swallowNextClick(): void {
		if (swallowClick.current !== null) clearTimeout(swallowClick.current);
		swallowClick.current = setTimeout(() => (swallowClick.current = null), 400);
	}

	function setGestureAttr(kind: string | null): void {
		const vp = viewportRef.current;
		if (!vp) return;
		if (kind) vp.setAttribute("data-gesture", kind);
		else vp.removeAttribute("data-gesture");
	}

	function dayAtPoint(x: number, y: number): number | null {
		const vp = viewportRef.current;
		const el = globalThis.document?.elementFromPoint(x, y) ?? null;
		if (!vp || !el || !vp.contains(el)) return null;
		return dayOf(el);
	}

	function startSelect(id: number, day: number, x: number, y: number): void {
		gesture.current = { kind: "select", id, anchor: day, head: day, x, y };
		selection.value = { lo: day, hi: day };
		setGestureAttr("select");
		startEdge();
	}

	function extendSelect(x: number, y: number): void {
		const g = gesture.current;
		if (!g || g.kind !== "select") return;
		g.x = x;
		g.y = y;
		const vp = viewportRef.current;
		const rect = vp?.getBoundingClientRect();
		const day = rect
			? dayAtPoint(clamp(x, rect.left + 1, rect.right - 1), clamp(y, rect.top + 1, rect.bottom - 1))
			: null;
		if (day === null || day === g.head) return;
		g.head = day;
		selection.value = { lo: Math.min(g.anchor, day), hi: Math.max(g.anchor, day) };
	}

	function edgeTick(now: number): void {
		const g = gesture.current;
		const vp = viewportRef.current;
		if (!g || g.kind !== "select" || !vp) {
			edgeRaf.current = null;
			edgeAt.current = -1;
			return;
		}
		if (edgeAt.current < 0) edgeAt.current = now;
		const dt = Math.min(48, now - edgeAt.current);
		edgeAt.current = now;
		const rect = vp.getBoundingClientRect();
		let depth = 0;
		if (g.y < rect.top + EDGE_PX) depth = -(rect.top + EDGE_PX - g.y) / EDGE_PX;
		else if (g.y > rect.bottom - EDGE_PX) depth = (g.y - (rect.bottom - EDGE_PX)) / EDGE_PX;
		if (depth !== 0) {
			pos.jump(pos.value.peek() + clamp(depth, -2, 2) * EDGE_ROWS_PER_S * (dt / 1000));
			extendSelect(g.x, g.y);
		}
		edgeRaf.current = globalThis.requestAnimationFrame?.(edgeTick) ?? null;
	}

	function startEdge(): void {
		if (edgeRaf.current != null) return;
		edgeAt.current = -1;
		edgeRaf.current = globalThis.requestAnimationFrame?.(edgeTick) ?? null;
	}

	function stopEdge(): void {
		if (edgeRaf.current != null) globalThis.cancelAnimationFrame?.(edgeRaf.current);
		edgeRaf.current = null;
		edgeAt.current = -1;
	}

	function fling(g: Extract<Gesture, { kind: "pan" }>): void {
		const now = performance.now();
		const recent = g.samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS);
		const first = recent[0];
		const last = recent[recent.length - 1];
		const v = first && last && last.t > first.t ? (last.pos - first.pos) / (last.t - first.t) : 0;
		const limit = Math.max(1, weeks.value.peek());
		pos.set(Math.round(pos.value.peek() + clamp(v * FLING_MS, -limit, limit)));
	}

	function endGesture(commit: boolean): void {
		const g = gesture.current;
		gesture.current = null;
		detach();
		stopEdge();
		setGestureAttr(null);
		if (!g) return;
		if (g.kind === "pending") {
			clearTimeout(g.timer);
			if (commit && !g.onControl && g.day !== null && props.canCreate) openCreate(g.day, g.day);
			return;
		}
		if (g.kind === "pan") {
			swallowNextClick();
			if (commit) fling(g);
			else pos.set(Math.round(pos.value.peek()));
			return;
		}
		pos.set(Math.round(pos.value.peek()));
		if (commit) openCreate(g.anchor, g.head);
		else selection.value = null;
	}

	function onMove(e: PointerEvent): void {
		const g = gesture.current;
		if (!g || e.pointerId !== g.id) return;
		if (g.kind === "pending") {
			const dist = Math.hypot(e.clientX - g.x0, e.clientY - g.y0);
			if (g.touch) {
				if (dist <= DRAG_SLOP) return;
				clearTimeout(g.timer);
				pos.stop();
				gesture.current = {
					kind: "pan",
					id: g.id,
					y0: g.y0,
					pos0: pos.value.peek(),
					samples: [{ t: performance.now(), pos: pos.value.peek() }],
				};
				setGestureAttr("pan");
			} else {
				const here = dayAtPoint(e.clientX, e.clientY);
				if (dist <= DRAG_SLOP && (here === null || here === g.day)) return;
				if (g.onControl || g.day === null || !props.canCreate) {
					gesture.current = null;
					detach();
					return;
				}
				startSelect(g.id, g.day, e.clientX, e.clientY);
				extendSelect(e.clientX, e.clientY);
				return;
			}
		}
		const cur = gesture.current;
		if (!cur) return;
		if (cur.kind === "pan") {
			const px = rowPx();
			if (px <= 0) return;
			const next = cur.pos0 - (e.clientY - cur.y0) / px;
			pos.jump(next);
			cur.samples.push({ t: performance.now(), pos: next });
			if (cur.samples.length > 12) cur.samples.shift();
			return;
		}
		if (cur.kind === "select") {
			e.preventDefault();
			extendSelect(e.clientX, e.clientY);
		}
	}

	function onUp(e: PointerEvent): void {
		const g = gesture.current;
		if (!g || e.pointerId !== g.id) return;
		endGesture(true);
	}

	function onCancel(e: PointerEvent): void {
		const g = gesture.current;
		if (!g || e.pointerId !== g.id) return;
		endGesture(false);
	}

	function attach(): void {
		globalThis.addEventListener("pointermove", onMove, { passive: false });
		globalThis.addEventListener("pointerup", onUp);
		globalThis.addEventListener("pointercancel", onCancel);
	}

	function detach(): void {
		globalThis.removeEventListener("pointermove", onMove);
		globalThis.removeEventListener("pointerup", onUp);
		globalThis.removeEventListener("pointercancel", onCancel);
	}

	useEffect(() => () => {
		detach();
		stopEdge();
	}, []);

	function onPointerDown(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (gesture.current) return;
		const touch = e.pointerType === "touch";
		if (!touch && e.button !== 0) return;
		if (popoverWasOpen.current) return;
		const el = e.target as Element;
		const onControl = !!el.closest(CONTROL_SELECTOR);
		const day = dayOf(el);
		if (!touch && (onControl || day === null || !props.canCreate)) return;
		if (!touch) e.preventDefault();
		const id = e.pointerId;
		const g: Gesture = {
			kind: "pending",
			id,
			touch,
			x0: e.clientX,
			y0: e.clientY,
			day,
			onControl,
			timer: undefined,
		};
		if (touch && !onControl && day !== null && props.canCreate) {
			g.timer = setTimeout(() => {
				const cur = gesture.current;
				if (cur?.kind === "pending" && cur.id === id) startSelect(id, day, cur.x0, cur.y0);
			}, LONG_PRESS_MS);
		}
		gesture.current = g;
		attach();
	}
	// #endregion

	// #region Wheel
	const wheel = useRef<{
		active: boolean;
		target: number;
		timer: ReturnType<typeof setTimeout> | undefined;
	}>({ active: false, target: 0, timer: undefined });

	useEffect(() => {
		const vp = viewportRef.current;
		if (!vp) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const pageH = viewH.current || vp.clientHeight;
			if (e.ctrlKey || e.metaKey) {
				e.stopPropagation();
				const rect = vp.getBoundingClientRect();
				const f = clamp((e.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
				zoomAnchor.current = {
					f,
					row: pos.value.peek() + f * weeks.value.peek(),
					until: Date.now() + ANCHOR_HOLD_MS,
				};
				const z = zoomAcc.current;
				z.acc += -wheelPx(e.deltaMode, e.deltaY, pageH) / ZOOM_NOTCH_PX;
				const day = dayOf(e.target as Element);
				while (z.acc >= 1) {
					z.acc -= 1;
					props.onZoom?.("in", day);
				}
				while (z.acc <= -1) {
					z.acc += 1;
					props.onZoom?.("out", day);
				}
				clearTimeout(z.timer);
				z.timer = setTimeout(() => (z.acc = 0), ZOOM_IDLE_MS);
				return;
			}
			const px = rowPx();
			if (px <= 0) return;
			const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
			if (raw === 0) return;
			const dy = wheelPx(e.deltaMode, raw, pageH);
			const w = wheel.current;
			if (!w.active) {
				w.active = true;
				w.target = pos.target.peek();
			}
			const notch = e.deltaMode === 1 || (Math.abs(dy) >= WHEEL_NOTCH_PX && Number.isInteger(raw));
			w.target = notch
				? Math.round(w.target) + Math.sign(dy) * Math.max(1, Math.round(Math.abs(dy) / px))
				: w.target + dy / px;
			pos.set(w.target);
			clearTimeout(w.timer);
			w.timer = setTimeout(() => {
				w.active = false;
				pos.set(Math.round(w.target));
			}, WHEEL_IDLE_MS);
		};
		vp.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			vp.removeEventListener("wheel", onWheel);
			clearTimeout(wheel.current.timer);
			clearTimeout(zoomAcc.current.timer);
		};
	}, []);
	// #endregion

	// #region Keyboard
	function goToMonth(ms: number): void {
		pos.set(frameRow(origin, ms, tz));
	}

	function onKeyDown(e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
		const vp = viewportRef.current;
		const target = e.target as HTMLElement;
		const mods = e.ctrlKey || e.metaKey || e.altKey;
		if (
			(e.key === "c" || e.key === "C") && !mods && props.canCreate &&
			target.classList.contains("cal-month__daynum")
		) {
			const day = dayOf(target);
			if (day !== null) {
				e.preventDefault();
				openCreate(day, day);
			}
			return;
		}
		if (e.key === "PageUp" || e.key === "PageDown") {
			e.preventDefault();
			if (target !== vp) vp?.focus({ preventScroll: true });
			goToMonth(addZonedMonths(win.peek().focal, e.key === "PageDown" ? 1 : -1, tz));
			return;
		}
		if (target !== vp || mods) return;
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			pos.set(Math.round(pos.target.peek()) + (e.key === "ArrowDown" ? 1 : -1));
		} else if (e.key === "Home" && todayMs != null) {
			e.preventDefault();
			goToMonth(todayMs);
		}
	}
	// #endregion

	// #region Render
	const t = top.value;
	const rt = restTop.value;
	const rw = restWeeks.value;
	const focal = win.value.focal;
	const kept = focusedDay.value === null ? null : rowOfDay(origin, focusedDay.value, tz);
	const rows: number[] = [];
	for (let r = t - OVERSCAN; r <= t + span.value + OVERSCAN; r++) rows.push(r);
	if (kept !== null && !rows.includes(kept)) rows.push(kept);

	const draft = props.draft?.value;
	const selected = selection.value ??
		(draft && draft.allDay
			? {
				lo: startOfDay(draft.start, tz),
				hi: startOfDay(Math.max(draft.start, draft.end - 1), tz),
			}
			: null);

	const todayRow = todayMs == null ? null : rowOfDay(origin, todayMs, tz);
	const awayFromToday = todayRow !== null && (todayRow < rt || todayRow >= rt + rw);

	return (
		<div class="cal-month">
			<div class="cal-month__weekdays">
				{weekdayLabels().map((w) => <div key={w} class="cal-month__weekday">{w}</div>)}
			</div>
			<div
				ref={viewportRef}
				class="cal-month__viewport"
				role="group"
				aria-label="Month grid — the arrow keys move a week, Page Up and Page Down change month"
				tabIndex={0}
				style={styleVars({ "--cal-month-weeks": String(weeks.value.peek()) })}
				onKeyDown={onKeyDown}
				onPointerDown={onPointerDown}
				onContextMenu={(e) => {
					if (gesture.current) e.preventDefault();
				}}
				onClickCapture={(e) => {
					if (swallowClick.current === null) return;
					clearTimeout(swallowClick.current);
					swallowClick.current = null;
					e.preventDefault();
					e.stopPropagation();
				}}
				onFocusIn={(e) => {
					const day = dayOf(e.target as Element);
					focusedDay.value = (e.target as Element).classList.contains("cal-month__viewport")
						? null
						: day;
				}}
				onFocusOut={(e) => {
					const next = e.relatedTarget as Node | null;
					if (!next || !viewportRef.current?.contains(next)) focusedDay.value = null;
				}}
			>
				<div
					ref={trackRef}
					class="cal-month__track"
					style={styleVars({ "--cal-month-pos": String(pos.value.peek()) })}
				>
					{rows.map((r) => (
						<WeekRow
							key={r}
							row={r}
							days={daysOfRow(origin, r, tz)}
							tz={tz}
							hour12={hour12}
							events={props.events}
							availability={props.availability}
							todayMs={todayMs}
							focal={focal}
							capacity={capacity.value}
							interactive={(r >= rt && r < rt + rw) || r === kept}
							canCreate={props.canCreate}
							selected={selected}
							renderSource={props.renderSource}
							onOpenEvent={props.onOpenEvent}
							onOpenDay={props.onOpenDay}
						/>
					))}
				</div>

				{awayFromToday && todayMs != null
					? (
						<button
							type="button"
							class="cal-month__present"
							onClick={() => goToMonth(todayMs)}
						>
							<TodayIcon size={15} />
							<span>Now</span>
						</button>
					)
					: null}

				<span class="ui-visually-hidden" aria-live="polite">{fmtMonthYear(focal, tz)}</span>
			</div>
		</div>
	);
	// #endregion
}
