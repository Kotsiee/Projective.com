import { assertEquals } from "@std/assert";
import { SessionWorkspaceSchema } from "@projective/types/projects";
import { fixtureWorkspace } from "./session-fixtures.ts";
import { toSessionWorkspace } from "./workspace-model.ts";

/*
 * The workspace's no-show fields (Decision #212): the claims the viewer is party to and the one sitting
 * they may report. A wrong mapping would offer Report no-show to a provider or on the wrong sitting.
 */

const NOW = Date.parse("2026-10-13T12:00:00.000Z");
const PROJECT = "33333333-3333-4333-8333-333333333333";
const DISPUTE = "44444444-4444-4444-8444-444444444444";

Deno.test("an attendee's reportable sitting and claims map onto the workspace", () => {
	const raw = fixtureWorkspace(PROJECT, "prj-abcdefghjk", "normal", "attendee", NOW);
	const sitting = raw.sittings[0];
	const ws = toSessionWorkspace({
		...raw,
		claimable_sitting_id: sitting.id,
		disputes: [
			{
				id: DISPUTE,
				status: "awaiting_response",
				session_event_id: sitting.id,
				respond_by: "2026-10-15T12:00:00.000Z",
				opened_at: "2026-10-13T11:00:00.000Z",
				resolved_at: null,
				mine: true,
			},
			{
				id: PROJECT,
				status: "resolved",
				session_event_id: null,
				respond_by: null,
				opened_at: "2026-10-13T11:00:00.000Z",
				resolved_at: null,
				mine: true,
			},
		],
	}, NOW);
	assertEquals(SessionWorkspaceSchema.safeParse(ws).success, true);
	assertEquals(ws.claimable?.id, sitting.id);
	assertEquals(ws.disputes.length, 1);
	assertEquals(ws.disputes[0].status, "awaiting_response");
	assertEquals(ws.disputes[0].sessionEventId, sitting.id);
});

Deno.test("a host is never offered a sitting to report, and a pre-#212 read has no claims", () => {
	const raw = fixtureWorkspace(PROJECT, "prj-abcdefghjk", "normal", "host", NOW);
	const ws = toSessionWorkspace({ ...raw, claimable_sitting_id: raw.sittings[0].id }, NOW);
	assertEquals(ws.claimable, null);
	assertEquals(ws.disputes, []);
});
