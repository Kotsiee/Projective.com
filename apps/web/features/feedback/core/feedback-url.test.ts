import { assertEquals } from "@std/assert";
import {
	FEEDBACK_HOME,
	feedbackBoardHref,
	feedbackIdeaHref,
	feedbackOverlayAllowed,
	isFeedbackOverlayOpen,
	readFeedbackLocation,
	withFeedbackLocation,
	withoutFeedbackOverlay,
} from "./feedback-url.ts";

const SLUG = "fbk-kbyrph7gdt";

// #region Reading
Deno.test("an empty query is the board's home: every tab, Top", () => {
	assertEquals(readFeedbackLocation(""), FEEDBACK_HOME);
});

Deno.test("idea, compose, status and sort are read; an idea wins over compose", () => {
	assertEquals(readFeedbackLocation(`?idea=${SLUG}&compose=1&status=planned&sort=new`), {
		view: "idea",
		idea: SLUG,
		status: "planned",
		sort: "new",
	});
	assertEquals(readFeedbackLocation("?compose=1").view, "compose");
});

Deno.test("a malformed idea address, an unknown tab or an unknown order reads as absent", () => {
	assertEquals(readFeedbackLocation("?idea=6ce1906f-caab-4708-a19e-df3d8960666e").view, "board");
	assertEquals(readFeedbackLocation("?idea=prj-kbyrph7gdt").idea, null);
	assertEquals(readFeedbackLocation("?status=archived").status, null);
	assertEquals(readFeedbackLocation("?status=active").status, null);
	assertEquals(readFeedbackLocation("?sort=oldest").sort, "top");
});

Deno.test("the drawer opens on feedback=open only, and never over /feedback itself", () => {
	assertEquals(isFeedbackOverlayOpen("?feedback=open"), true);
	assertEquals(isFeedbackOverlayOpen("?feedback=1"), false);
	assertEquals(isFeedbackOverlayOpen(""), false);
	assertEquals(feedbackOverlayAllowed("/projects"), true);
	assertEquals(feedbackOverlayAllowed("/feedback"), false);
	assertEquals(feedbackOverlayAllowed("/feedback/"), false);
});
// #endregion

// #region Writing
Deno.test("opening the drawer keeps the host page's own parameters, in order, and the hash", () => {
	const href = withFeedbackLocation("/projects?status=active&page=2#top", FEEDBACK_HOME, {
		overlay: true,
	});
	assertEquals(href, "/projects?status=active&page=2&feedback=open#top");
});

Deno.test("in the drawer an idea is written, the host's status and sort never are", () => {
	const href = withFeedbackLocation(
		"/projects?status=active&feedback=open",
		{ view: "idea", idea: SLUG, status: "planned", sort: "new" },
		{ overlay: true },
	);
	assertEquals(href, `/projects?status=active&feedback=open&idea=${SLUG}`);
});

Deno.test("on /feedback the tab and order are written, and the defaults are left out", () => {
	assertEquals(
		withFeedbackLocation("/feedback", { ...FEEDBACK_HOME, status: "shipped", sort: "new" }, {
			filters: true,
		}),
		"/feedback?status=shipped&sort=new",
	);
	assertEquals(
		withFeedbackLocation("/feedback?status=shipped&sort=new", FEEDBACK_HOME, { filters: true }),
		"/feedback",
	);
	assertEquals(
		withFeedbackLocation("/feedback", { ...FEEDBACK_HOME, view: "compose" }, { filters: true }),
		"/feedback?compose=1",
	);
});

Deno.test("closing removes exactly what the drawer owns", () => {
	assertEquals(
		withoutFeedbackOverlay(`/wallet?w=team:1&feedback=open&idea=${SLUG}&compose=1#ledger`),
		"/wallet?w=team:1#ledger",
	);
	assertEquals(withoutFeedbackOverlay("/explore?q=logo&sort=new"), "/explore?q=logo&sort=new");
});

Deno.test("an idea's own address: on the page it keeps the tab; in the drawer it is the host page", () => {
	assertEquals(
		feedbackIdeaHref(SLUG, "page", "/feedback?status=planned"),
		`/feedback?idea=${SLUG}&status=planned`,
	);
	assertEquals(
		feedbackIdeaHref(SLUG, "drawer", "/projects?status=active&feedback=open"),
		`/projects?status=active&feedback=open&idea=${SLUG}`,
	);
	assertEquals(
		feedbackBoardHref("page", `/feedback?idea=${SLUG}&status=planned`),
		"/feedback?status=planned",
	);
	assertEquals(
		feedbackBoardHref("drawer", `/explore?feedback=open&idea=${SLUG}`),
		"/explore?feedback=open",
	);
});
// #endregion
