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
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/calendar.css";
import { cx } from "../../core/cx.ts";
import type {
	CalendarEvent,
	CalendarEventKind,
	CalendarProps,
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
import { useNowTick } from "../hooks/useNowTick.ts";
import { MiniMonth } from "../components/MiniMonth.tsx";
import { AvailabilityPanel } from "../components/AvailabilityPanel.tsx";
import { CalendarHeader } from "../components/CalendarHeader.tsx";
import { TimeGrid } from "../components/TimeGrid.tsx";
import { DayTimeline } from "../components/DayTimeline.tsx";
import { MonthGrid } from "../components/MonthGrid.tsx";

const DEFAULT_PPH = 48;
const MIN_PPH = 26;
const MAX_PPH = 168;

const KIND_LABEL: Record<CalendarEventKind, string> = {
	deadline: "Deadlines",
	milestone: "Milestones",
	sync: "Syncs",
	session: "Sessions",
	booking: "Bookings",
	availability: "Available",
	busy: "Busy",
	holiday: "Time off",
	general: "Other",
};

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

	const { now, mounted } = useNowTick(30_000, props.focus ?? 0);
	const mainRef = useRef<HTMLDivElement>(null);

	// #region Persistence (optional)
	useEffect(() => {
		if (!props.storageKey || typeof localStorage === "undefined") return;
		try {
			const v = localStorage.getItem(`${props.storageKey}:view`);
			const z = localStorage.getItem(`${props.storageKey}:zoom`);
			if (v === "day" || v === "week" || v === "month") view.value = v;
			if (z) pph.value = Math.max(MIN_PPH, Math.min(MAX_PPH, Number(z)));
		} catch { /* storage unavailable */ }
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	useEffect(() => {
		if (!props.storageKey || typeof localStorage === "undefined") return;
		try {
			localStorage.setItem(`${props.storageKey}:view`, view.value);
			localStorage.setItem(`${props.storageKey}:zoom`, String(Math.round(pph.value)));
		} catch { /* no-op */ }
	}, [view.value, pph.value, props.storageKey]);
	// #endregion

	// #region Ctrl+wheel zoom / mode continuum (preventDefault → no browser page-zoom)
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

	function zoom(dir: "in" | "out"): void {
		const v = view.value;
		if (dir === "in") {
			if (v === "month") {
				view.value = "week";
				pph.value = MIN_PPH;
			} else if (v === "week") {
				if (pph.value >= MAX_PPH - 1) {
					view.value = "day";
					pph.value = MIN_PPH;
				} else pph.value = Math.min(MAX_PPH, pph.value * 1.12);
			} else pph.value = Math.min(MAX_PPH, pph.value * 1.12);
		} else {
			if (v === "day") {
				if (pph.value <= MIN_PPH + 1) {
					view.value = "week";
					pph.value = MAX_PPH;
				} else pph.value = Math.max(MIN_PPH, pph.value / 1.12);
			} else if (v === "week") {
				if (pph.value <= MIN_PPH + 1) view.value = "month";
				else pph.value = Math.max(MIN_PPH, pph.value / 1.12);
			}
		}
	}
	// #endregion

	// #region Navigation
	function setView(v: CalendarViewMode): void {
		view.value = v;
		pph.value = DEFAULT_PPH;
		props.onViewChange?.(v);
	}
	function step(delta: number): void {
		const v = view.value;
		const f = focusMs.value;
		const nf = v === "day"
			? addZonedDays(f, delta, tz)
			: v === "week"
			? addZonedDays(f, delta * 7, tz)
			: addZonedMonths(f, delta, tz);
		focusMs.value = nf;
		monthMs.value = nf;
	}
	function goToday(): void {
		const t = Date.now();
		focusMs.value = t;
		monthMs.value = t;
	}
	function miniPick(day: number): void {
		focusMs.value = day;
		monthMs.value = day;
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
			{props.hideSidePanel
				? null
				: (
					<aside class="cal__side" aria-label="Calendar navigation">
						<MiniMonth
							monthMs={monthMs.value}
							focusMs={focusMs.value}
							tz={tz}
							view={v}
							nowMs={now.value}
							mounted={mounted.value}
							onPick={miniPick}
							onMonthStep={(d) => (monthMs.value = addZonedMonths(monthMs.value, d, tz))}
						/>
						{props.availability
							? (
								<AvailabilityPanel
									availability={props.availability}
									tz={tz}
									hour12={hour12}
									nowMs={now.value}
									mounted={mounted.value}
								/>
							)
							: null}
					</aside>
				)}

			<div class="cal__main" ref={mainRef}>
				<CalendarHeader
					title={props.title}
					periodLabel={periodLabel}
					view={v}
					query={query}
					integrations={props.integrations}
					filtersActive={filtersOpen.value || hidden.size > 0}
					onView={setView}
					onPrev={() => step(-1)}
					onNext={() => step(1)}
					onToday={goToday}
					onToggleFilters={presentKinds.length > 1 ? () => (filtersOpen.value = !filtersOpen.value) : undefined}
				/>

				{filtersOpen.value
					? (
						<div class="cal__filters" role="group" aria-label="Filter by type">
							{presentKinds.map((k) => (
								<button
									key={k}
									type="button"
									class={cx("cal__filterchip", !hidden.has(k) && "cal__filterchip--on", `cal__filterchip--${k}`)}
									onClick={() => toggleKind(k)}
									aria-pressed={!hidden.has(k)}
								>
									<span class="cal__filterdot" aria-hidden="true" />
									{KIND_LABEL[k]}
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
								nowMs={now.value}
								mounted={mounted.value}
								canCreate={props.canCreate}
								onSelectRange={props.onSelectRange}
								onOpenEvent={props.onOpenEvent}
								onOpenDay={(d) => {
									focusMs.value = d;
									monthMs.value = d;
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
								nowMs={now.value}
								focusMs={focusMs.value}
								mounted={mounted.value}
								canCreate={props.canCreate}
								onSelectRange={props.onSelectRange}
								onOpenEvent={props.onOpenEvent}
								onFocusDayChange={(d) => {
									focusMs.value = d;
									monthMs.value = d;
								}}
							/>
						)
						: (
							<TimeGrid
								days={days}
								tz={tz}
								hour12={hour12}
								events={events}
								availability={props.availability}
								pxPerHour={pph}
								nowMs={now.value}
								mounted={mounted.value}
								canCreate={props.canCreate}
								onSelectRange={props.onSelectRange}
								onOpenEvent={props.onOpenEvent}
							/>
						)}
				</div>
			</div>
		</div>
	);
}
