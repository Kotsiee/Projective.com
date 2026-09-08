import { assertEquals } from "@std/assert";
import {
	NOTICE_PARAM,
	noticeMessage,
	projectsNoticeHref,
	readNoticeParam,
	withNoticeParam,
} from "./project-notice.ts";

// #region Reading
Deno.test("readNoticeParam returns the raw value, recognised or not, and null when absent", () => {
	assertEquals(readNoticeParam("?notice=project-not-found"), "project-not-found");
	assertEquals(readNoticeParam("?tab=open&notice=project-not-found&x=1"), "project-not-found");
	// Unrecognised is STILL returned — the island has to know there is something to strip.
	assertEquals(readNoticeParam("?notice=whatever"), "whatever");
	assertEquals(readNoticeParam("?notice="), null);
	assertEquals(readNoticeParam("?tab=open"), null);
	assertEquals(readNoticeParam(""), null);
});

Deno.test("noticeMessage renders only codes it knows", () => {
	assertEquals(noticeMessage("project-not-found"), "Project does not exist");
	assertEquals(noticeMessage("whatever"), null);
	assertEquals(noticeMessage(null), null);
});

Deno.test("noticeMessage is not fooled by inherited Object properties", () => {
	// A hand-typed `?notice=constructor` must not resolve to a function through the prototype chain.
	assertEquals(noticeMessage("constructor"), null);
	assertEquals(noticeMessage("toString"), null);
	assertEquals(noticeMessage("__proto__"), null);
});
// #endregion

// #region Writing + stripping
Deno.test("withNoticeParam sets the code and preserves every other parameter", () => {
	assertEquals(
		withNoticeParam("/projects", "project-not-found"),
		"/projects?notice=project-not-found",
	);
	assertEquals(
		withNoticeParam("/projects?tab=open", "project-not-found"),
		"/projects?tab=open&notice=project-not-found",
	);
});

Deno.test("withNoticeParam removes only itself, keeping other parameters and the hash", () => {
	assertEquals(
		withNoticeParam("/projects?tab=open&notice=project-not-found&tkv=tkt-abcdefghjk", null),
		"/projects?tab=open&tkv=tkt-abcdefghjk",
	);
	assertEquals(withNoticeParam("/projects?notice=project-not-found#top", null), "/projects#top");
	assertEquals(withNoticeParam("/projects?notice=whatever", null), "/projects");
});

Deno.test("withNoticeParam is idempotent, so a strip can be compared before it touches history", () => {
	assertEquals(withNoticeParam("/projects?tab=open", null), "/projects?tab=open");
	assertEquals(withNoticeParam("/projects", null), "/projects");
	const set = withNoticeParam("/projects", "project-not-found");
	assertEquals(withNoticeParam(set, "project-not-found"), set);
});

Deno.test("a written code round-trips through the reader", () => {
	const href = projectsNoticeHref("project-not-found");
	assertEquals(href, "/projects?notice=project-not-found");
	const search = href.slice(href.indexOf("?"));
	assertEquals(noticeMessage(readNoticeParam(search)), "Project does not exist");
	// And stripping it leaves the destination the redirect was aimed at.
	assertEquals(withNoticeParam(href, null), "/projects");
});

Deno.test("the route and the island agree on the parameter's name", () => {
	assertEquals(NOTICE_PARAM, "notice");
	assertEquals(projectsNoticeHref("project-not-found").includes(`${NOTICE_PARAM}=`), true);
});
// #endregion
