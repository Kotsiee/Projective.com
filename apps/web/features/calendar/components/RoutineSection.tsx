import type { ComponentChildren, JSX, VNode } from "preact";
import { useDroppable } from "@projective/ui/dnd";
import { Icon } from "@projective/ui/icons";
import { LaneIconButton, LaneSection } from "@projective/ui/navigation";
import type { CalendarEvent, Routine } from "@projective/types/scheduling";
import { styleVars } from "@ui/core/style.ts";
import {
	eventsSectionOpen,
	inspectRoutine,
	openRoutines,
	requestNewRoutine,
	routinesSectionOpen,
	selectedRoutineId,
	toggleRoutine,
} from "../core/calendar-state.ts";
import { type RoutineGroups, routineMeta } from "../core/routine-view.ts";

/** What a lane row is dragged as, and the only thing these targets accept. */
export const ENTRY_DRAG = "entry";
const ACCEPTS = { accepts: [ENTRY_DRAG] };

/** The target that takes an entry out of its routine: the list of everything in none. */
export const LOOSE_TARGET = "loose";

/** One routine's drop target. */
export const routineTarget = (id: string) => `routine:${id}`;

/** Props for {@link RoutineSection}. */
export interface RoutineSectionProps {
	groups: RoutineGroups["groups"];
	/** The entry the reader has picked, whose routine stays open so its row can be seen. */
	selected: string | null;
	/** Whether a filter or a search is narrowing, so a routine it emptied can step aside. */
	narrowed: boolean;
	renderRow: (event: CalendarEvent) => VNode;
}

/**
 * RoutineSection — the lane's "Routines" (Decisions #389, #441, #442): one collapsible row per
 * routine, so a week of gym sessions reads as one line instead of forty, under a section header that
 * folds the whole group away.
 *
 * It is the shared {@link LaneSection}, the accordion every lane folds its groups with, and it does NOT
 * scroll on its own (Decision #442): it and {@link EventsSection} sit in the lane's one scroller, so
 * the reader has one scrollbar and a routine is never squeezed under the search field. Its body keeps a
 * floor while open (`.cal-lane__fold`), so an open section with one routine still reads as a group.
 * A pick on the grid opens the section that holds its row (the lane's spotlight effect).
 *
 * A row is two controls, as a `LaneSection` with a page is: the chevron folds, and the name opens the
 * routine in the inspector. Nothing here is boxed or tagged: the count and the behaviour are one line
 * of Meta text (§B.11), and the mark beside the name is the grid's own solid or hatched texture.
 */
export function RoutineSection(props: RoutineSectionProps): JSX.Element {
	const { groups, selected, narrowed, renderRow } = props;
	const shown = narrowed ? groups.filter((g) => g.members.length > 0) : groups;
	return (
		<div class="cal-lane__fold cal-lane__fold--routines">
			<LaneSection
				id="cal-routines"
				icon={<Icon name="repeat" size="xs" />}
				label="Routines"
				open={routinesSectionOpen.value}
				onToggle={() => (routinesSectionOpen.value = !routinesSectionOpen.peek())}
				action={
					<LaneIconButton
						icon={<Icon name="plus" />}
						label="New routine"
						tooltipPlacement="top"
						onClick={() => requestNewRoutine()}
					/>
				}
			>
				<div class="cal-rtn">
					{shown.length === 0 && !narrowed
						? <p class="cal-rtn__empty">Group a cadence here, and it lists once.</p>
						: shown.length === 0
						? <p class="cal-rtn__empty">No routine matches the search and filters.</p>
						: shown.map(({ routine, members }) => (
							<RoutineGroup
								key={routine.id}
								routine={routine}
								count={members.length}
								open={openRoutines.value.includes(routine.id) ||
									members.some((m) => m.id === selected)}
							>
								{members.map(renderRow)}
							</RoutineGroup>
						))}
				</div>
			</LaneSection>
		</div>
	);
}

/**
 * EventsSection — the lane's list of entries in no routine, under a header that folds it like
 * {@link RoutineSection} (Decision #442). Both sit in the lane's one scroller, so they scroll together.
 */
export function EventsSection({ children }: { children: ComponentChildren }): JSX.Element {
	return (
		<div class="cal-lane__fold cal-lane__fold--events">
			<LaneSection
				id="cal-events"
				icon={<Icon name="calendar" size="xs" />}
				label="Events"
				open={eventsSectionOpen.value}
				onToggle={() => (eventsSectionOpen.value = !eventsSectionOpen.peek())}
			>
				{children}
			</LaneSection>
		</div>
	);
}

/** One routine: a row that folds, opens in the inspector and takes a dropped entry. */
function RoutineGroup(
	{ routine, count, open, children }: {
		routine: Routine;
		count: number;
		open: boolean;
		children: ComponentChildren;
	},
): JSX.Element {
	const drop = useDroppable({ id: routineTarget(routine.id), data: ACCEPTS });
	const bodyId = `cal-rtn-${routine.slug}`;
	const color = routine.colorToken ?? "--primary";
	return (
		<div
			class="cal-rtn__group"
			data-routine-id={routine.id}
			ref={drop.setNodeRef}
			data-open={open ? "true" : undefined}
			data-over={drop.isOver.value ? "true" : undefined}
		>
			<div
				class="cal-rtn__row"
				data-selected={selectedRoutineId.value === routine.id ? "true" : undefined}
			>
				<button
					type="button"
					class="cal-rtn__toggle"
					aria-expanded={open}
					aria-controls={bodyId}
					aria-label={`${routine.name} entries`}
					onClick={() => toggleRoutine(routine.id)}
				>
					<Icon name="chevron-right" size="xs" />
				</button>
				<button type="button" class="cal-rtn__pick" onClick={() => inspectRoutine(routine)}>
					<span
						class="cal-rtn__mark"
						data-behavior={routine.behavior}
						style={styleVars({ "--cal-rtn-color": `var(${color})` })}
						aria-hidden="true"
					/>
					<span class="cal-rtn__name">{routine.name}</span>
					<span class="cal-rtn__meta">{routineMeta(routine, count)}</span>
				</button>
			</div>
			<div class="cal-rtn__body" id={bodyId} {...(open ? {} : { inert: true })}>
				<div class="cal-rtn__members">{children}</div>
			</div>
		</div>
	);
}

/** The list of entries in no routine, which is where a row is dropped to take it out of one. */
export function LooseEntries({ children }: { children: ComponentChildren }): JSX.Element {
	const drop = useDroppable({ id: LOOSE_TARGET, data: ACCEPTS });
	return (
		<div
			class="cal-lane__loose"
			ref={drop.setNodeRef}
			data-over={drop.isOver.value ? "true" : undefined}
		>
			{children}
		</div>
	);
}
