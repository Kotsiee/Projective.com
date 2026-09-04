import { assertEquals } from "@std/assert";
import { DRAFT_IDLE_DAYS, draftArchivesAt, draftIsStale } from "./pipeline.ts";

/**
 * The 30-day sweep's predicate, pinned.
 *
 * These are the rules that decide whether something disappears from somebody's workspace, and they
 * exist in TWO implementations — this one and `projects.fn_archive_stale_service_drafts` in SQL. The
 * assertions below are what stops the pair drifting into different definitions of "stale", which is a
 * drift nobody notices until a live engagement is archived or an abandoned draft never is.
 *
 * Every function takes its `now`, so the corpus is fixed and the test cannot go stale with the clock.
 */

const DAY = 86_400_000;
const NOW = Date.parse("2026-07-17T16:20:00Z");

Deno.test("an idle unfunded draft archives exactly DRAFT_IDLE_DAYS after its last activity", () => {
	const at = draftArchivesAt({ lastActivityAt: NOW, fundedStageCount: 0, status: "draft" });
	assertEquals(at, NOW + DRAFT_IDLE_DAYS * DAY);
});

Deno.test("funding REMOVES the deadline rather than postponing it", () => {
	// A pipeline somebody has paid into is an engagement, and no amount of later idleness makes it an
	// abandoned draft again. `null` says that; a far-future date would imply a clock still running.
	assertEquals(draftArchivesAt({ lastActivityAt: NOW, fundedStageCount: 1, status: "draft" }), null);
});

Deno.test("a draft that has left `draft` has no deadline", () => {
	assertEquals(draftArchivesAt({ lastActivityAt: NOW, fundedStageCount: 0, status: "active" }), null);
	assertEquals(draftArchivesAt({ lastActivityAt: NOW, fundedStageCount: 0, status: "archived" }), null);
});

Deno.test("staleness is evaluated against the passed clock, and the boundary is inclusive", () => {
	const draft = { lastActivityAt: NOW, fundedStageCount: 0, status: "draft" } as const;
	assertEquals(draftIsStale(draft, NOW), false);
	assertEquals(draftIsStale(draft, NOW + (DRAFT_IDLE_DAYS * DAY) - 1), false);
	// Exactly at the deadline it goes: `<=`, so a sweep running precisely on the boundary acts.
	assertEquals(draftIsStale(draft, NOW + DRAFT_IDLE_DAYS * DAY), true);
	assertEquals(draftIsStale(draft, NOW + (DRAFT_IDLE_DAYS + 60) * DAY), true);
});

Deno.test("a funded draft is never stale, however long it sits", () => {
	assertEquals(
		draftIsStale(
			{ lastActivityAt: NOW, fundedStageCount: 1, status: "draft" },
			NOW + 3650 * DAY,
		),
		false,
	);
});

Deno.test("the window is 30 days — the number the interface promises the buyer", () => {
	// Mirrored by `service_draft_idle_days` in `security.platform_params`. If these disagree the
	// interface names a date the job does not honour.
	assertEquals(DRAFT_IDLE_DAYS, 30);
});
