import { assert, assertEquals, assertRejects } from "@std/assert";
import { MemberRosterPageSchema } from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import { projectsDb } from "./live-support.ts";
import { fetchDeclinedInvitations, fetchInvitations, fetchMemberRoster } from "./live-members.ts";

/**
 * live-members_test — the Members roster, the invitation queue and the declined-invitation lookup
 * against a fake PostgREST.
 *
 * Contract (module docblock): `fetchMemberRoster` returns `null` for an engagement this viewer cannot
 * see and THROWS (naming the table) only when the project or participant read fails; every other
 * lookup degrades. The visibility rule and the management gate on the invitation queue are applied
 * HERE, not by RLS (`project_invitations` has none), so they are asserted against what a
 * non-managing viewer is handed — including that the queue is never even read for them.
 *
 * The fake sits at `globalThis.fetch`, so the real supabase-js builder parses every answer.
 */

// #region Fake PostgREST
/** A PostgREST error body, exactly as the server serialises one. */
interface PgErrorBody {
	code: string;
	message: string;
	details: string | null;
	hint: string | null;
}

const FAIL = Symbol("pg-fail");

/** A route answer that makes PostgREST respond with an error envelope. */
interface PgFailure {
	[FAIL]: true;
	status: number;
	body: PgErrorBody;
}

/** One request the module issued, decoded. */
interface FakeRequest {
	method: string;
	schema: string;
	name: string;
	rpc: boolean;
	query: URLSearchParams;
	body: unknown;
}

/** A static answer, or a function of the request. Keys are `schema.table` / `schema.rpc.fn`. */
type Route = unknown | ((req: FakeRequest) => unknown);

/** Build an error answer — `42501` insufficient privilege, `P0001` raise, `23505`, `PGRST116`… */
function pgFail(
	code: string,
	message: string,
	status = 400,
	details: string | null = null,
): PgFailure {
	return { [FAIL]: true, status, body: { code, message, details, hint: null } };
}

function isFailure(value: unknown): value is PgFailure {
	return typeof value === "object" && value !== null && FAIL in value;
}

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

/**
 * Run `body` with `fetch` answering every Supabase REST call from `routes`. An unrouted table reads
 * as `[]` and an unrouted RPC as `null`, which is what an empty, RLS-filtered database answers.
 */
async function withPostgrest<T>(
	routes: Record<string, Route>,
	body: (calls: FakeRequest[]) => Promise<T>,
): Promise<T> {
	const calls: FakeRequest[] = [];
	const realFetch = globalThis.fetch;
	const savedEnv = ENV_KEYS.map((key) => [key, Deno.env.get(key)] as const);
	Deno.env.set("SUPABASE_URL", "http://postgrest.fake");
	Deno.env.set("SUPABASE_ANON_KEY", "XXXX-XXXX");
	Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "XXXX-XXXX");

	const json = (payload: unknown, status: number, headers: Record<string, string> = {}) =>
		new Response(JSON.stringify(payload), {
			status,
			headers: { "content-type": "application/json", ...headers },
		});

	globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		const path = url.pathname.replace(/^\/rest\/v1\//, "");
		const rpc = path.startsWith("rpc/");
		const name = rpc ? path.slice(4) : path;
		const schema = request.headers.get("accept-profile") ??
			request.headers.get("content-profile") ?? "public";
		const text = await request.text();
		const req: FakeRequest = {
			method: request.method,
			schema,
			name,
			rpc,
			query: url.searchParams,
			body: text ? JSON.parse(text) : null,
		};
		calls.push(req);

		const key = `${schema}.${rpc ? "rpc." : ""}${name}`;
		const route = key in routes ? routes[key] : (rpc ? null : []);
		const answer = typeof route === "function"
			? (route as (r: FakeRequest) => unknown)(req)
			: route;
		if (isFailure(answer)) return json(answer.body, answer.status);

		if ((request.headers.get("accept") ?? "").includes("vnd.pgrst.object")) {
			const rows = Array.isArray(answer) ? answer : [answer];
			if (rows.length !== 1) {
				return json({
					code: "PGRST116",
					message: "JSON object requested, multiple (or no) rows returned",
					details: `The result contains ${rows.length} rows`,
					hint: null,
				}, 406);
			}
			return json(rows[0], 200);
		}
		const count = Array.isArray(answer) ? answer.length : 1;
		const range = count === 0 ? "*/0" : `0-${count - 1}/${count}`;
		if (request.method === "HEAD") {
			return new Response(null, { status: 200, headers: { "content-range": range } });
		}
		return json(answer, 200, { "content-range": range });
	};

	try {
		return await body(calls);
	} finally {
		globalThis.fetch = realFetch;
		for (const [key, value] of savedEnv) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
	}
}

