import { assertEquals } from "@std/assert";
import { type ProjectRow, type SummaryContext, toSummary } from "./live-queries.ts";

/**
 * live-queries.test — the feed projection's viewer-role rule.
 *
 * The whole file exists for one bug. `viewerRole` was read from `projects.project_participants`
 * alone, and a project OWNER is normally not in that table: `projects.create_project` writes a
 * participant row only for a business-owned project, because `projects.has_project_access` already
 * resolves a personal owner through `owner_user_id`. So a personal project's owner resolved to
 * `member`, `viewerIsClientOf` refused that as an authority tier, `BoardPage.viewerIsClient` came
 * back false, and the board handed the project's own owner the provider-side surface — no Create
 * Ticket in the footer rig, no per-column "+".
 *
 * Nothing failed. There was no error, no log line and no type complaint; the owner simply saw a board
 * with no way to add work to it, which reads as a missing feature rather than a defect. Two sibling
 * reads got the same question right the whole time (the detail read's `resolveViewerIsClient` and
 * the setup projection), so the disagreement was invisible from any one file.
 *
 * These assert the OWNERSHIP path specifically, because that is the arm no participant row exercises.
 */

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function row(over: Partial<ProjectRow> = {}): ProjectRow {
	return {
		id: "p1",
		slug: "prj-test000001",
		title: "Test Project",
		format: "pipeline",
		status: "active",
		visibility: "unlisted",
		currency: "GBP",
		owner_user_id: OWNER,
		owner_team_id: null,
		owner_organisation_id: null,
		client_business_id: null,
		source_blueprint_id: null,
		updated_at: "2026-09-07T00:00:00.000Z",
		last_activity_at: null,
		...over,
	};
}

function ctx(over: Partial<SummaryContext> = {}): SummaryContext {
	return {
		roles: new Map(),
		scopeLabels: new Map(),
		stages: new Map(),
		owners: new Map(),
		viewerId: OWNER,
		...over,
	};
}

Deno.test("an owner with NO participant row is 'owner', not 'member' (the board regression)", () => {
	// The exact shape every project in the corpus has: zero participant rows.
	assertEquals(toSummary(row(), ctx()).viewerRole, "owner");
});

Deno.test("'owner' is a role viewerIsClientOf accepts on a client-architected project", () => {
	// live-board.ts `viewerIsClientOf` admits owner | admin | client for kind 'project'. Pinning the
	// membership here is what ties this projection to the board's create gate.
	const role = toSummary(row(), ctx()).viewerRole;
	assertEquals(["owner", "admin", "client"].includes(role), true);
});

Deno.test("ownership wins over a participant row that says otherwise", () => {
	// An owner enrolled as an assignee on their own stage is still the buying side.
	const roles = new Map([["p1", "freelancer"]]);
	assertEquals(toSummary(row(), ctx({ roles })).viewerRole, "owner");
});

Deno.test("a non-owner still resolves from the participant graph", () => {
	const roles = new Map([["p1", "assignee"]]);
	const c = ctx({ viewerId: OTHER, roles });
	// 'assignee' is not a ProjectViewerRole member, so it degrades to the least-privileged reading.
	assertEquals(toSummary(row(), c).viewerRole, "member");

	const named = ctx({ viewerId: OTHER, roles: new Map([["p1", "admin"]]) });
	assertEquals(toSummary(row(), named).viewerRole, "admin");
});

Deno.test("a non-owner with no participant row is 'member'", () => {
	assertEquals(toSummary(row(), ctx({ viewerId: OTHER })).viewerRole, "member");
});

Deno.test("an anonymous read never matches an owner", () => {
	// An empty viewer id must not compare equal to anything, or a signed-out read would be promoted
	// on any row whose owner column happened to be empty.
	assertEquals(toSummary(row({ owner_user_id: "" }), ctx({ viewerId: "" })).viewerRole, "member");
});

Deno.test("ownership resolves the same way on a service-kind engagement", () => {
	// A service instantiation's `viewerIsClientOf` arm requires the role to be a buying seat too, and
	// the owner there is the seat that created the engagement.
	const s = toSummary(row({ source_blueprint_id: "bp1" }), ctx());
	assertEquals(s.kind, "service");
	assertEquals(s.viewerRole, "owner");
});
