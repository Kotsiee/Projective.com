import { assertEquals } from "@std/assert";
import type { WorkspaceCapability, WorkspaceKind } from "@projective/types/workspace";
import { importWithoutGlyphs } from "./registry-import.testing.ts";

/**
 * The header band's hub strip (Decisions #306, #319): a multi-module hub is ONE strip of link tabs, one
 * per module; a hub the viewer reaches one module of draws none.
 */

interface Strip {
	title: string;
	tabs: { key: string; label: string; href: string; module: string }[];
	active: number;
}

interface HubTabsApi {
	hubTabs(input: {
		kind: WorkspaceKind;
		handle: string;
		capabilities: readonly WorkspaceCapability[];
		module: string;
		view: string | null;
		reading?: string | null;
	}): Strip | null;
}

const { hubTabs } = await importWithoutGlyphs<HubTabsApi>("./hub-tabs.ts");

const OWNER: readonly WorkspaceCapability[] = [
	"invite_members",
	"manage_roles",
	"manage_settings",
	"edit_profile",
	"manage_finances",
	"manage_billing",
	"spend_funds",
	"approve_spend",
	"contribute_funds",
	"view_analytics",
];

const strip = (
	module: string,
	view: string | null = null,
	capabilities: readonly WorkspaceCapability[] = OWNER,
	kind: WorkspaceKind = "team",
) => hubTabs({ kind, handle: "north-loop", capabilities, module, view });

Deno.test("hub tabs (#319): Members is Members · Roles, as links, whatever the sub-view", () => {
	const roster = strip("members");
	assertEquals(roster?.title, "Members");
	assertEquals(roster?.tabs.map((t) => [t.label, t.href]), [
		["Members", "/teams/north-loop/members"],
		["Roles", "/teams/north-loop/roles"],
	]);
	assertEquals(roster?.active, 0);
	assertEquals(strip("members", "chart")?.active, 0);
	assertEquals(strip("members", "pending")?.active, 0);
	assertEquals(strip("roles")?.active, 1);
	// The Invitations module is the Members queue under a second address.
	assertEquals(strip("invitations")?.active, 0);
});

Deno.test("hub tabs (#319): the Members tab returns a reader to the org chart they left", () => {
	const href = (reading: string | null) =>
		hubTabs({
			kind: "business",
			handle: "helia",
			capabilities: OWNER,
			module: "roles",
			view: null,
			reading,
		})?.tabs[0].href;
	assertEquals(href("chart"), "/businesses/helia/members?view=chart");
	assertEquals(href("people"), "/businesses/helia/members");
	assertEquals(href(null), "/businesses/helia/members");
	// Only the Members tab carries a reading.
	assertEquals(strip("finance")?.tabs.every((t) => !t.href.includes("?")), true);
});

Deno.test("hub tabs: a hub the viewer reaches one module of draws no strip", () => {
	// Without manage_roles the roster is Members (+ its Invitations alias): no hub strip.
	const noRoles = OWNER.filter((c) => c !== "manage_roles");
	assertEquals(strip("members", null, noRoles), null);
	assertEquals(strip("projects"), null);
	assertEquals(strip("overview"), null);
	assertEquals(strip("channels"), null);
});

Deno.test("hub tabs: the vault, insights and settings hubs per kind", () => {
	assertEquals(strip("payouts")?.tabs.map((t) => t.label), ["Finance", "Payouts"]);
	assertEquals(strip("payouts")?.active, 1);
	const business = strip("spend", null, OWNER, "business");
	assertEquals(business?.title, "Wallet");
	assertEquals(business?.tabs.map((t) => t.module), ["finance", "spend", "billing"]);
	assertEquals(business?.active, 1);
	assertEquals(strip("standing")?.tabs.map((t) => t.label), ["Analytics", "Standing"]);
	assertEquals(strip("verification")?.tabs.map((t) => t.module), [
		"settings",
		"profile",
		"verification",
	]);
	assertEquals(strip("verification")?.title, "Team settings");
});
