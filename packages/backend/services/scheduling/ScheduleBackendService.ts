import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import {
	isExploreBackendLive,
	isProfileBackendLive,
	isProjectsBackendLive,
} from "../../core/supabase.ts";
import { isReservedHandle } from "@projective/types/profile";
import type {
	AvailabilityParams,
	CalendarPage,
	CalendarParams,
	SchedulePage,
	ScheduleParams,
} from "@projective/types/scheduling";
import { findCalendarPage } from "./calendar-fixtures.ts";
import { findAvailabilityPage } from "./availability-fixtures.ts";
import { findSchedulePage } from "./schedule-fixtures.ts";

/**
 * ScheduleBackendService — the FAT server-side service behind the Calendar & Schedule surfaces: the
 * project/channel calendar, a `@handle`'s availability, and a session-based entity's schedule. It owns
 * the projection of each surface's domain data (an engagement, a profile, an explore item) into the
 * shared `@projective/types/scheduling` shapes the {@link "@projective/ui/calendar"} engine renders.
 * Thin routes under `apps/web/routes/api/scheduling/*` do only HTTP parsing + guard, then delegate here
 * and map the returned {@link ServiceResult} to a `Response`; the calendar routes call these directly
 * for SSR first paint. Islands never reach this — they `fetch` the routes via `ScheduleService`.
 *
 * **No new env gate.** Each read rides its OWN domain's existing switch (matching where the source data
 * lives): the project calendar behind {@link isProjectsBackendLive}, availability behind
 * {@link isProfileBackendLive}, an entity schedule behind {@link isExploreBackendLive}. All default off,
 * so the app answers from deterministic fixtures until the RLS-scoped `scheduling.*` reads + external-
 * calendar sync land behind the same gates with zero shape churn.
 */
export class ScheduleBackendService {
	/**
	 * The project-level (`/projects/[id]/calendar`) or channel-level (`/projects/[id]/[channel]/calendar`)
	 * calendar: task deadlines, review milestones, scheduled stage syncs, and — for session engagements —
	 * recurring group sessions, derived from the engagement. `404` for an unresolved project.
	 */
	static projectCalendar(params: CalendarParams): ServiceResult<{ page: CalendarPage }> {
		if (!isProjectsBackendLive()) {
			const page = findCalendarPage(params);
			if (!page) return fail(404, { message: `No project found for id "${params.projectId}".` });
			return ok({ page });
		}
		// LIVE: read the RLS-scoped `scheduling.*` + `projects.*` graph and sync connected external
		// calendars (not yet implemented) — fall back to the fixture projection so behaviour is preserved.
		const page = findCalendarPage(params);
		if (!page) return fail(404, { message: `No project found for id "${params.projectId}".` });
		return ok({ page });
	}

	/**
	 * A `@handle`'s public availability schedule (`/[handle]/availability`): weekly working hours,
	 * timezone, blackout dates, and privacy-masked bookable/busy blocks (plus any public group sessions).
	 * `404` for a reserved or unresolved handle.
	 */
	static availability(params: AvailabilityParams): ServiceResult<{ page: SchedulePage }> {
		if (isReservedHandle(params.handle)) {
			return fail(404, { message: `"${params.handle}" is a reserved route, not a profile.` });
		}
		if (!isProfileBackendLive()) {
			const page = findAvailabilityPage(params.handle);
			if (!page) return fail(404, { message: `No profile found for "${params.handle}".` });
			return ok({ page });
		}
		// LIVE: read the RLS-scoped `scheduling.*` availability tables (not yet implemented) — fall back to
		// the fixture projection so behaviour is preserved until that path lands.
		const page = findAvailabilityPage(params.handle);
		if (!page) return fail(404, { message: `No profile found for "${params.handle}".` });
		return ok({ page });
	}

	/**
	 * A session-based entity's public schedule (`/view/[entity]/schedule`): the recurring class/session
	 * slots + attendee counts + bookable 1:1 windows for the viewed explore item. `404` for an unresolved
	 * entity.
	 */
	static entitySchedule(params: ScheduleParams): ServiceResult<{ page: SchedulePage }> {
		if (!isExploreBackendLive()) {
			const page = findSchedulePage(params.entityId);
			if (!page) return fail(404, { message: `No item found for id "${params.entityId}".` });
			return ok({ page });
		}
		// LIVE: read the RLS-scoped `scheduling.*` + discovery graph (not yet implemented) — fall back to
		// the fixture projection so behaviour is preserved until that path lands.
		const page = findSchedulePage(params.entityId);
		if (!page) return fail(404, { message: `No item found for id "${params.entityId}".` });
		return ok({ page });
	}
}
