import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Icon } from "@projective/ui/icons";
import type { RailDay } from "@projective/types/scheduling";

/**
 * DateRail — the horizontal date strip at the top of the booking modal: a sticky month label, then a
 * scrolling run of circular day pills with the weekday beneath each.
 *
 * # ARIA
 *
 * It is a `radiogroup` of `radio`s with a roving tabindex, which is what a "pick exactly one day"
 * control actually is. That gives `ArrowLeft`/`ArrowRight` traversal by convention rather than by a
 * bespoke keymap, plus `Home`/`End`, and it means a screen reader announces "3 of 14" without the
 * component having to say so.
 *
 * **Unavailable days stay in the tab order.** They are `aria-disabled`, not `disabled`: a day the
 * provider does not work is information a buyer is entitled to reach, and removing it from traversal
 * makes the rail skip silently over gaps, which reads as the days not existing. They refuse selection;
 * they do not refuse attention.
 *
 * # The month label
 *
 * Derived from the leftmost visible day on scroll AND from the focused day on selection, initialised
 * from the first day in the window. Three sources for one label sounds like over-engineering and is
 * not: `scroll` alone leaves it stale in any environment that does not fire the event (a
 * non-compositing pane, a programmatic jump), and the focused day alone leaves it wrong when someone
 * scrolls without selecting. Whichever fires last is correct, and all three agree.
 *
 * # Paging
 *
 * Explicit Prev/Next controls, not scroll-position inference. The rail is infinite by paging, and a
 * page boundary that only triggers on a scroll event is a boundary that never triggers for a keyboard
 * user — who reaches the end of the window by arrowing, having never scrolled anything.
 */
export interface DateRailProps {
	days: readonly RailDay[];
	/** The selected day's key, or `null` before anything is chosen. */
	selected: string | null;
	onSelect: (key: string) => void;
	/** The zone day labels are formatted in — the viewer's own. */
	timezone: string;
	/** Page the window backwards. Absent when the window already starts at the notice floor. */
	onPrev?: () => void;
	/** Page the window forwards. Absent at the booking horizon. */
	onNext?: () => void;
	busy?: boolean;
}

