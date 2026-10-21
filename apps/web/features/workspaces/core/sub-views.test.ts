import { assert, assertEquals } from "@std/assert";
import type { WorkspaceCapability } from "@projective/types/workspace";
import {
	bandSubViewsFor,
	isPeopleReading,
	MEMBERS_CHART,
	MEMBERS_PEOPLE,
	MEMBERS_QUEUE,
	MEMBERS_REQUESTS,
	membersSectionOf,
	membersSectionsFor,
	membersSectionView,
	pickSubView,
	PROJECTS_ACTIVE,
	PROJECTS_PROPOSALS,
	resolveSubView,
	SUB_VIEWS,
	subViewIndex,
	subViewLabel,
	subViewSearch,
	subViewsFor,
} from "./sub-views.ts";

/**
 * A console module's sub-views as data (Teams work order L2): which tabs a viewer is offered, how a
 * raw `?view=` resolves, and how the address follows a pick. Every root reads this one table.
 */

const INVITER: readonly WorkspaceCapability[] = ["invite_members"];
const MEMBER: readonly WorkspaceCapability[] = [];
const values = (views: readonly { value: string }[]) => views.map((v) => v.value);

// #region Members
Deno.test("sub-views: Members offers People · Requests · Invitations · Org chart on both kinds", () => {
	for (const kind of ["team", "business"] as const) {
		const views = subViewsFor("members", kind, INVITER);
		assertEquals(values(views), [MEMBERS_PEOPLE, MEMBERS_REQUESTS, MEMBERS_QUEUE, MEMBERS_CHART]);
		assertEquals(views.map((v) => v.label), ["People", "Requests", "Invitations", "Org chart"]);
	}
});

Deno.test("sub-views: the invitation queue is offered only to an invite_members holder", () => {
	assertEquals(values(subViewsFor("members", "team", MEMBER)), [MEMBERS_PEOPLE, MEMBERS_CHART]);
	// Its address resolves to the default for anybody else — never an empty queue under a live tab.
	assertEquals(resolveSubView("members", "team", MEMBER, MEMBERS_QUEUE), MEMBERS_PEOPLE);
	assertEquals(resolveSubView("members", "team", INVITER, MEMBERS_QUEUE), MEMBERS_QUEUE);
});

Deno.test("sub-views: the people readings are the Members section; the queues are not", () => {
	assert(isPeopleReading(MEMBERS_PEOPLE));
	assert(isPeopleReading(MEMBERS_CHART));
	assert(isPeopleReading(null));
	assert(!isPeopleReading(MEMBERS_QUEUE));
	assert(!isPeopleReading(MEMBERS_REQUESTS));
});

Deno.test("sub-views (#318): Requests is offered to an invite_members holder only", () => {
	assert(values(subViewsFor("members", "team", INVITER)).includes(MEMBERS_REQUESTS));
	assertEquals(resolveSubView("members", "team", INVITER, MEMBERS_REQUESTS), MEMBERS_REQUESTS);
	assert(!values(subViewsFor("members", "team", MEMBER)).includes(MEMBERS_REQUESTS));
	assertEquals(resolveSubView("members", "team", MEMBER, MEMBERS_REQUESTS), MEMBERS_PEOPLE);
});

Deno.test("sub-views (#319): the band leaves Members' views to the body and the footer rig", () => {
	assertEquals(bandSubViewsFor("members", "team", INVITER), []);
	assertEquals(bandSubViewsFor("members", "business", INVITER), []);
	// A module that leaves them to the band keeps them there.
	assertEquals(values(bandSubViewsFor("projects", "team", MEMBER)), [
		PROJECTS_ACTIVE,
		PROJECTS_PROPOSALS,
	]);
});

Deno.test("sub-views (#319): the Members sections are the project roster's, one ?view= each", () => {
	assertEquals(membersSectionsFor(subViewsFor("members", "team", INVITER)), [
		"members",
		"requests",
		"invitations",
	]);
	assertEquals(membersSectionsFor(subViewsFor("members", "team", MEMBER)), ["members"]);
	// A Requests view, once offered, sits between them as on a project.
	assertEquals(
		membersSectionsFor([
			{ value: MEMBERS_PEOPLE, label: "People" },
			{ value: MEMBERS_REQUESTS, label: "Requests" },
			{ value: MEMBERS_QUEUE, label: "Invitations" },
		]),
		["members", "requests", "invitations"],
	);
	assertEquals(membersSectionOf(MEMBERS_CHART), "members");
	assertEquals(membersSectionOf(null), "members");
	assertEquals(membersSectionOf(MEMBERS_QUEUE), "invitations");
	assertEquals(membersSectionOf(MEMBERS_REQUESTS), "requests");
	// Members returns to the reading the reader left; a queue is its own value.
	assertEquals(membersSectionView("members", MEMBERS_CHART), MEMBERS_CHART);
	assertEquals(membersSectionView("members", MEMBERS_PEOPLE), MEMBERS_PEOPLE);
	assertEquals(membersSectionView("members", null), MEMBERS_PEOPLE);
	assertEquals(membersSectionView("invitations", MEMBERS_CHART), MEMBERS_QUEUE);
	assertEquals(membersSectionView("requests", MEMBERS_CHART), MEMBERS_REQUESTS);
});
// #endregion

