import { assert, assertEquals } from "@std/assert";
import type { WorkspaceCapability } from "@projective/types/workspace";
import {
	isPeopleReading,
	MEMBERS_CHART,
	MEMBERS_PEOPLE,
	MEMBERS_QUEUE,
	MEMBERS_READINGS,
	pickSubView,
	resolveSubView,
	SUB_VIEW_TABS_ID,
	SUB_VIEWS,
	subViewIndex,
	subViewSearch,
	subViewsFor,
	subViewTabId,
} from "./sub-views.ts";

/**
 * A console module's sub-views as data (Teams work order L2): which tabs a viewer is offered, how a
 * raw `?view=` resolves, and how the address follows a pick. Every root reads this one table.
 */

const INVITER: readonly WorkspaceCapability[] = ["invite_members"];
const MEMBER: readonly WorkspaceCapability[] = [];
const values = (views: readonly { value: string }[]) => views.map((v) => v.value);

// #region Members
Deno.test("sub-views: Members offers People · Invitations · Org chart on both kinds", () => {
	for (const kind of ["team", "business"] as const) {
		const views = subViewsFor("members", kind, INVITER);
		assertEquals(values(views), [MEMBERS_PEOPLE, MEMBERS_QUEUE, MEMBERS_CHART]);
		assertEquals(views.map((v) => v.label), ["People", "Invitations", "Org chart"]);
	}
});

Deno.test("sub-views: the invitation queue is offered only to an invite_members holder", () => {
	assertEquals(values(subViewsFor("members", "team", MEMBER)), [MEMBERS_PEOPLE, MEMBERS_CHART]);
	// Its address resolves to the default for anybody else — never an empty queue under a live tab.
	assertEquals(resolveSubView("members", "team", MEMBER, MEMBERS_QUEUE), MEMBERS_PEOPLE);
	assertEquals(resolveSubView("members", "team", INVITER, MEMBERS_QUEUE), MEMBERS_QUEUE);
});

Deno.test("sub-views: the lane's readings are the Members views that are not the queue", () => {
	assertEquals(values(MEMBERS_READINGS), [MEMBERS_PEOPLE, MEMBERS_CHART]);
	assert(isPeopleReading(MEMBERS_PEOPLE));
	assert(isPeopleReading(MEMBERS_CHART));
	assert(isPeopleReading(null));
	assert(!isPeopleReading(MEMBERS_QUEUE));
});
// #endregion

// #region A tab is a control
Deno.test("sub-views: a module whose body ignores ?view= draws no tabs", () => {
	const planned = SUB_VIEWS.filter((e) => !e.live).map((e) => e.module);
	assertEquals(planned.sort(), ["payouts", "projects"]);
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
	assertEquals(subViewIndex(views, MEMBERS_CHART), 2);
	assertEquals(subViewIndex(views, "nope"), 0);
});

Deno.test("sub-views: the default addresses the bare URL; others set ?view=, keeping the rest", () => {
	const views = subViewsFor("members", "team", INVITER);
	assertEquals(subViewSearch("?view=chart", views, MEMBERS_PEOPLE), "");
	assertEquals(subViewSearch("", views, MEMBERS_CHART), "?view=chart");
	assertEquals(subViewSearch("?q=ana&view=pending", views, MEMBERS_CHART), "?q=ana&view=chart");
	assertEquals(subViewSearch("?q=ana&view=chart", views, MEMBERS_PEOPLE), "?q=ana");
});

Deno.test("sub-views: a tab id is the TabMenu's own `${id}-tab-${i}`", () => {
	assertEquals(subViewTabId(0), `${SUB_VIEW_TABS_ID}-tab-0`);
	assertEquals(subViewTabId(2), `${SUB_VIEW_TABS_ID}-tab-2`);
});
// #endregion
