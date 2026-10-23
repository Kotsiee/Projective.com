/**
 * @projective/ui/calendar — the header controls (§Part 1.1): the period label + prev/next/today
 * navigation, the view control ({@link CalendarZoom}: one zoom slider across Month · Week · Day, the
 * same continuum Ctrl+wheel moves along, and the timeline toggle), a search box, a filter toggle,
 * and a consumer-owned action slot. Icon-first (§B.6): every icon control carries an
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
import type { ReadonlySignal, Signal } from "@preact/signals";
import { cx } from "../../core/cx.ts";
import { Tooltip } from "../../feedback/mod.ts";
import type { CalendarZoomMode } from "../core/zoom.ts";
import { CalendarZoom } from "./CalendarZoom.tsx";
import { ChevronLeftIcon, ChevronRightIcon, FilterIcon, SearchIcon, TodayIcon } from "./glyphs.tsx";

/** The header's view control: which axis the slider drives, and where on it the engine is. */
export interface CalendarHeaderZoom {
	mode: CalendarZoomMode;
	position: ReadonlySignal<number>;
	onPosition: (u: number) => void;
	onMode: (mode: CalendarZoomMode) => void;
}

export interface CalendarHeaderProps {
	title?: string;
	periodLabel: string;
	query: Signal<string>;
	/** Consumer-owned controls, rendered between the filter toggle and the view control. */
	actions?: ComponentChildren;
	filtersActive?: boolean;
	/** The view control — the zoom slider across Month · Week · Day, and the timeline toggle. */
	zoom: CalendarHeaderZoom;
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

				<CalendarZoom
					class="cal-header__zoom"
					mode={props.zoom.mode}
					value={props.zoom.position.value}
					onValueChange={props.zoom.onPosition}
					onModeChange={props.zoom.onMode}
				/>
			</div>
		</header>
	);
}
