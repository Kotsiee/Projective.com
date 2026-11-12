import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import {
	LaneBar,
	LaneFilterPopover,
	type LaneToggleOption,
	LaneToggleRow,
	NavItem,
} from "@projective/ui/navigation";
import { LaneSearchField } from "@features/shortcuts/components/LaneSearchField.tsx";
import { Icon, type IconName } from "@projective/ui/icons";
import {
	type CalendarEvent,
	ENTRY_CLASS_PLURAL,
	type EntryClass,
} from "@projective/types/scheduling";
import { CalendarFilterFacets } from "./CalendarFilterFacets.tsx";
import { withInvitationsFilter } from "../core/event-deep-link.ts";
import {
	activeFilterCount,
	calendarQuery,
	classesOnPage,
	hiddenClassesAt,
	resetFilters,
	setInvitationsOnly,
	showOnlyClass,
	soleVisibleClass,
} from "../core/calendar-state.ts";
import type { CalendarAddress } from "../core/calendar-address.ts";

/** The registry glyph each class is drawn with in the quick row. */
const CLASS_ICON: Record<EntryClass, IconName> = { event: "calendar", reminder: "flag" };

/** Props for {@link AgendaFilters}. */
export interface AgendaFiltersProps {
	/** Every entry on the page, the session's own included. */
	events: readonly CalendarEvent[];
	tz: string;
	/** Whether Invitations Only is on. */
	invitationsOn: boolean;
	/** How many invitations are waiting on the reader. */
	invitations: number;
	/** The page the Invitations row narrows, for its address. */
	path: string;
	/** The search field's placeholder and name (default "Search your calendar"). */
	searchLabel?: string;
	/** What the URL asks to be shown (Decision #413), so `?kind=` presses its row in the first byte. */
	address?: CalendarAddress;
}

/**
 * AgendaFilters — what narrows an agenda list and the grid beside it: Search with the shared
 * {@link LaneFilterPopover} over {@link CalendarFilterFacets} (the `/projects` anatomy), the Event type
 * quick row, and Invitations with the count waiting on the reader (`?filter=invitations`). Drawn in
 * the `/calendar` lane's head and at the top of a team's or business's Events tab, so the two read
 * as one control set.
 *
 * The quick row offers only the classes actually ON the page, so it never presents a filter that
 * would empty the list — and it is SINGLE-select, because the shared lane chrome names every toggle
 * "Show {label} only" and a control has to mean what its accessible name says. It writes the same
 * `hiddenClasses` deny list the filter's facet reads, so the two are one axis with two entry points.
 * Invitations is drawn only while there is something to narrow to, or the narrowing is on and has to
 * be turned off.
 */
export function AgendaFilters(props: AgendaFiltersProps): JSX.Element {
	const filterOpen = useSignal(false);
	const present = classesOnPage(props.events);
	const classToggles: readonly LaneToggleOption<EntryClass>[] = present.map((entry) => ({
		key: entry,
		label: ENTRY_CLASS_PLURAL[entry],
		icon: <Icon name={CLASS_ICON[entry]} />,
	}));
	const solo = soleVisibleClass(present, hiddenClassesAt(props.address));
	const { invitationsOn, invitations } = props;
	const searchLabel = props.searchLabel ?? "Search your calendar";

	return (
		<>
			<LaneBar>
				<LaneSearchField
					value={calendarQuery.value}
					placeholder={searchLabel}
					label={searchLabel}
					icon={<Icon name="search" />}
					onInput={(v) => (calendarQuery.value = v)}
				/>
				<LaneFilterPopover
					open={filterOpen}
					active={activeFilterCount(props.address)}
					icon={<Icon name="filter" />}
					onReset={resetFilters}
				>
					<CalendarFilterFacets events={props.events} tz={props.tz} />
				</LaneFilterPopover>
			</LaneBar>

			{classToggles.length > 1
				? (
					<LaneToggleRow
						label="Event type"
						options={classToggles}
						active={solo ? [solo] : []}
						onToggle={(c) => showOnlyClass(c, present)}
					/>
				)
				: null}

			{invitations > 0 || invitationsOn
				? (
					<NavItem
						href={withInvitationsFilter(props.path, "", !invitationsOn)}
						label="Invitations"
						aria-label={`Invitations, ${invitations} waiting for your answer`}
						icon={<Icon name="mail" />}
						active={invitationsOn}
						trailing={<span class="cal-lane__count">{invitations}</span>}
						onClick={(e) => {
							if (e.metaKey || e.ctrlKey || e.shiftKey) return;
							e.preventDefault();
							setInvitationsOnly(!invitationsOn);
						}}
					/>
				)
				: null}
		</>
	);
}
