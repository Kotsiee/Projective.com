import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { ChevronLeftIcon, ChevronRightIcon } from "./session-glyphs.tsx";

/**
 * SessionMiniCalendar — a compact, interactive mini-month for the 1-1 session sidebar (task §3.A). It
 * reclaims the empty stage-tree real estate with an at-a-glance month map that highlights the next
 * booked session day, marks today, lets the viewer page months, and jumps to the full project calendar
 * on a day click.
 *
 * It is **bespoke** rather than the `@projective/ui/calendar` `MiniMonth`: that primitive's `.cal-mini`
 * CSS ships only through the calendar *island's* stylesheet import, so reusing the component alone would
 * either drag the whole calendar stylesheet into this bundle or reach across a workspace boundary for a
 * CSS file (root CLAUDE.md §2). A ~40-line token-only grid keeps the projects sidebar self-contained.
 *
 * Determinism: the month grid is computed in **UTC** from `nowMs`, which the island seeds with a fixed
 * reference for SSR + first paint, then swaps to the real clock after mount — so SSR and hydration
 * render identically (no mismatch) and the today marker only appears once `mounted` is true.
 */

// #region Pure date helpers (UTC — SSR/hydration stable)
const DAY_MS = 86_400_000;
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const MONTH_LABELS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
] as const;

/** The UTC midnight day-key for an instant — the comparable identity of a calendar day. */
function dayKey(ms: number): number {
	const d = new Date(ms);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

interface DayCell {
	/** UTC midnight day-key of the cell. */
	key: number;
	/** Day-of-month number shown in the cell. */
	num: number;
	/** Whether the cell spills over from the adjacent month (dimmed). */
	outside: boolean;
}

/** The 6×7 (42-cell) grid for a month, padded to whole weeks starting Sunday. */
function monthGrid(year: number, month: number): DayCell[] {
	const firstOfMonth = Date.UTC(year, month, 1);
	const leadWeekday = new Date(firstOfMonth).getUTCDay(); // 0 = Sunday
	const gridStart = firstOfMonth - leadWeekday * DAY_MS;
	const cells: DayCell[] = [];
	for (let i = 0; i < 42; i++) {
		const ms = gridStart + i * DAY_MS;
		const d = new Date(ms);
		cells.push({ key: ms, num: d.getUTCDate(), outside: d.getUTCMonth() !== month });
	}
	return cells;
}
// #endregion

export interface SessionMiniCalendarProps {
	/** The current instant (SSR reference before mount, real clock after) — anchors the default month. */
	nowMs: number;
	/** The next booked session's day (a UTC day-key), highlighted in the grid. */
	sessionDayMs: number;
	/** Whether the island has mounted — gates the today marker so SSR stays deterministic. */
	mounted: boolean;
	/** Jump to the full project calendar for the picked day. */
	onPickDay: (dayMs: number) => void;
}

export function SessionMiniCalendar(
	{ nowMs, sessionDayMs, mounted, onPickDay }: SessionMiniCalendarProps,
): JSX.Element {
	// Months paged relative to the month containing `nowMs`. Hover row index drives the week tint.
	const monthOffset = useSignal<number>(0);
	const hoverIdx = useSignal<number | null>(null);

	const base = new Date(nowMs);
	const cursorFirst = new Date(
		Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + monthOffset.value, 1),
	);
	const year = cursorFirst.getUTCFullYear();
	const month = cursorFirst.getUTCMonth();
	const cells = monthGrid(year, month);

	const todayKey = dayKey(nowMs);
	const sessionKey = dayKey(sessionDayMs);

	return (
		<div class="sess-cal" role="group" aria-label="Session calendar">
			<div class="sess-cal__head">
				<span class="sess-cal__title">{MONTH_LABELS[month]} {year}</span>
				<div class="sess-cal__nav">
					<button
						type="button"
						class="sess-cal__navbtn"
						aria-label="Previous month"
						onClick={() => (monthOffset.value -= 1)}
					>
						{ChevronLeftIcon}
					</button>
					<button
						type="button"
						class="sess-cal__navbtn"
						aria-label="Next month"
						onClick={() => (monthOffset.value += 1)}
					>
						{ChevronRightIcon}
					</button>
				</div>
			</div>

			<div class="sess-cal__weekdays" aria-hidden="true">
				{WEEKDAY_LABELS.map((w, i) => <span key={i} class="sess-cal__wd">{w}</span>)}
			</div>

			<div class="sess-cal__grid" onPointerLeave={() => (hoverIdx.value = null)}>
				{cells.map((cell, i) => {
					const row = Math.floor(i / 7);
					const hoveredRow = hoverIdx.value != null && Math.floor(hoverIdx.value / 7) === row;
					const isToday = mounted && cell.key === todayKey;
					const isSession = cell.key === sessionKey;
					return (
						<button
							key={cell.key}
							type="button"
							class="sess-cal__day"
							data-outside={cell.outside ? "true" : undefined}
							data-today={isToday ? "true" : undefined}
							data-session={isSession ? "true" : undefined}
							data-weekhover={hoveredRow ? "true" : undefined}
							aria-current={isToday ? "date" : undefined}
							aria-label={isSession ? `Session day, ${cell.num}` : `${cell.num}`}
							onPointerEnter={() => (hoverIdx.value = i)}
							onClick={() => onPickDay(cell.key)}
						>
							{cell.num}
						</button>
					);
				})}
			</div>
		</div>
	);
}