export function DateRail(props: DateRailProps): JSX.Element {
	const { days, selected, onSelect, timezone, onPrev, onNext, busy } = props;
	const trackRef = useRef<HTMLDivElement>(null);
	const monthRef = useRef<HTMLSpanElement>(null);

	// The active day for roving tabindex: the selection, else the first day that can be chosen, else
	// the first day at all — so the rail is always enterable with one Tab even when nothing is open.
	const activeKey = selected ?? days.find((d) => d.openCount > 0)?.key ?? days[0]?.key ?? null;

	/**
	 * Keep the month label honest.
	 *
	 * Written directly to the DOM node rather than held in a signal because it changes on every scroll
	 * frame and a signal write would re-render fourteen day pills to change four characters.
	 */
	function syncMonth(): void {
		const track = trackRef.current;
		const label = monthRef.current;
		if (!track || !label || days.length === 0) return;
		const left = track.scrollLeft;
		let visible = days[0];
		for (const child of Array.from(track.children) as HTMLElement[]) {
			if (child.offsetLeft + child.offsetWidth > left + 1) {
				const key = child.dataset.day;
				visible = days.find((d) => d.key === key) ?? visible;
				break;
			}
		}
		label.textContent = monthLabel(visible, timezone);
	}

	useEffect(() => {
		syncMonth();
	}, [days, selected]);

	useEffect(() => {
		const track = trackRef.current;
		if (!track) return;
		const onScroll = () => syncMonth();
		track.addEventListener("scroll", onScroll, { passive: true });
		return () => track.removeEventListener("scroll", onScroll);
	}, [days]);

	/** Move focus (and selection) along the rail. Wraps at neither end — a rail pages, it does not loop. */
	function move(from: string, delta: number): void {
		const at = days.findIndex((d) => d.key === from);
		if (at < 0) return;
		const next = days[Math.min(days.length - 1, Math.max(0, at + delta))];
		if (!next) return;
		focusDay(next.key);
		if (next.openCount > 0) onSelect(next.key);
	}

	function focusDay(key: string): void {
		const track = trackRef.current;
		const el = track?.querySelector<HTMLElement>(`[data-day="${CSS.escape(key)}"]`);
		el?.focus();
		// `behavior: "auto"`, deliberately. A smooth scroll is animation-driven and does not run where
		// frames are not being composited, and ARRIVING at the day is the function of this control —
		// §B.5's rule that motion may decorate an outcome but never carry it.
		el?.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
	}

	function onKeyDown(e: KeyboardEvent, key: string): void {
		switch (e.key) {
			case "ArrowRight":
				e.preventDefault();
				move(key, 1);
				break;
			case "ArrowLeft":
				e.preventDefault();
				move(key, -1);
				break;
			case "Home":
				e.preventDefault();
				move(key, -days.length);
				break;
			case "End":
				e.preventDefault();
				move(key, days.length);
				break;
		}
	}

	return (
		<div class="sbk-rail">
			<div class="sbk-rail__month" aria-hidden="true">
				<span ref={monthRef} class="sbk-rail__monthtext">
					{days[0] ? monthLabel(days[0], timezone) : ""}
				</span>
			</div>

			<button
				type="button"
				class="sbk-rail__page"
				aria-label="Earlier dates"
				disabled={!onPrev || busy}
				onClick={() => onPrev?.()}
			>
				<Icon name="chevron-left" size="sm" aria-hidden />
			</button>

			<div
				ref={trackRef}
				class="sbk-rail__track"
				role="radiogroup"
				aria-label="Choose a date"
				aria-busy={busy ? "true" : undefined}
			>
				{days.map((day) => {
					const isSelected = day.key === selected;
					const closed = day.openCount === 0;
					return (
						<button
							key={day.key}
							type="button"
							role="radio"
							data-day={day.key}
							class="sbk-day"
							aria-checked={isSelected}
							aria-disabled={closed ? "true" : undefined}
							// Roving tabindex: one stop for the whole rail, arrows move within it.
							tabIndex={day.key === activeKey ? 0 : -1}
							data-selected={isSelected ? "true" : undefined}
							data-closed={closed ? "true" : undefined}
							data-today={day.isToday ? "true" : undefined}
							onClick={() => !closed && onSelect(day.key)}
							onKeyDown={(e) => onKeyDown(e as KeyboardEvent, day.key)}
						>
							<span class="sbk-day__num">{day.dayOfMonth}</span>
							<span class="sbk-day__dow">{weekdayLabel(day, timezone)}</span>
							{
								/*
							  The availability mark is `aria-hidden` because the accessible name below already
							  states it in words. A dot that had to be described would be a second channel
							  saying the same thing twice, and the two would eventually disagree.
							*/
							}
							<span class="sbk-day__mark" aria-hidden="true" />
							<span class="ui-visually-hidden">{daySummary(day, timezone)}</span>
						</button>
					);
				})}
			</div>

			<button
				type="button"
				class="sbk-rail__page"
				aria-label="Later dates"
				disabled={!onNext || busy}
				onClick={() => onNext?.()}
			>
				<Icon name="chevron-right" size="sm" aria-hidden />
			</button>
		</div>
	);
}

// #region Formatting
/**
 * Format a rail day in the viewer's zone.
 *
 * The component formats rather than the server, and that split is deliberate: the day BUCKET needs the
 * zone (a server decision) but its RENDERING needs the locale, which is a browser fact the server can
 * only guess at. `undefined` as the locale means "whatever this browser is set to", which is the whole
 * point.
 *
 * Each formatter builds from the day's own absolute `startsAt` in the grid's zone, so a day never
 * renders as the one either side of it however far apart the two calendars are.
 */
function fmt(day: RailDay, timezone: string, opts: Intl.DateTimeFormatOptions): string {
	try {
		return new Intl.DateTimeFormat(undefined, { timeZone: timezone, ...opts })
			.format(new Date(day.startsAt));
	} catch {
		// An unknown zone falls back to the runtime's own rather than throwing inside a render body,
		// which would remove the rail and everything under it (the Decision #75 lesson).
		return new Intl.DateTimeFormat(undefined, opts).format(new Date(day.startsAt));
	}
}

function monthLabel(day: RailDay, timezone: string): string {
	return fmt(day, timezone, { month: "long", year: "numeric" });
}

function weekdayLabel(day: RailDay, timezone: string): string {
	return fmt(day, timezone, { weekday: "short" });
}

/**
 * The day's full accessible name.
 *
 * It states the date AND the availability, because the visual pill states the date in a numeral and
 * the availability in a coloured mark — neither of which reaches a screen reader. "No times" is said
 * outright rather than implied by absence.
 */
function daySummary(day: RailDay, timezone: string): string {
	const date = fmt(day, timezone, { weekday: "long", day: "numeric", month: "long" });
	if (day.openCount === 0) {
		return day.totalCount === 0 ? `${date}, no times` : `${date}, fully booked`;
	}
	return `${date}, ${day.openCount} ${day.openCount === 1 ? "time" : "times"} available`;
}
// #endregion
