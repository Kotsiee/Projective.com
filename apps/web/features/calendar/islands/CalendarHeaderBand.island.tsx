import type { ComponentChildren, JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/calendar-chrome.css";
import type { CalendarViewMode } from "@projective/ui/calendar";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { TabStrip, useMediaQuery } from "@projective/ui/navigation";
import type { PresetListResult, SchedulePage } from "@projective/types/scheduling";
import { CalendarFilterFacets } from "../components/CalendarFilterFacets.tsx";
import { fallbackZone, pageValueOf } from "../components/AvailabilityPageParts.tsx";
import { type CalendarMode, calendarModeHref } from "../core/availability-view.ts";
import {
	AVAILABILITY_PANEL_ID,
	availabilityFocus,
	availabilityPresent,
	availabilityView,
	pageViewerOf,
	usePageScheduler,
} from "../core/availability-page.ts";
import {
	CONTEXT_PANEL_INFLOW_QUERY,
	contextDrawerOpen,
	contextPanelDocked,
	toggleContextPanel,
} from "@web/features/shell/core/context-panel-state.ts";
import {
	activeFilterCount,
	CALENDAR_PANEL_ID,
	calendarFocus,
	calendarPage,
	calendarPresent,
	calendarQuery,
	calendarView,
	filtersEngaged,
	focusedAt,
	importedEvents,
	periodLabelFor,
	resetFilters,
	setCalendarMode,
	shiftedFocus,
} from "../core/calendar-state.ts";

/**
 * CalendarHeaderBand — the middle-nav HEADER band on `/calendar`, ONE structure on both of its pages
 * (Decision #377): the period trail at the start, the page tabs centred, and the actions at the end,
 * the last two always Go to now and the panel toggle.
 *
 * Exactly `--shell-midnav-header-h` tall and transparent, per the band contract: the tonal surface is
 * the shell's own glass underlay and the seam beneath is the canvas frame's hairline, so painting a
 * plate or a second rule here doubles both.
 *
 * **Events ⇄ Availability are link tabs** (`TabStrip`, the header tone), centred between two equal
 * clusters like every middle-nav band: each is an address (`/calendar`, `/calendar?view=availability`),
 * so the server renders the chosen page's lane, body, panel and footer in the first byte.
 *
 * **The page's `<h1>` is visually hidden.** The band draws no title — the tabs name the page — but a
 * screen reader still lands on a heading, as on every bottom-nav primary.
 *
 * **The period trail lives here, not in the grid** — Previous · the period · Next, for the agenda's
 * grid or the availability scheduler's. Neither grid draws its own, because a shell band and an
 * in-body toolbar carrying the same Previous / Next would be two controls for one fact.
 *
 * **The end cluster.** The time zone the grid's times are in, as muted meta (it yields first, below
 * 1100px); then the page's own actions — the agenda's Timeline view, and below 767px the search and
 * the filter the lane carries above it (`middle-nav.css` removes the lane at that width, and the duty
 * must transfer); the scheduler's Undo and Redo; then Go to now, which moves the grid onto today and
 * centres its now-line; then the panel toggle — the month navigator on the agenda, the template's
 * settings and rules on Availability — from 1280px docked, a drawer below.
 */
export interface CalendarHeaderBandProps {
	/** Which of `/calendar`'s two pages this is. */
	mode: CalendarMode;
	/** The agenda's SSR page, so its period and filter options paint in the first byte. */
	initial: SchedulePage | null;
	/** The availability page's SSR presets read, for its zone and the template undo acts on. */
	presets?: PresetListResult | null;
	/** The template the availability address names. */
	presetSlug?: string | null;
	/** The viewer's `org.user_preferences.locale`, so the shared availability store is made alike. */
	locale?: string;
}

const MODE_TABS = [
	{
		key: "agenda",
		label: "Events",
		href: calendarModeHref("agenda"),
		icon: <Icon name="calendar" />,
	},
	{
		key: "availability",
		label: "Availability",
		href: calendarModeHref("availability"),
		icon: <Icon name="clock" />,
	},
] as const;

export default function CalendarHeaderBand(props: CalendarHeaderBandProps): JSX.Element {
	return props.mode === "availability"
		? (
			<AvailabilityBand
				presets={props.presets ?? null}
				presetSlug={props.presetSlug ?? null}
				locale={props.locale}
			/>
		)
		: <AgendaBand initial={props.initial} />;
}

// #region Frame
interface BandFrameProps {
	mode: CalendarMode;
	view: CalendarViewMode;
	focus: number;
	tz: string;
	onStep: (delta: number) => void;
	onNow: () => void;
	panelId: string;
	panelName: string;
	/** The page's own actions, before Go to now. */
	children?: ComponentChildren;
}

/** The structure both pages share; only the period's source and the page's own actions differ. */
function BandFrame(props: BandFrameProps): JSX.Element {
	const docked = useMediaQuery(CONTEXT_PANEL_INFLOW_QUERY);
	const panelOpen = docked ? contextPanelDocked.value : contextDrawerOpen.value;
	const period = periodLabelFor(props.view, props.focus, props.tz);

	return (
		<div class="cal-band">
			<h1 class="ui-visually-hidden">Calendar</h1>

			<div class="cal-band__start" role="group" aria-label="Change period">
				<Tooltip content="Previous" density="compact">
					<button
						type="button"
						class="cal-band__navbtn"
						aria-label="Previous period"
						onClick={() => props.onStep(-1)}
					>
						<Icon name="chevron-left" size="xs" />
					</button>
				</Tooltip>
				<span class="cal-band__period">{period}</span>
				<Tooltip content="Next" density="compact">
					<button
						type="button"
						class="cal-band__navbtn"
						aria-label="Next period"
						onClick={() => props.onStep(1)}
					>
						<Icon name="chevron-right" size="xs" />
					</button>
				</Tooltip>
			</div>

			<TabStrip
				tone="header"
				label="Calendar pages"
				items={MODE_TABS}
				activeKey={props.mode}
				class="cal-band__modes"
			/>

			<div class="cal-band__end">
				<span class="cal-band__tz">{props.tz.replace(/_/g, " ")}</span>
				{props.children}
				<Tooltip content="Go to now" density="compact">
					<button
						type="button"
						class="cal-band__iconbtn"
						aria-label="Go to now"
						onClick={props.onNow}
					>
						<Icon name="pin-clock" size="xs" />
					</button>
				</Tooltip>
				<Tooltip
					content={panelOpen ? `Hide ${props.panelName}` : `Show ${props.panelName}`}
					density="compact"
				>
					<button
						type="button"
						class="cal-band__iconbtn"
						data-on={panelOpen ? "true" : undefined}
						aria-label={props.panelName[0].toUpperCase() + props.panelName.slice(1)}
						aria-expanded={panelOpen}
						aria-controls={docked ? props.panelId : undefined}
						onClick={toggleContextPanel}
					>
						<Icon name="panel-right" size="xs" />
					</button>
				</Tooltip>
			</div>
		</div>
	);
}
// #endregion

// #region Events
function AgendaBand(props: { initial: SchedulePage | null }): JSX.Element {
	const filterOpen = useSignal(false);
	const filterRef = useRef<HTMLButtonElement>(null);
	const page = calendarPage.value ?? props.initial;
	const events = [...(page?.events ?? []), ...importedEvents.value];
	const tz = page?.timezone ?? "UTC";
	const view = calendarView.value;
	const timeline = view === "timeline";

	return (
		<BandFrame
			mode="agenda"
			view={view}
			// From the page's own clock, so the period is right in the FIRST byte rather than flipping on
			// hydration to a value the grid published.
			focus={focusedAt(page)}
			tz={tz}
			onStep={(delta) => (calendarFocus.value = shiftedFocus(view, focusedAt(page), delta, tz))}
			onNow={() => {
				calendarFocus.value = Date.now();
				calendarPresent.value += 1;
			}}
			panelId={CALENDAR_PANEL_ID}
			panelName="event and month panel"
		>
			<label class="cal-band__search">
				<Icon name="search" size="xs" class="cal-band__searchglyph" aria-hidden="true" />
				<input
					class="cal-band__searchinput"
					type="search"
					value={calendarQuery.value}
					placeholder="Search"
					aria-label="Search your calendar"
					onInput={(e) => (calendarQuery.value = (e.currentTarget as HTMLInputElement).value)}
				/>
			</label>
			<Tooltip content="Filter what is shown" density="compact">
				<button
					type="button"
					ref={filterRef}
					class="cal-band__iconbtn cal-band__iconbtn--mobile"
					data-on={filtersEngaged() ? "true" : undefined}
					aria-label="Filter what is shown"
					aria-haspopup="dialog"
					aria-expanded={filterOpen.value ? "true" : "false"}
				>
					<Icon name="filter" size="xs" />
				</button>
			</Tooltip>
			<Popover
				open={filterOpen}
				targetRef={filterRef}
				placement="bottom-end"
				avoid={[".ui-app-shell__sidebar"]}
			>
				<div class="ui-lane-filter">
					<header class="ui-lane-filter__head">
						<span class="ui-lane-filter__title">Filters</span>
						{activeFilterCount() > 0
							? (
								<button type="button" class="ui-lane-filter__reset" onClick={resetFilters}>
									Reset
								</button>
							)
							: null}
					</header>
					<CalendarFilterFacets events={events} tz={tz} invitationsAt={page?.now ?? Date.now()} />
				</div>
			</Popover>
			<Tooltip content="Timeline view" density="compact">
				<button
					type="button"
					class="cal-band__iconbtn"
					data-on={timeline ? "true" : undefined}
					aria-label="Timeline view"
					aria-pressed={timeline ? "true" : "false"}
					onClick={() => setCalendarMode(timeline ? "calendar" : "timeline")}
				>
					<Icon name="timeline-cascade" size="xs" />
				</button>
			</Tooltip>
		</BandFrame>
	);
}
// #endregion

// #region Availability
function AvailabilityBand(
	props: { presets: PresetListResult | null; presetSlug: string | null; locale?: string },
): JSX.Element {
	const store = usePageScheduler(
		pageValueOf(props.presets, props.presetSlug),
		pageViewerOf(props.locale),
	);
	const tz = fallbackZone(props.presets?.schedule ?? null);
	const view = availabilityView.value;
	const focus = availabilityFocus.value || Date.now();

	return (
		<BandFrame
			mode="availability"
			view={view}
			focus={focus}
			tz={tz}
			onStep={(delta) => (availabilityFocus.value = shiftedFocus(view, focus, delta, tz))}
			onNow={() => {
				availabilityFocus.value = Date.now();
				availabilityPresent.value += 1;
			}}
			panelId={AVAILABILITY_PANEL_ID}
			panelName="settings and rules"
		>
			<Tooltip content="Undo" density="compact">
				<button
					type="button"
					class="cal-band__iconbtn"
					aria-label="Undo"
					aria-keyshortcuts="Control+Z"
					disabled={!store.canUndo.value}
					onClick={store.undo}
				>
					<Icon name="rotate-ccw" size="xs" />
				</button>
			</Tooltip>
			<Tooltip content="Redo" density="compact">
				<button
					type="button"
					class="cal-band__iconbtn"
					aria-label="Redo"
					aria-keyshortcuts="Control+Shift+Z"
					disabled={!store.canRedo.value}
					onClick={store.redo}
				>
					<Icon name="rotate-cw" size="xs" />
				</button>
			</Tooltip>
		</BandFrame>
	);
}
// #endregion
