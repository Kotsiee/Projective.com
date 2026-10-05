import { assertEquals } from "@std/assert";
import { isChatRoute, normalisePath, shouldDismissPopout } from "./popout-route.ts";

// #region Chat routes
Deno.test("isChatRoute: a conversation page is a chat route; the inbox and its tabs are not", () => {
	assertEquals(isChatRoute("/messages/dm-juno"), true);
	assertEquals(isChatRoute("/messages/dm-juno/"), true);
	assertEquals(isChatRoute("/messages"), false);
	assertEquals(isChatRoute("/messages/dm-juno/files"), false);
	assertEquals(isChatRoute("/messages/dm-juno/members"), false);
});

Deno.test("isChatRoute: a channel's Chat view is a chat route; its other tabs are not", () => {
	assertEquals(isChatRoute("/projects/prj-atlas/stg-design"), true);
	assertEquals(isChatRoute("/projects/prj-atlas/stg-design/chat"), true);
	assertEquals(isChatRoute("/projects/prj-atlas/discussion"), true);
	assertEquals(isChatRoute("/projects/prj-atlas/stg-design/files"), false);
	assertEquals(isChatRoute("/projects/prj-atlas/stg-design/submissions/a/b"), false);
});

Deno.test("isChatRoute: project-level views and unrelated pages are not chat routes", () => {
	for (
		const view of ["board", "calendar", "edit", "files", "members", "preview", "timeline"]
	) {
		assertEquals(isChatRoute(`/projects/prj-atlas/${view}`), false, view);
	}
	assertEquals(isChatRoute("/projects/prj-atlas/submissions/x"), false);
	assertEquals(isChatRoute("/projects/prj-atlas"), false);
	assertEquals(isChatRoute("/projects/create"), false);
	assertEquals(isChatRoute("/explore"), false);
	assertEquals(isChatRoute("/@juno"), false);
});
// #endregion

// #region Dismissal
Deno.test("shouldDismissPopout: arriving at a chat route from another page dismisses", () => {
	assertEquals(shouldDismissPopout("/explore", "/messages/dm-juno"), true);
	assertEquals(shouldDismissPopout("/messages/dm-juno/files", "/messages/dm-juno"), true);
	assertEquals(shouldDismissPopout("/messages/dm-juno", "/projects/prj-atlas/stg-design"), true);
	assertEquals(shouldDismissPopout(undefined, "/messages/dm-juno"), true);
});

Deno.test("shouldDismissPopout: the spawning page and a reload of it keep the window", () => {
	assertEquals(shouldDismissPopout("/messages/dm-juno", "/messages/dm-juno"), false);
	assertEquals(shouldDismissPopout("/messages/dm-juno/", "/messages/dm-juno"), false);
});

Deno.test("shouldDismissPopout: a non-chat destination never dismisses", () => {
	assertEquals(shouldDismissPopout("/messages/dm-juno", "/explore"), false);
	assertEquals(shouldDismissPopout(undefined, "/projects/prj-atlas/board"), false);
});

Deno.test("normalisePath: drops a trailing slash and empty segments", () => {
	assertEquals(normalisePath("/messages/dm-juno/"), "/messages/dm-juno");
	assertEquals(normalisePath("/"), "/");
});
// #endregion
