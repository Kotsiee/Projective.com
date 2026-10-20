import type { CalendarEvent, SchedulingTarget } from "@projective/types/scheduling";
import { kindCopy, type WorkspaceDetail, type WorkspaceKind } from "@projective/types/workspace";

/**
 * calendar-module-model — the pure decisions behind a console's Calendar module (Decision #308): which
 * projects the entity calendar is the union of, the sentences each state reads, and where a write on
 * one of its events is addressed.
 *
 * The calendar is the union of the entity's projects' own calendars, read as the viewer
 * (`ScheduleBackendService.entityCalendar`). It is read-only as a whole — an entry is created on its
 * project's calendar — but an existing event is answered and rescheduled from here exactly as on its
 * project's, because every write is addressed to that project.
 */

// #region Projects
/**
 * The projects an entity's calendar reads, by `prj-` slug: the detail's projects (a team's delivered
 * work, a business's commissions) and, for a team, the projects of its live stage assignments. In
 * order, each once.
 */
export function entityCalendarProjectIds(
	ws: Pick<WorkspaceDetail, "projects" | "engagements">,
): string[] {
	const ids = [
		...ws.projects.map((p) => p.id),
		...(ws.engagements ?? []).map((e) => e.projectSlug),
	];
	return [...new Set(ids.filter((id) => id.length > 0))];
}
// #endregion

// #region View
/** What the Calendar module says to one viewer of one entity. */
export interface EntityCalendarView {
	/** The module's lead sentence. */
	note: string;
	/** The sentence for an entity with nothing scheduled in the window the grid opens on. */
	emptyNote: string;
	/** The sentence for a calendar that could not be read. */
	failedNote: string;
}

/** The facts the view is derived from — the console detail's own. */
export interface EntityCalendarFacts {
	kind: WorkspaceKind;
	name: string;
	/** How many projects the calendar was read across. */
	projectCount: number;
}

/** The Calendar module's view for one entity. */
export function entityCalendarView(facts: EntityCalendarFacts): EntityCalendarView {
	const noun = kindCopy(facts.kind).noun;
	const work = facts.kind === "business" ? "has commissioned" : "is delivering";
	return {
		note: facts.projectCount === 0
			? `Meetings, stage due dates and ticket deadlines from every project ${facts.name} ${work} gather here.`
			: `Meetings, stage due dates and ticket deadlines across the ${facts.projectCount} ${
				facts.projectCount === 1 ? "project" : "projects"
			} ${facts.name} ${work}. New entries are added on each project's own calendar.`,
		emptyNote: facts.projectCount === 0
			? `This ${noun} has no projects yet, so nothing is scheduled.`
			: "Nothing you can see is scheduled on these projects.",
		failedNote: `${facts.name}'s calendar couldn't be read just now. Try again in a moment.`,
	};
}
// #endregion

// #region Writes
/**
 * Where an RSVP or a reschedule of `event` is addressed: its own project's calendar, which the server
 * re-resolves it through. `null` for an entry the union could not attribute to a project — it then
 * offers no write at all rather than one the server would refuse.
 */
export function entityEventTarget(
	event: Pick<CalendarEvent, "projectId">,
): Omit<SchedulingTarget, "eventId"> | null {
	return event.projectId ? { scope: "project", projectId: event.projectId, channelId: null } : null;
}
// #endregion