// #endregion

// #region Fixtures
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const FREELANCER_ID = "22222222-2222-4222-8222-222222222222";
const MANAGER_ID = "33333333-3333-4333-8333-333333333333";
const IDLE_ID = "44444444-4444-4444-8444-444444444444";
const STRANGER_ID = "55555555-5555-4555-8555-555555555555";
const PROJECT_UUID = "66666666-6666-4666-8666-666666666666";
const S1 = "77777777-7777-4777-8777-777777777771";
const S2 = "77777777-7777-4777-8777-777777777772";
const CHANNEL_ID = "88888888-8888-4888-8888-888888888888";
const SEAT_ID = "99999999-9999-4999-8999-999999999999";
const SLUG = "prj-members222";

function actorOf(userId: string): ReadActor & { accessToken: string } {
	return { userId, contextId: "", contextType: "personal", accessToken: "XXXX-XXXX" };
}

const OWNER = actorOf(OWNER_ID);

const PROJECT_ROW = {
	id: PROJECT_UUID,
	slug: SLUG,
	title: "Brand refresh",
	format: "pipeline",
	owner_user_id: OWNER_ID,
	created_at: "2026-09-01T00:00:00.000Z",
};

const PARTICIPANTS = [
	// The owner also holding an 'assignee' row must not be demoted to freelancer.
	{
		id: "pp-owner",
		profile_type: "freelancer",
		profile_id: OWNER_ID,
		role: "assignee",
		created_at: "2026-09-02T00:00:00Z",
	},
	{
		id: "pp-free",
		profile_type: "freelancer",
		profile_id: FREELANCER_ID,
		role: "assignee",
		created_at: "2026-09-03T00:00:00Z",
	},
	{
		id: "pp-mgr",
		profile_type: "freelancer",
		profile_id: MANAGER_ID,
		role: "manager",
		created_at: "2026-09-04T00:00:00Z",
	},
	{
		id: "pp-idle",
		profile_type: "freelancer",
		profile_id: IDLE_ID,
		role: "assignee",
		created_at: "2026-09-05T00:00:00Z",
	},
	// A workspace is not a person and has no roster row.
	{
		id: "pp-biz",
		profile_type: "business",
		profile_id: "biz-1",
		role: "client",
		created_at: "2026-09-06T00:00:00Z",
	},
];

const STAGES = [
	{ id: S1, name: "Discovery", sort_order: 0, status: "in_progress" },
	{ id: S2, name: null, sort_order: 1, status: "open" },
];

const PARTY_CARDS = [
	{ user_id: OWNER_ID, username: "olive", first_name: "Olive", last_name: "Owner" },
	{ user_id: FREELANCER_ID, username: "fern", first_name: "Fern", last_name: null },
	{ user_id: MANAGER_ID, username: "max", first_name: "Max", last_name: "Manager" },
	{ user_id: IDLE_ID, username: "ivy", first_name: "Ivy", last_name: null },
];

function invitation(id: string, over: Record<string, unknown> = {}) {
	return {
		id,
		project_stage_id: S1,
		target_email: null,
		target_user_id: null,
		role: "freelancer",
		inviter_user_id: OWNER_ID,
		status: "pending",
		created_at: "2026-09-20T00:00:00.000Z",
		expires_at: "2099-01-01T00:00:00.000Z",
		accepted_at: null,
		declined_at: null,
		dismissed_at: null,
		placeholder: null,
		...over,
	};
}

const INVITATIONS = [
	invitation("inv-email", { target_email: "ada@example.org", placeholder: true }),
	invitation("inv-accepted", {
		target_user_id: FREELANCER_ID,
		status: "accepted",
		accepted_at: "2026-09-21T00:00:00Z",
	}),
	invitation("inv-revoked", { status: "revoked" }),
	invitation("inv-lapsed", {
		target_email: "late@example.org",
		expires_at: "2020-01-01T00:00:00Z",
	}),
	invitation("inv-declined", {
		target_email: "no@example.org",
		status: "declined",
		declined_at: "2026-09-22T00:00:00Z",
		expires_at: "2020-01-01T00:00:00Z",
	}),
];

