/**
 * @projective/ui/calendar — the header controls (§Part 1.1): the period label + prev/next/today
 * navigation, the Day/Week/Month view switch (also reachable via Ctrl+wheel), a search box, a filter
 * toggle, and privacy-safe external-integration indicators. Icon-first (§B.6): every icon control
 * carries an `aria-label` + `Tooltip`, never a native `title`.
 */
import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { Tooltip } from "../../feedback/mod.ts";
import type { CalendarIntegration, CalendarViewMode } from "../core/types.ts";
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	DayViewIcon,
	FilterIcon,
	MonthViewIcon,
	SearchIcon,
	TodayIcon,
	WeekViewIcon,
} from "./glyphs.tsx";

const VIEWS: { key: CalendarViewMode; label: string; icon: (p: { size?: number }) => JSX.Element }[] = [
	{ key: "day", label: "Day", icon: DayViewIcon },
	{ key: "week", label: "Week", icon: WeekViewIcon },
	{ key: "month", label: "Month", icon: MonthViewIcon },
];

export interface CalendarHeaderProps {
	title?: string;
	periodLabel: string;
	view: CalendarViewMode;
	query: Signal<string>;
	integrations?: CalendarIntegration[];
	filtersActive?: boolean;
	onView: (v: CalendarViewMode) => void;
	onPrev: () => void;
	onNext: () => void;
	onToday: () => void;
	onToggleFilters?: () => void;
}

export function CalendarHeader(props: CalendarHeaderProps): JSX.Element {
	return (
		<header class="cal-header">
			<div class="cal-header__lead">
				<div class="cal-header__nav" role="group" aria-label="Navigate">
					<Tooltip content="Today">
						<button type="button" class="cal-header__today" onClick={props.onToday} aria-label="Go to today">
							<TodayIcon size={16} />
						</button>
					</Tooltip>
					<Tooltip content="Previous">
						<button type="button" class="cal-header__navbtn" onClick={props.onPrev} aria-label="Previous">
							<ChevronLeftIcon size={18} />
						</button>
					</Tooltip>
					<Tooltip content="Next">
						<button type="button" class="cal-header__navbtn" onClick={props.onNext} aria-label="Next">
							<ChevronRightIcon size={18} />
						</button>
					</Tooltip>
				</div>
				<div class="cal-header__titles">
					<h2 class="cal-header__period">{props.periodLabel}</h2>
					{props.title ? <span class="cal-header__sub">{props.title}</span> : null}
				</div>
			</div>

			<div class="cal-header__trail">
				<label class="cal-header__search">
					<SearchIcon size={16} class="cal-header__search-icon" />
					<input
						type="search"
						class="cal-header__search-input"
						placeholder="Search events"
						value={props.query.value}
						onInput={(e) => (props.query.value = (e.currentTarget as HTMLInputElement).value)}
						aria-label="Search events"
					/>
				</label>

				{props.onToggleFilters
					? (
						<Tooltip content="Filter by type">
							<button
								type="button"
								class={cx("cal-header__iconbtn", props.filtersActive && "cal-header__iconbtn--on")}
								onClick={props.onToggleFilters}
								aria-label="Filter by type"
								aria-pressed={!!props.filtersActive}
							>
								<FilterIcon size={17} />
							</button>
						</Tooltip>
					)
					: null}

				{props.integrations?.length
					? (
						<div class="cal-header__integrations" role="group" aria-label="Connected calendars">
							{props.integrations.map((it) => (
								<Tooltip
									key={it.id}
									content={`${it.label}: ${it.connected ? "connected — shown as Busy/Available only" : "not connected"}`}
								>
									<span
										class={cx("cal-header__int", it.connected && "cal-header__int--on")}
										style={it.accent ? styleVars({ "--cal-int": `var(${it.accent})` }) : undefined}
										aria-label={`${it.label} ${it.connected ? "connected" : "not connected"}`}
									>
										<span class="cal-header__int-dot" aria-hidden="true" />
										<span class="cal-header__int-label">{it.label}</span>
									</span>
								</Tooltip>
							))}
						</div>
					)
					: null}

				<div class="cal-header__views" role="group" aria-label="View">
					{VIEWS.map((v) => {
						const Icon = v.icon;
						return (
							<Tooltip key={v.key} content={`${v.label} view`}>
								<button
									type="button"
									class={cx("cal-header__view", props.view === v.key && "cal-header__view--on")}
									onClick={() => props.onView(v.key)}
									aria-pressed={props.view === v.key}
									aria-label={`${v.label} view`}
								>
									<Icon size={16} />
									<span class="cal-header__view-label">{v.label}</span>
								</button>
							</Tooltip>
						);
					})}
				</div>
			</div>
		</header>
	);
}
