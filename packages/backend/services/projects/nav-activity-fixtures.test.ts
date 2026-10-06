import { assert, assertEquals } from "@std/assert";
import { QUIET_NAV_ACTIVITY } from "@projective/types/projects";
import { findProjectDetail } from "./detail-fixtures.ts";
import { fixtureNavActivity, recordFixtureSeen } from "./nav-activity-fixtures.ts";

/**
 * The fixture path's marks clear on a visit exactly as the database's do, and only for the viewer
 * and the engagement that recorded it.
 */

Deno.test("an unread fixture room marks the discussion, and a visit clears it for that viewer only", () => {
	const detail = findProjectDetail("prj-64vn8qwog8");
	assert(detail, "fixture prj-64vn8qwog8 exists");

	const before = fixtureNavActivity(detail, "viewer-a");
	assert(before.discussion.unread > 0, "the fixture room is unread");
	assertEquals(before.board.tone, "new");

	recordFixtureSeen("viewer-a", detail.slug, "discussion");
	assertEquals(fixtureNavActivity(detail, "viewer-a").discussion, QUIET_NAV_ACTIVITY.discussion);
	assertEquals(fixtureNavActivity(detail, "viewer-a").board.tone, "new");
	assert(
		fixtureNavActivity(detail, "viewer-b").discussion.unread > 0,
		"another viewer still sees it",
	);
});

Deno.test("a revision-requested fixture stage counts on Submissions", () => {
	const detail = findProjectDetail("prj-8mzxqqn6w8");
	assert(detail, "fixture prj-8mzxqqn6w8 exists");
	assertEquals(fixtureNavActivity(detail, "viewer-c").submissions.count, 1);
});