/** The full happy-path database for {@link SLUG}. */
function rosterRoutes(over: Record<string, Route> = {}): Record<string, Route> {
	return {
		"projects.projects": [PROJECT_ROW],
		"projects.project_participants": PARTICIPANTS,
		"projects.project_stages": STAGES,
		"projects.stage_assignments": [
			{
				project_stage_id: S1,
				assignee_type: "freelancer",
				freelancer_profile_id: FREELANCER_ID,
				status: "accepted",
			},
			{
				project_stage_id: S1,
				assignee_type: "team",
				freelancer_profile_id: null,
				status: "assigned",
			},
		],
		"projects.tickets": [
			{ current_assignee_id: FREELANCER_ID, status: "claimed" },
			{ current_assignee_id: FREELANCER_ID, status: "in_review" },
			{ current_assignee_id: FREELANCER_ID, status: "todo" },
			{ current_assignee_id: null, status: "todo" },
		],
		"org.user_emails": [
			{ email: "old@example.org", is_primary: false },
			{ email: "olive@example.org", is_primary: true },
		],
		"org.rpc.get_party_cards": PARTY_CARDS,
		"projects.project_invitations": INVITATIONS,
		"projects.project_applications": [{
			id: "app-1",
			applicant_user_id: IDLE_ID,
			applicant_type: "freelancer",
			message: "Keen to help",
			created_at: "2026-09-25T00:00:00.000Z",
			project_application_targets: [
				{ target_type: "stage", target_id: S2 },
				{ target_type: "seat", target_id: SEAT_ID },
			],
		}],
		"projects.stage_open_seats": [{ id: SEAT_ID, project_stage_id: S1 }],
		...over,
	};
}
// #endregion

// #region fetchMemberRoster — happy path (managing viewer)
Deno.test("fetchMemberRoster maps the roster onto a schema-valid page, authority first", async () => {
	await withPostgrest(rosterRoutes(), async () => {
		const page = await fetchMemberRoster(OWNER, { projectId: SLUG });
		assert(page);
		MemberRosterPageSchema.parse(page);
		assertEquals(page.scope, "project");
		assertEquals(page.projectTitle, "Brand refresh");
		assertEquals(page.format, "pipeline");
		assertEquals(page.total, 4, "the business participant is not a person");
		assertEquals(
			page.members.map((m) => [m.id, m.party.name, m.role]),
			[
				[`owner:${OWNER_ID}`, "Olive Owner", "owner"],
				["pp-mgr", "Max Manager", "manager"],
				["pp-free", "Fern", "freelancer"],
				["pp-idle", "Ivy", "freelancer"],
			],
		);
		assertEquals(page.stages, [{ id: S1, name: "Discovery" }, { id: S2, name: "Untitled stage" }]);
		assertEquals(page.viewerId, `owner:${OWNER_ID}`);
		assertEquals(page.viewerRole, "owner");
		assertEquals(page.viewerCaps, {
			canManage: true,
			canInvite: true,
			canAssign: true,
			canEditRoles: true,
			canRemove: true,
		});
	});
});

Deno.test("fetchMemberRoster derives workload, held stages and the removal impact from the tables", async () => {
	await withPostgrest(rosterRoutes(), async () => {
		const page = await fetchMemberRoster(OWNER, { projectId: SLUG });
		assert(page);
		const fern = page.members.find((m) => m.id === "pp-free")!;
		assertEquals(fern.assignedStages, ["Discovery"]);
		assertEquals(fern.openTickets, 3);
		assertEquals(fern.ticketsLabel, "3 open");
		assertEquals(fern.impact, { claimedTickets: 1, submittedTickets: 1, startedStages: 1 });
		assertEquals(fern.assignment, null, "contributor/observer is a stage-channel question only");
		const ivy = page.members.find((m) => m.id === "pp-idle")!;
		assertEquals([ivy.openTickets, ivy.ticketsLabel], [0, "—"]);
	});
});

