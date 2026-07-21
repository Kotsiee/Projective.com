import type { CalendarEvent, CalendarPage, CalendarParams } from "@projective/types/scheduling";
import type { ProjectDetail } from "@projective/types/projects";
import { findProjectDetail } from "../projects/detail-fixtures.ts";
import {
	addDaysLocal,
	hash,
	HOUR,
	integrationsFor,
	localSlot,
	NOW,
	startOfWeekLocal,
	tzFor,
} from "./derive.ts";

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

function buildEvents(detail: ProjectDetail, tz: string, channelId?: string | null): CalendarEvent[] {
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
		});

		const dueDay = addDaysLocal(centerDay, 4, tz);
		const due = localSlot(dueDay, 17 * 60, 30, tz);
		events.push({
			id: `due-${stage.id}`,
			title: `${stage.name} due`,
			kind: "deadline",
			status: "confirmed",
			start: due.start,
			end: due.end,
			meta: "Stage deadline",
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
			});
		}

		// A scatter of task deadlines across the current fortnight.
		for (let i = 0; i < 5; i++) {
			const h = hash(`${detail.slug}:task:${i}`);
			const day = addDaysLocal(weekMon, (h % 10) - 1, tz);
			const startMin = 9 * 60 + (h % 7) * 60;
			const slot = localSlot(day, startMin, 45, tz);
			events.push({
				id: `task-${i}`,
				title: `${TASK_TITLES[h % TASK_TITLES.length]} due`,
				kind: "deadline",
				status: "confirmed",
				start: slot.start,
				end: slot.end,
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
				source: ["google", "outlook", "apple"][i % 3],
				start: slot.start,
				end: slot.end,
			});
		}
	}

	return events.sort((a, b) => a.start - b.start);
}

/** Resolve the calendar page for a project (or one of its channels). `null` → 404. */
export function findCalendarPage(params: CalendarParams): CalendarPage | null {
	const detail = findProjectDetail(params.projectId);
	if (!detail) return null;
	const seed = hash(detail.slug);
	const tz = tzFor(seed);
	const channelId = params.channelId ?? null;
	return {
		scope: channelId ? "channel" : "project",
		projectId: params.projectId,
		channelId,
		title: detail.title,
		timezone: tz,
		viewerIsClient: detail.viewerIsClient,
		canCreate: true,
		events: buildEvents(detail, tz, channelId),
		integrations: integrationsFor(seed),
	};
}
