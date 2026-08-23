import type {
	CalendarEvent,
	CalendarPage,
	CalendarParams,
	SchedulingSim,
	SchedulingViewer,
} from "@projective/types/scheduling";
import { ANONYMOUS_VIEWER } from "@projective/types/scheduling";
import type { ProjectDetail } from "@projective/types/projects";
import { findProjectDetail } from "../projects/detail-fixtures.ts";
import {
	addDaysLocal,
	externalSourceFor,
	hash,
	HOUR,
	localSlot,
	NOW,
	sourcesFor,
	startOfWeekLocal,
	tzFor,
} from "./derive.ts";
import { withCoordination } from "./coordination-fixtures.ts";

/**
 * project/channel calendar fixtures — the fat scheduling service's in-memory answer for
 * `/projects/[id]/calendar` + `/projects/[id]/[channel]/calendar` while the projects backend gate is
 * off. DERIVES a deterministic set of calendar events from the resolved {@link ProjectDetail}: a sync
 * meeting, a review milestone, and a due-date per stage (past for completed stages, this week for the
 * active stage, future for drafts), plus recurring group sessions for session-format engagements, a
 * launch milestone, a scatter of task deadlines, and privacy-masked external-integration busy blocks.
 * Times are placed at a real local wall-clock in the project's deterministic display timezone, so the
 * grid and any working-hours overlay agree. The live path (RLS-scoped `scheduling.*` + integration
 * sync) fills in behind the same gate.
 *
 * **Deadlines are INSTANTS here** (`end === start`) and milestones are not. A due date is the moment
 * work is owed and a review is an hour people sit down for, so the two are minted as different
 * objects — see {@link CalendarEvent.end}, which now admits `>= start` for exactly this reason. The
 * distinction is load-bearing rather than cosmetic: an instant is the only entry the engine draws as
 * a pin, and while every deadline here carried a synthetic half-hour that path had no data at all.
 */

const TASK_TITLES = [
	"Design token audit",
	"Wire the checkout API",
	"Accessibility sweep",
	"Motion pass on the nav",
	"Empty-state illustrations",
	"Content review",
	"QA regression",
];

function buildEvents(
	detail: ProjectDetail,
	tz: string,
	channelId?: string | null,
): CalendarEvent[] {
	const stages = detail.channels.stages;
	const done = stages.filter((s) => s.status === "completed").length;
	const weekMon = startOfWeekLocal(NOW, tz);
	const events: CalendarEvent[] = [];

	const channelStage = channelId
		? stages.find((s) => s.channel.id === channelId || s.id === channelId)
		: null;
	const scopeStages = channelStage ? [channelStage] : stages;

	for (const stage of scopeStages) {
		const rel = stage.order - done; // <0 past · 0 active · >0 future
		const centerDay = addDaysLocal(weekMon, rel * 5 + 1, tz); // ~Tuesday of the stage's week

		const sync = localSlot(centerDay, 10 * 60, 60, tz);
		events.push({
			id: `sync-${stage.id}`,
			title: `${stage.name} sync`,
			kind: "sync",
			status: "confirmed",
			start: sync.start,
			end: sync.end,
			meta: "Stage sync",
			location: "Project room",
			sources: sourcesFor(`sync-${stage.id}`),
		});

		const reviewDay = addDaysLocal(centerDay, 2, tz);
		const review = localSlot(reviewDay, 15 * 60, 45, tz);
		events.push({
			id: `review-${stage.id}`,
			title: `${stage.name} review`,
			kind: "milestone",
			status: stage.activity === "revision_requested" ? "tentative" : "confirmed",
			start: review.start,
			end: review.end,
			meta: "Review milestone",
			sources: sourcesFor(`review-${stage.id}`),
		});

		// A deadline is a MOMENT, so it is minted as an instant (`end === start`) and the grid draws it
		// as a pin. The review above keeps a real 45 minutes because a review is a thing people sit
		// down and do — the two are different objects, and giving the deadline a synthetic half-hour
		// (which is what this fixture used to do) put a box on the grid whose height a reader is
		// entitled to read as a span nobody agreed to.
		const dueDay = addDaysLocal(centerDay, 4, tz);
		const due = localSlot(dueDay, 17 * 60, 0, tz);
		events.push({
			id: `due-${stage.id}`,
			title: `${stage.name} due`,
			kind: "deadline",
			status: "confirmed",
			start: due.start,
			end: due.end,
			meta: "Stage deadline",
			sources: sourcesFor(`due-${stage.id}`),
		});

		if (detail.format === "session") {
			const sesDay = addDaysLocal(centerDay, 1, tz);
			const ses = localSlot(sesDay, 13 * 60, 90, tz);
			const cap = 8 + (hash(stage.id) % 8);
			events.push({
				id: `session-${stage.id}`,
				title: `${stage.name} session`,
				kind: "session",
				status: "confirmed",
				start: ses.start,
				end: ses.end,
				attendees: 2 + (hash(`${stage.id}:att`) % cap),
				capacity: cap,
				meta: "Group session",
				sources: sourcesFor(`session-${stage.id}`),
			});
		}
	}

	// Only decorate the whole-project view with cross-stage extras.
	if (!channelStage) {
		// A launch milestone at the final stage (all-day).
		const last = stages[stages.length - 1];
		if (last) {
			const rel = last.order - done;
			const launchDay = addDaysLocal(weekMon, rel * 5 + 5, tz);
			events.push({
				id: "launch",
				title: `${detail.title} launch`,
				kind: "milestone",
				status: "tentative",
				start: launchDay,
				end: launchDay + 24 * HOUR,
				allDay: true,
				meta: "Milestone",
				sources: sourcesFor(`launch-${detail.slug}`),
			});
		}

		// A scatter of task deadlines across the current fortnight — instants, for the same reason the
		// stage deadline above is one. They are also what exercises the engine's pin path and the
		// proximity clustering that folds several due-marks in the same hour into one chip, neither of
		// which had any live data while every deadline here carried an invented three quarters of an
		// hour.
		for (let i = 0; i < 5; i++) {
			const h = hash(`${detail.slug}:task:${i}`);
			const day = addDaysLocal(weekMon, (h % 10) - 1, tz);
			const startMin = 9 * 60 + (h % 7) * 60;
			const slot = localSlot(day, startMin, 0, tz);
			events.push({
				id: `task-${i}`,
				title: `${TASK_TITLES[h % TASK_TITLES.length]} due`,
				kind: "deadline",
				status: "confirmed",
				start: slot.start,
				end: slot.end,
				sources: sourcesFor(`${detail.slug}:task:${i}`),
			});
		}

		// Privacy-masked external-integration busy blocks (§Part 1.4).
		for (let i = 0; i < 3; i++) {
			const h = hash(`${detail.slug}:busy:${i}`);
			const day = addDaysLocal(weekMon, h % 7, tz);
			const startMin = 8 * 60 + (h % 9) * 60;
			const slot = localSlot(day, startMin, 30 + (h % 4) * 30, tz);
			events.push({
				id: `busy-${i}`,
				title: "Busy",
				kind: "busy",
				status: i % 3 === 0 ? "tentative" : "busy",
				masked: true,
				sources: externalSourceFor(`${detail.slug}:busy:${i}`),
				start: slot.start,
				end: slot.end,
			});
		}
	}

	return events.sort((a, b) => a.start - b.start);
}

