/**
 * @projective/ui/calendar — the header controls (§Part 1.1): the period label + prev/next/today
 * navigation, the Day/Week/Month view switch (also reachable via Ctrl+wheel), a search box, a filter
 * toggle, and a consumer-owned action slot. Icon-first (§B.6): every icon control carries an
 * `aria-label` + `Tooltip`, never a native `title`.
 *
 * The header used to carry a fixed row of external-calendar STATUS chips (Google · Outlook · Apple ·
 * Samsung · Notion), painted from a hardcoded five-row fixture and wired to nothing: they could not
 * be pressed, they named providers the connector catalogue may not even offer, and they reported a
 * connection state no part of the product had ever asked the integrations service for. They are
 * replaced by {@link CalendarHeaderProps.actions} — a slot the consumer fills with real, actionable
 * controls, so the package carries no provider vocabulary at all.
 */
import type { ComponentChildren, JSX } from "preact";
import type { Signal } from "@preact/signals";
import { cx } from "../../core/cx.ts";
import { Tooltip } from "../../feedback/mod.ts";
import type { CalendarViewMode } from "../core/types.ts";
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

const VIEWS: {
	key: CalendarViewMode;
	label: string;
	icon: (p: { size?: number }) => JSX.Element;
}[] = [
	{ key: "day", label: "Day", icon: DayViewIcon },
	{ key: "week", label: "Week", icon: WeekViewIcon },
	{ key: "month", label: "Month", icon: MonthViewIcon },
];

export interface CalendarHeaderProps {
	title?: string;
	periodLabel: string;
	view: CalendarViewMode;
	query: Signal<string>;
	/** Consumer-owned controls, rendered between the filter toggle and the view switch. */
	actions?: ComponentChildren;
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
						<button
							type="button"
							class="cal-header__today"
							onClick={props.onToday}
							aria-label="Go to today"
						>
							<TodayIcon size={16} />
						</button>
					</Tooltip>
					<Tooltip content="Previous">
						<button
							type="button"
							class="cal-header__navbtn"
							onClick={props.onPrev}
							aria-label="Previous"
						>
							<ChevronLeftIcon size={18} />
						</button>
					</Tooltip>
					<Tooltip content="Next">
						<button
							type="button"
							class="cal-header__navbtn"
							onClick={props.onNext}
							aria-label="Next"
						>
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
								aria-pressed={props.filtersActive ? "true" : "false"}
							>
								<FilterIcon size={17} />
							</button>
						</Tooltip>
					)
					: null}

				{props.actions ? <div class="cal-header__actions">{props.actions}</div> : null}

				<div class="cal-header__views" role="group" aria-label="View">
					{VIEWS.map((v) => {
						const Icon = v.icon;
						return (
							<Tooltip key={v.key} content={`${v.label} view`}>
								<button
									type="button"
									class={cx("cal-header__view", props.view === v.key && "cal-header__view--on")}
									onClick={() => props.onView(v.key)}
									aria-pressed={props.view === v.key ? "true" : "false"}
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