Deno.test("fetchMemberRoster exposes only the VIEWER's own email (the primary one)", async () => {
	await withPostgrest(rosterRoutes(), async () => {
		const page = await fetchMemberRoster(OWNER, { projectId: SLUG });
		assert(page);
		assertEquals(page.members.map((m) => m.email), ["olive@example.org", "", "", ""]);
		assertEquals(page.members.map((m) => m.isViewer), [true, false, false, false]);
	});
});

Deno.test("fetchMemberRoster's invitation queue: revoked dropped, expiry wins over status, acceptance links its member", async () => {
	await withPostgrest(rosterRoutes(), async () => {
		const page = await fetchMemberRoster(OWNER, { projectId: SLUG });
		assert(page);
		assertEquals(
			page.invites.map((i) => [i.id, i.status, i.email]),
			[
				["inv-email", "pending", "ada@example.org"],
				["inv-accepted", "accepted", "@fern"],
				["inv-lapsed", "expired", "late@example.org"],
				["inv-declined", "declined", "no@example.org"],
			],
		);
		const [email, accepted] = page.invites;
		assertEquals(email.placeholder, true);
		assertEquals(email.stageName, "Discovery");
		assertEquals(email.invitedBy, "Olive Owner");
		assertEquals(accepted.memberId, "pp-free");
		assertEquals(accepted.handle, "@fern");
	});
});

Deno.test("fetchMemberRoster's request queue resolves a seat target to its stage (seat beats stage)", async () => {
	await withPostgrest(rosterRoutes(), async () => {
		const page = await fetchMemberRoster(OWNER, { projectId: SLUG });
		assert(page);
		assertEquals(page.requests.length, 1);
		const [request] = page.requests;
		assertEquals(request.applicant.name, "Ivy");
		assertEquals(request.applicantKind, "freelancer");
		assertEquals(request.stageId, S1);
		assertEquals(request.stageName, "Discovery");
		assertEquals(request.message, "Keen to help");
	});
});
// #endregion

// #region fetchMemberRoster — authorization
Deno.test("a non-managing, unassigned viewer sees only themselves and leadership, and no queues", async () => {
	await withPostgrest(rosterRoutes(), async (calls) => {
		const page = await fetchMemberRoster(actorOf(IDLE_ID), { projectId: SLUG });
		assert(page);
		assertEquals(page.viewerRole, "freelancer");
		assertEquals(page.viewerCaps.canManage, false);
		assertEquals(page.members.map((m) => m.id), [`owner:${OWNER_ID}`, "pp-mgr", "pp-idle"]);
		assertEquals(page.total, 4, "the caption still counts the whole team");
		assertEquals(page.invites, []);
		assertEquals(page.requests, []);
		// The invitation table has no RLS: the management gate is the ONLY control, so it must not be read.
		assertEquals(calls.some((c) => c.name === "project_invitations"), false);
		assertEquals(calls.some((c) => c.name === "project_applications"), false);
		assertEquals(page.members.filter((m) => !m.isViewer).every((m) => m.email === ""), true);
	});
});

Deno.test("an assigned freelancer also sees colleagues who share a stage", async () => {
	await withPostgrest(
		rosterRoutes({
			"projects.stage_assignments": [
				{
					project_stage_id: S1,
					assignee_type: "freelancer",
					freelancer_profile_id: FREELANCER_ID,
					status: "accepted",
				},
				{
					project_stage_id: S1,
					assignee_type: "freelancer",
					freelancer_profile_id: IDLE_ID,
					status: "assigned",
				},
			],
		}),
		async () => {
			const page = await fetchMemberRoster(actorOf(FREELANCER_ID), { projectId: SLUG });
			assert(page);
			assertEquals(page.members.map((m) => m.id), [
				`owner:${OWNER_ID}`,
				"pp-mgr",
				"pp-free",
				"pp-idle",
			]);
		},
	);
});

Deno.test("a stranger reading a visible engagement is a guest with no seat and no capabilities", async () => {
	await withPostgrest(rosterRoutes(), async () => {
		const page = await fetchMemberRoster(actorOf(STRANGER_ID), { projectId: SLUG });
		assert(page);
		assertEquals(page.viewerRole, "guest");
		assertEquals(page.viewerId, "");
		assertEquals(Object.values(page.viewerCaps).every((cap) => cap === false), true);
		assertEquals(page.members.map((m) => m.role), ["owner", "manager"]);
	});
});

