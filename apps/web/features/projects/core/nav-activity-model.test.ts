import { assertEquals } from "@std/assert";
import { type ProjectNavActivity, QUIET_NAV_ACTIVITY } from "../types/projects-types.ts";
import { currentNavView, navViewOf, viewStatusOf } from "./nav-activity-model.ts";

/**
 * The lane's activity marks, pinned: a figure only where the number is the news, a dot everywhere
 * else, and nothing at all for a quiet view — a mark that shows with nothing behind it would send the
 * reader looking for a change that never happened.
 */

const busy: ProjectNavActivity = {
	overview: { changes: ["details"] },
	discussion: { unread: 10 },
	board: { tone: "moved" },
	timeline: { tone: "deadline" },
	files: { fresh: true },
	submissions: { count: 1 },
	members: { count: 4 },
};

Deno.test("a quiet viewer gets no mark on any view", () => {
	for (
		const view of [
			"overview",
			"discussion",
			"board",
			"timeline",
			"files",
			"submissions",
			"members",
		] as const
	) {
		assertEquals(viewStatusOf(view, QUIET_NAV_ACTIVITY), null);
	}
});

Deno.test("discussion counts cap at 9+ and speak the figure", () => {
	assertEquals(viewStatusOf("discussion", busy), {
		label: "9+ unread messages",
		count: "9+",
		tone: "accent",
	});
	assertEquals(
		viewStatusOf("discussion", { ...busy, discussion: { unread: 1 } })?.label,
		"1 unread message",
	);
});

Deno.test("submissions and members are figures; the rest are dots", () => {
	assertEquals(viewStatusOf("submissions", busy)?.count, "1");
	assertEquals(viewStatusOf("members", busy)?.count, "4");
	assertEquals(viewStatusOf("overview", busy)?.count, null);
	assertEquals(viewStatusOf("files", busy)?.count, null);
});

Deno.test("board and timeline tones map to distinct mark tones", () => {
	assertEquals(viewStatusOf("board", busy)?.tone, "neutral");
	assertEquals(viewStatusOf("board", { ...busy, board: { tone: "new" } })?.tone, "accent");
	assertEquals(viewStatusOf("timeline", busy)?.tone, "alert");
	assertEquals(viewStatusOf("timeline", { ...busy, timeline: { tone: "update" } })?.tone, "accent");
});

Deno.test("only lane views carry activity", () => {
	assertEquals(navViewOf("discussion"), "discussion");
	assertEquals(navViewOf("details"), null);
	assertEquals(navViewOf("calendar"), null);
});

Deno.test("the current view is the first current link that is a lane view", () => {
	const links = [{ key: "details" }, { key: "files" }, { key: "members" }];
	assertEquals(currentNavView(links, (l) => l.key !== "members"), "files");
	assertEquals(currentNavView(links, (l) => l.key === "details"), null);
});