/**
 * The coordination store key for a project's calendar. Exported so a WRITE addresses the same key
 * the READ derived, without either side re-deriving the slug from the id twice.
 */
export function calendarSurfaceKey(projectId: string): string | null {
	const detail = findProjectDetail(projectId);
	return detail ? `project:${detail.slug}` : null;
}

/**
 * Resolve the calendar page for a project (or one of its channels). `null` → 404.
 *
 * `viewer` decides only who is SEATED on each event's roster; it never changes which events exist.
 * It defaults to nobody so a caller that forgets it produces a page with no party on it — the safe
 * direction, since the service's privacy projection then withholds every coordination field.
 *
 * `sim` is the developer simulation overlay, absent on every real request; it moves the coordination
 * INPUTS only (see `./coordination-fixtures.ts`) and grants nothing.
 */
export function findCalendarPage(
	params: CalendarParams,
	viewer: SchedulingViewer = ANONYMOUS_VIEWER,
	sim?: SchedulingSim,
): CalendarPage | null {
	const detail = findProjectDetail(params.projectId);
	if (!detail) return null;
	const seed = hash(detail.slug);
	const tz = tzFor(seed);
	const channelId = params.channelId ?? null;
	// Keyed on the SLUG, not the requested id, so the project- and channel-scope reads of the same
	// engagement derive (and mutate) the same coordination state for the events they share.
	const surfaceKey = `project:${detail.slug}`;
	// The engagement's own people are the honest cast; the host is whoever runs the engagement, and
	// on a project calendar the client is a guest of the delivery side, never its host.
	const cast = detail.members.map((m) => m.party);
	return {
		scope: channelId ? "channel" : "project",
		projectId: params.projectId,
		channelId,
		title: detail.title,
		timezone: tz,
		viewerIsClient: detail.viewerIsClient,
		canCreate: true,
		events: buildEvents(detail, tz, channelId).map((event) =>
			withCoordination(event, {
				surfaceKey,
				host: detail.owner,
				cast,
				viewer,
				viewerHostsSurface: !detail.viewerIsClient,
				timezone: tz,
				remainingOccurrences: 1,
				sim,
			})
		),
	};
}