Deno.test("fetchMemberRoster answers null for a slug that resolves to nothing", async () => {
	await withPostgrest(rosterRoutes({ "projects.projects": [] }), async (calls) => {
		assertEquals(await fetchMemberRoster(OWNER, { projectId: SLUG }), null);
		assertEquals(calls.length, 1);
	});
});
// #endregion

// #region fetchMemberRoster — channel scope
Deno.test("in a stage channel each member is a contributor or an observer", async () => {
	await withPostgrest(
		rosterRoutes({
			"comms.project_channels": [{
				id: CHANNEL_ID,
				project_id: PROJECT_UUID,
				name: "Discovery room",
				stage_id: S1,
			}],
		}),
		async (calls) => {
			const page = await fetchMemberRoster(OWNER, { projectId: SLUG, channelId: CHANNEL_ID });
			assert(page);
			assertEquals(page.scope, "channel");
			assertEquals(page.channelKind, "stage");
			assertEquals(page.channelName, "Discovery room");
			assertEquals(page.stageId, S1);
			assertEquals(page.members.find((m) => m.id === "pp-free")?.assignment, "contributor");
			assertEquals(page.members.find((m) => m.id === "pp-idle")?.assignment, "observer");
			const channelRead = calls.find((c) => c.name === "project_channels")!;
			assertEquals(channelRead.query.get("project_id"), `eq.${PROJECT_UUID}`);
		},
	);
});

Deno.test("a channel segment that is not a uuid or slug collapses to project scope without a channel read", async () => {
	await withPostgrest(rosterRoutes(), async (calls) => {
		const page = await fetchMemberRoster(OWNER, { projectId: SLUG, channelId: "general" });
		assert(page);
		assertEquals(page.scope, "project");
		assertEquals(page.channelId, null);
		assertEquals(calls.some((c) => c.schema === "comms"), false);
	});
});
// #endregion

// #region fetchMemberRoster — failures
Deno.test("fetchMemberRoster: failed secondary reads degrade instead of throwing", async () => {
	const denied = pgFail("42501", "permission denied", 403);
	await withPostgrest(
		rosterRoutes({
			"projects.project_stages": denied,
			"projects.stage_assignments": denied,
			"projects.tickets": denied,
			"org.user_emails": denied,
			"projects.project_invitations": denied,
			"projects.project_applications": denied,
		}),
		async () => {
			const page = await fetchMemberRoster(OWNER, { projectId: SLUG });
			assert(page);
			MemberRosterPageSchema.parse(page);
			assertEquals(page.stages, []);
			assertEquals(page.invites, []);
			assertEquals(page.requests, []);
			assertEquals(page.members[0].email, "");
			assertEquals(
				page.members.every((m) => m.openTickets === 0 && m.assignedStages.length === 0),
				true,
			);
		},
	);
});

Deno.test("fetchMemberRoster THROWS when the project read fails", async () => {
	await withPostgrest(
		rosterRoutes({
			"projects.projects": pgFail("PGRST301", "JWT expired", 401),
		}),
		async () => {
			await assertRejects(
				() => fetchMemberRoster(OWNER, { projectId: SLUG }),
				Error,
				"projects.projects roster read failed: JWT expired",
			);
		},
	);
});

Deno.test("fetchMemberRoster THROWS when the participant read fails (42501)", async () => {
	await withPostgrest(
		rosterRoutes({
			"projects.project_participants": pgFail(
				"42501",
				"permission denied for table project_participants",
				403,
			),
		}),
		async () => {
			await assertRejects(
				() => fetchMemberRoster(OWNER, { projectId: SLUG }),
				Error,
				"projects.project_participants read failed",
			);
		},
	);
});
// #endregion