// #region Projects
Deno.test("sub-views: a team's Projects offers Active · Proposals to every member; a business's none", () => {
	for (const caps of [INVITER, MEMBER]) {
		const views = subViewsFor("projects", "team", caps);
		assertEquals(values(views), [PROJECTS_ACTIVE, PROJECTS_PROPOSALS]);
		assertEquals(views.map((v) => v.label), ["Active", "Proposals"]);
	}
	assertEquals(resolveSubView("projects", "team", MEMBER, null), PROJECTS_ACTIVE);
	assertEquals(resolveSubView("projects", "team", MEMBER, PROJECTS_PROPOSALS), PROJECTS_PROPOSALS);
	assertEquals(resolveSubView("projects", "team", MEMBER, "ledger"), PROJECTS_ACTIVE);
	// A business's Projects still hands off to /projects: no partition, so no tab and no ?view=.
	assertEquals(subViewsFor("projects", "business", INVITER), []);
	assertEquals(resolveSubView("projects", "business", INVITER, PROJECTS_PROPOSALS), null);
	// The landing view keeps the bare URL.
	const views = subViewsFor("projects", "team", MEMBER);
	assertEquals(subViewSearch("?view=proposals", views, PROJECTS_ACTIVE), "");
	assertEquals(subViewSearch("", views, PROJECTS_PROPOSALS), "?view=proposals");
});
// #endregion

// #region A tab is a control
Deno.test("sub-views: a module whose body ignores ?view= draws no tabs", () => {
	const planned = SUB_VIEWS.filter((e) => !e.live).map((e) => e.module);
	assert(!planned.includes("projects"), "a team's Projects body reads ?view=");
	assertEquals(planned.sort(), ["payouts"]);
	for (const module of planned) {
		assertEquals(subViewsFor(module, "team", INVITER), [], `${module} drew a tab`);
		assertEquals(resolveSubView(module, "team", INVITER, "ledger"), null);
	}
});

Deno.test("sub-views: a module with one view or none has no sub-views", () => {
	for (const module of ["overview", "roles", "settings", "invitations", null]) {
		assertEquals(subViewsFor(module, "team", INVITER), []);
		assertEquals(resolveSubView(module, "team", INVITER, "people"), null);
	}
});

Deno.test("sub-views: every entry is well formed", () => {
	for (const entry of SUB_VIEWS) {
		const own = values(entry.views);
		assertEquals(new Set(own).size, own.length, `${entry.module} repeats a value`);
		assert(entry.views.length > 1, `${entry.module} has a single view`);
		assert(!entry.views[0].gate, `${entry.module}'s default is gated`);
		assert(entry.views[0].live !== false, `${entry.module}'s default is not built`);
		assert(entry.kinds.length > 0);
	}
});
// #endregion

// #region Resolution and the address
Deno.test("sub-views: a raw value resolves to itself when offered, else the default", () => {
	const views = subViewsFor("members", "team", INVITER);
	assertEquals(pickSubView(views, MEMBERS_CHART), MEMBERS_CHART);
	assertEquals(pickSubView(views, null), MEMBERS_PEOPLE);
	assertEquals(pickSubView(views, "all"), MEMBERS_PEOPLE);
	assertEquals(pickSubView([], MEMBERS_CHART), null);
	assertEquals(subViewIndex(views, MEMBERS_CHART), 3);
	assertEquals(subViewIndex(views, "nope"), 0);
});

Deno.test("sub-views: the default addresses the bare URL; others set ?view=, keeping the rest", () => {
	const views = subViewsFor("members", "team", INVITER);
	assertEquals(subViewSearch("?view=chart", views, MEMBERS_PEOPLE), "");
	assertEquals(subViewSearch("", views, MEMBERS_CHART), "?view=chart");
	assertEquals(subViewSearch("?q=ana&view=pending", views, MEMBERS_CHART), "?q=ana&view=chart");
	assertEquals(subViewSearch("?q=ana&view=chart", views, MEMBERS_PEOPLE), "?q=ana");
});

Deno.test("sub-views: the panel is named by the current view, an unknown value by the first", () => {
	const views = subViewsFor("members", "team", INVITER);
	assertEquals(subViewLabel(views, MEMBERS_CHART), "Org chart");
	assertEquals(subViewLabel(views, "nope"), views[0].label);
	assertEquals(subViewLabel([], null), "");
});
// #endregion