// #region fetchMemberRoster — session format
Deno.test("a session engagement carries its seat picture and each attendee's standing", async () => {
	await withPostgrest(
		rosterRoutes({
			"projects.projects": [{ ...PROJECT_ROW, format: "session" }],
			"projects.cohorts": [
				{ id: "co-1", max_seats: 3, status: "open" },
				{ id: "co-done", max_seats: 9, status: "completed" },
			],
			"projects.cohort_memberships": [
				{ user_id: FREELANCER_ID, status: "active" },
				{ user_id: IDLE_ID, status: "left" },
			],
			"projects.session_events": [{ start_time: "2099-07-17T14:30:00Z" }],
		}),
		async () => {
			const page = await fetchMemberRoster(OWNER, { projectId: SLUG });
			assert(page);
			assertEquals(page.format, "session");
			assertEquals(page.session, {
				mode: "group",
				seatCap: 3,
				seatsTaken: 1,
				nextSlotLabel: "Fri 17 Jul · 14:30 UTC",
			});
			assertEquals(page.members.find((m) => m.id === "pp-free")?.attendance, "confirmed");
			assertEquals(page.members.find((m) => m.id === "pp-idle")?.attendance, "declined");
		},
	);
});
// #endregion

// #region fetchInvitations (exported for live-invites)
Deno.test("fetchInvitations scopes to the project, hides dismissed rows, and degrades to [] on error", async () => {
	await withPostgrest({
		"projects.project_invitations": [invitation("inv-1", { target_email: "ada@example.org" })],
		"org.rpc.get_party_cards": PARTY_CARDS,
	}, async (calls) => {
		const now = Date.parse("2026-09-21T00:00:00Z");
		const invites = await fetchInvitations(
			OWNER,
			projectsDb(OWNER),
			PROJECT_UUID,
			new Map([[S1, "Discovery"]]),
			now,
			new Map(),
		);
		assertEquals(invites.map((i) => [i.id, i.invitedLabel, i.stageName]), [[
			"inv-1",
			"Yesterday",
			"Discovery",
		]]);
		assertEquals(calls[0].query.get("project_id"), `eq.${PROJECT_UUID}`);
		assertEquals(calls[0].query.get("dismissed_at"), "is.null");
	});
	await withPostgrest({
		"projects.project_invitations": pgFail("42501", "permission denied", 403),
	}, async () => {
		assertEquals(
			await fetchInvitations(
				OWNER,
				projectsDb(OWNER),
				PROJECT_UUID,
				new Map(),
				Date.now(),
				new Map(),
			),
			[],
		);
	});
});
// #endregion

// #region fetchDeclinedInvitations
Deno.test("fetchDeclinedInvitations keys this viewer's declined invitations by project slug", async () => {
	await withPostgrest({
		"org.users_public": [{ user_id: FREELANCER_ID }],
		"projects.project_invitations": [
			{ project_id: PROJECT_UUID, declined_at: "2026-09-22T00:00:00Z" },
			{ project_id: PROJECT_UUID, declined_at: null },
			{ project_id: "gone", declined_at: "2026-09-23T00:00:00Z" },
		],
		"projects.projects": [{ id: PROJECT_UUID, slug: SLUG }],
	}, async (calls) => {
		const out = await fetchDeclinedInvitations(OWNER, "@@Fern");
		assertEquals(out, { [SLUG]: [{ declinedAt: "2026-09-22T00:00:00.000Z" }] });
		assertEquals(calls[0].query.get("username"), "eq.fern");
		const invites = calls.find((c) => c.name === "project_invitations")!;
		assertEquals(invites.query.get("inviter_user_id"), `eq.${OWNER_ID}`);
		assertEquals(invites.query.get("target_user_id"), `eq.${FREELANCER_ID}`);
		assertEquals(invites.query.get("status"), "eq.declined");
	});
});

Deno.test("fetchDeclinedInvitations answers {} for an empty handle, an unknown seller, or any failed read", async () => {
	await withPostgrest({ "org.users_public": [] }, async (calls) => {
		assertEquals(await fetchDeclinedInvitations(OWNER, "@"), {});
		assertEquals(calls.length, 0);
		assertEquals(await fetchDeclinedInvitations(OWNER, "@ghost"), {});
	});
	await withPostgrest({
		"org.users_public": pgFail("42501", "permission denied", 403),
	}, async () => {
		assertEquals(await fetchDeclinedInvitations(OWNER, "@fern"), {});
	});
	await withPostgrest({
		"org.users_public": [{ user_id: FREELANCER_ID }],
		"projects.project_invitations": pgFail("XX000", "internal error", 500),
	}, async () => {
		assertEquals(await fetchDeclinedInvitations(OWNER, "@fern"), {});
	});
});
// #endregion
