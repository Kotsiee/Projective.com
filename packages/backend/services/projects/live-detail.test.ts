import { assert, assertEquals, assertRejects } from "@std/assert";
import { ProjectDetailSchema } from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import { dmRowUnread, fetchProjectDetail, isClientSideRole } from "./live-detail.ts";

/**
 * live-detail_test — the sidebar's project detail read against a fake PostgREST.
 *
 * Contract (module + `fetchProjectBySlug` docblocks): `null` for a slug this viewer cannot see, a
 * THROWN error naming the table when a load-bearing read fails (the project, its stages, its
 * channels), and graceful degradation for every secondary lookup (participants, hired teams, team
 * and business names). The fat service's `liveRead` catches the throw and answers `503`.
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
const BUSINESS_ID = "33333333-3333-4333-8333-333333333333";
const TEAM_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_UUID = "55555555-5555-4555-8555-555555555555";
const STAGE_1 = "66666666-6666-4666-8666-666666666661";
const STAGE_2 = "66666666-6666-4666-8666-666666666662";
const SLUG = "prj-detail0001";

function actorOf(userId: string): ReadActor & { accessToken: string } {
	return { userId, contextId: "", contextType: "personal", accessToken: "XXXX-XXXX" };
}

const OWNER = actorOf(OWNER_ID);

/** One row answering both `projects.projects` reads (the summary and the detail columns). */
const PROJECT_ROW = {
	id: PROJECT_UUID,
	slug: SLUG,
	title: "Brand refresh",
	format: "pipeline",
	status: "active",
	visibility: "unlisted",
	currency: "GBP",
	owner_user_id: OWNER_ID,
	owner_team_id: null,
	owner_enterprise_id: null,
	client_business_id: BUSINESS_ID,
	source_blueprint_id: null,
	updated_at: "2026-10-01T00:00:00.000Z",
	last_activity_at: null,
	description_text: "A refresh of the whole identity.",
	structure_variation: "standard",
};

const STAGES = [
	{ id: STAGE_1, slug: "stg-discovery1", name: "Discovery", sort_order: 0, status: "in_progress" },
	{ id: STAGE_2, slug: "stg-delivery01", name: "", sort_order: 1, status: "revisions" },
];

const CHANNELS = [
	{
		id: "c-general",
		name: "Discussion",
		stage_id: null,
		visibility: "project_all",
		team_id: null,
		created_at: "2026-09-01T00:00:00Z",
	},
	{
		id: "c-s1",
		name: "ignored",
		stage_id: STAGE_1,
		visibility: "stage_all",
		team_id: null,
		created_at: "2026-09-02T00:00:00Z",
	},
	{
		id: "c-s2",
		name: "ignored",
		stage_id: STAGE_2,
		visibility: "stage_all",
		team_id: null,
		created_at: "2026-09-03T00:00:00Z",
	},
	{
		id: "c-s1-dupe",
		name: "dupe",
		stage_id: STAGE_1,
		visibility: "stage_all",
		team_id: null,
		created_at: "2026-09-04T00:00:00Z",
	},
	{
		id: "c-team",
		name: "Talent room",
		stage_id: STAGE_1,
		visibility: "team_private",
		team_id: TEAM_ID,
		created_at: "2026-09-05T00:00:00Z",
	},
	{
		id: "c-biz",
		name: "Client room",
		stage_id: STAGE_1,
		visibility: "business_private",
		team_id: null,
		created_at: "2026-09-06T00:00:00Z",
	},
	// Another team's room on the same stage (CH2): it belongs to that team, never under Northwind.
	{
		id: "c-team-other",
		name: "Other talent room",
		stage_id: STAGE_1,
		visibility: "team_private",
		team_id: "00000000-0000-4000-8000-0000000000ee",
		created_at: "2026-09-07T00:00:00Z",
	},
];

const PARTICIPANTS = [
	// The owner holding a participant row too must not appear twice.
	{ id: "pp-owner", profile_type: "freelancer", profile_id: OWNER_ID, role: "assignee" },
	{ id: "pp-free", profile_type: "freelancer", profile_id: FREELANCER_ID, role: "assignee" },
	{ id: "pp-biz", profile_type: "business", profile_id: BUSINESS_ID, role: "client" },
];

const PARTY_CARDS = [
	{ user_id: OWNER_ID, username: "olive", first_name: "Olive", last_name: "Owner" },
	{ user_id: FREELANCER_ID, username: "fern", first_name: "Fern", last_name: null },
];

/** The full happy-path database for {@link SLUG}. */
function happyRoutes(over: Record<string, Route> = {}): Record<string, Route> {
	return {
		"projects.projects": [PROJECT_ROW],
		"projects.project_stages": (req: FakeRequest) =>
			// `fetchProjectBySlug` counts stages with a `project_id=in.(…)` read; the detail read orders them.
			req.query.get("select")?.includes("slug") ? STAGES : STAGES.map((s) => ({
				project_id: PROJECT_UUID,
				status: s.status,
			})),
		"projects.project_participants": PARTICIPANTS,
		"projects.rpc.get_viewer_hired_teams": [
			{ team_id: TEAM_ID, project_stage_id: STAGE_1 },
			{ team_id: TEAM_ID, project_stage_id: STAGE_1 },
		],
		"comms.project_channels": CHANNELS,
		"org.teams": [{ id: TEAM_ID, name: " Northwind ", avatar_file_id: null }],
		"org.business_profiles": [{
			id: BUSINESS_ID,
			name: "Acme Ltd",
			slug: "acme",
			logo_file_id: null,
		}],
		"org.rpc.get_party_cards": PARTY_CARDS,
		...over,
	};
}
// #endregion

// #region isClientSideRole
Deno.test("isClientSideRole admits exactly the buying-side seats, case- and space-insensitively", () => {
	for (const role of ["client", "owner", "admin", "manager", " Owner ", "CLIENT"]) {
		assertEquals(isClientSideRole(role), true, role);
	}
	for (const role of ["freelancer", "assignee", "member", "guest", "", null, undefined]) {
		assertEquals(isClientSideRole(role), false, String(role));
	}
});
// #endregion

// #region Happy path
Deno.test("fetchProjectDetail maps a well-formed project onto a schema-valid ProjectDetail", async () => {
	await withPostgrest(happyRoutes(), async () => {
		const detail = await fetchProjectDetail(OWNER, SLUG);
		assert(detail);
		ProjectDetailSchema.parse(detail);

		assertEquals(detail.id, PROJECT_UUID);
		assertEquals(detail.slug, SLUG);
		assertEquals(detail.title, "Brand refresh");
		assertEquals(detail.description, "A refresh of the whole identity.");
		assertEquals(detail.structure, "standard");
		assertEquals(detail.viewerRole, "owner");
		assertEquals(detail.viewerIsClient, true);
		assertEquals(detail.typeLabel, "Project");
		assertEquals(detail.client, { name: "Acme Ltd", avatar: null, handle: "acme" });
		assertEquals(detail.bannerImage, null);
	});
});

Deno.test("fetchProjectDetail lists the owner once, first, then participants with mapped roles", async () => {
	await withPostgrest(happyRoutes(), async () => {
		const detail = await fetchProjectDetail(OWNER, SLUG);
		assert(detail);
		assertEquals(
			detail.members.map((m) => [m.id, m.party.name, m.role]),
			[
				[OWNER_ID, "Olive Owner", "owner"],
				["pp-free", "Fern", "freelancer"],
				["pp-biz", "Acme Ltd", "client"],
			],
		);
		assertEquals(detail.members[2].party.handle, "acme");
	});
});

Deno.test("fetchProjectDetail builds the channel tree: general, one shared room per stage, hired-team rooms", async () => {
	await withPostgrest(happyRoutes(), async () => {
		const detail = await fetchProjectDetail(OWNER, SLUG);
		assert(detail);
		assertEquals(detail.channels.general.map((c) => [c.id, c.kind]), [["c-general", "general"]]);

		// First writer wins per stage; a stage row with an empty name is numbered by position.
		assertEquals(
			detail.channels.stages.map((
				s,
			) => [s.id, s.slug, s.stageId, s.name, s.order, s.status, s.activity]),
			[
				["c-s1", "stg-discovery1", STAGE_1, "Discovery", 0, "active", null],
				["c-s2", "stg-delivery01", STAGE_2, "Stage 2", 1, "active", "revision_requested"],
			],
		);
		assertEquals(detail.channels.stages[0].channel.name, "Discovery");

		// The duplicated hired-team row folds; only the team's OWN room is listed under it (CH2).
		assertEquals(detail.channels.teams.length, 1);
		const [team] = detail.channels.teams;
		assertEquals(team.teamId, TEAM_ID);
		assertEquals(team.teamName, "Northwind");
		assertEquals(team.assignedStages, ["Discovery"]);
		assertEquals(team.channels.map((c) => [c.id, c.kind, c.sublabel]), [[
			"c-team",
			"team",
			"Discovery",
		]]);
		// The client-side room is the Business group's, named by its stage.
		assertEquals(detail.channels.business.map((c) => [c.id, c.kind, c.name, c.sublabel]), [[
			"c-biz",
			"business",
			"Discovery",
			null,
		]]);
		assertEquals(detail.channels.dms, []);
	});
});
// #endregion

// #region Read state and the Private Messages group (PROJECTS CH3)
Deno.test("a room is unread exactly when comms.unread_rooms names it, asked with the project's row id", async () => {
	await withPostgrest(
		happyRoutes({ "comms.rpc.unread_rooms": ["c-s1", "c-general"] }),
		async (calls) => {
			const detail = await fetchProjectDetail(OWNER, SLUG);
			assert(detail);
			ProjectDetailSchema.parse(detail);
			assertEquals(detail.channels.general.map((c) => c.unread), [true]);
			assertEquals(detail.channels.stages.map((s) => [s.id, s.channel.unread]), [["c-s1", true], [
				"c-s2",
				false,
			]]);
			const ask = calls.find((c) => c.rpc && c.name === "unread_rooms");
			assertEquals((ask?.body as { p_project_id?: string }).p_project_id, PROJECT_UUID);
		},
	);
});

Deno.test("a failed unread read marks no room unread rather than failing the project", async () => {
	await withPostgrest(
		happyRoutes({ "comms.rpc.unread_rooms": pgFail("42501", "permission denied", 403) }),
		async () => {
			const detail = await fetchProjectDetail(OWNER, SLUG);
			assert(detail);
			assertEquals(detail.channels.stages.map((s) => s.channel.unread), [false, false]);
		},
	);
});

/** The uuid of the `i`th thread in the Private Messages fixture. */
const threadId = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

Deno.test("the Private Messages group lists every stamped thread, past the RPCs' 200-id runs, groups included", async () => {
	const count = 230;
	const threads = Array.from({ length: count }, (_, k) => ({
		thread_id: threadId(k + 1),
		ref: `cht-abcdef${
			[...String(k + 1).padStart(4, "0")].map((d) => "23456789ab"[Number(d)]).join("")
		}`,
		kind: k === count - 1 ? "group" : "dm",
		title: k === count - 1 ? "Launch crew" : null,
		last_stamped_at: new Date(Date.UTC(2026, 10, 1) - k * 60_000).toISOString(),
	}));
	// The viewer deleted the second thread for themselves: no undeleted participant row comes back.
	const mine = threads.filter((_, k) => k !== 1).map((t) => ({
		thread_id: t.thread_id,
		last_read_at: null,
	}));
	await withPostgrest(
		happyRoutes({
			"comms.rpc.project_dm_threads": threads,
			"comms.dm_participants": (req: FakeRequest) => {
				const ids = (req.query.get("thread_id") ?? "").replace(/^in\.\(|\)$/g, "").split(",");
				return mine.filter((r) => ids.includes(r.thread_id));
			},
			"comms.rpc.dm_thread_roster": (req: FakeRequest) =>
				(req.body as { p_thread_ids: string[] }).p_thread_ids.flatMap((id) => [
					{ thread_id: id, user_id: OWNER_ID },
					{ thread_id: id, user_id: FREELANCER_ID },
					...(id === threadId(count)
						? [{ thread_id: id, user_id: "99999999-9999-4999-8999-999999999999" }]
						: []),
				]),
			"comms.rpc.inbox_tails": (req: FakeRequest) =>
				(req.body as { p_thread_ids: string[] }).p_thread_ids.map((id) => ({
					thread_id: id,
					sender_user_id: FREELANCER_ID,
					created_at: "2026-11-02T00:00:00.000Z",
				})),
			"org.rpc.get_party_cards": [
				...PARTY_CARDS,
				{
					user_id: "99999999-9999-4999-8999-999999999999",
					username: "cal",
					first_name: "Cal",
					last_name: null,
				},
			],
		}),
		async (calls) => {
			const detail = await fetchProjectDetail(OWNER, SLUG);
			assert(detail);
			ProjectDetailSchema.parse(detail);
			const dms = detail.channels.dms;
			assertEquals(dms.length, count - 1, "every thread but the one the viewer deleted");
			assert(!dms.some((d) => d.chatId === threads[1].ref));
			assert(dms.every((d) => d.unread), "a thread past the 200th still reads its tail");
			// The roster and the previews were each read in two runs, never truncated to the first 200.
			assertEquals(calls.filter((c) => c.rpc && c.name === "inbox_tails").length, 2);
			assertEquals(calls.filter((c) => c.rpc && c.name === "dm_thread_roster").length, 2);
			// Nothing scans stamped messages any more.
			assertEquals(calls.filter((c) => !c.rpc && c.name === "dm_messages").length, 0);

			const group = dms.find((d) => d.chatId === threads[count - 1].ref);
			assert(group?.group, "a group thread carries its group facts");
			assertEquals(group.group.title, "Launch crew");
			assertEquals(group.group.members.map((m) => m.name), ["Fern", "Cal"]);
			assertEquals(group.party.name, "Fern");
			const pair = dms.find((d) => d.chatId === threads[0].ref);
			assertEquals(pair?.group, undefined);
			assertEquals(pair?.party.name, "Fern");
		},
	);
});

Deno.test("dmRowUnread is the inbox's rule: somebody else wrote the newest message after the last read", () => {
	const me = OWNER_ID;
	const tail = (sender: string, at: string) => ({ sender_user_id: sender, created_at: at });
	assertEquals(dmRowUnread(null, null, me), false);
	assertEquals(dmRowUnread(tail(me, "2026-11-02T00:00:00Z"), null, me), false);
	assertEquals(dmRowUnread(tail(FREELANCER_ID, "2026-11-02T00:00:00Z"), null, me), true);
	assertEquals(
		dmRowUnread(tail(FREELANCER_ID, "2026-11-02T00:00:00Z"), "2026-11-03T00:00:00Z", me),
		false,
	);
	assertEquals(
		dmRowUnread(tail(FREELANCER_ID, "2026-11-04T00:00:00Z"), "2026-11-03T00:00:00Z", me),
		true,
	);
});
// #endregion

// #region Authorization-relevant reads
Deno.test("fetchProjectDetail answers null — after ONE read — for a slug RLS hides from this viewer", async () => {
	await withPostgrest(happyRoutes({ "projects.projects": [] }), async (calls) => {
		assertEquals(await fetchProjectDetail(OWNER, SLUG), null);
		assertEquals(calls.length, 1, "nothing else is read for a project the viewer cannot see");
	});
});

Deno.test("a hired freelancer is not the client side; a manager participant is", async () => {
	await withPostgrest(happyRoutes(), async () => {
		const detail = await fetchProjectDetail(actorOf(FREELANCER_ID), SLUG);
		assert(detail);
		assertEquals(detail.viewerIsClient, false);
	});
	await withPostgrest(
		happyRoutes({
			"projects.project_participants": [
				{ id: "pp-mgr", profile_type: "freelancer", profile_id: FREELANCER_ID, role: "manager" },
			],
		}),
		async () => {
			const detail = await fetchProjectDetail(actorOf(FREELANCER_ID), SLUG);
			assert(detail);
			assertEquals(detail.viewerIsClient, true);
			assertEquals(detail.members.find((m) => m.id === "pp-mgr")?.role, "admin");
		},
	);
});
// #endregion

// #region Degradation of secondary reads
Deno.test("withheld secondary reads (participants · hired teams · names) degrade instead of throwing", async () => {
	const denied = pgFail("42501", "permission denied", 403);
	await withPostgrest(
		happyRoutes({
			"projects.project_participants": denied,
			"projects.rpc.get_viewer_hired_teams": denied,
			"org.teams": denied,
			"org.business_profiles": denied,
			"org.rpc.get_party_cards": denied,
			"org.users_public": denied,
		}),
		async () => {
			const detail = await fetchProjectDetail(OWNER, SLUG);
			assert(detail);
			ProjectDetailSchema.parse(detail);
			assertEquals(detail.members.map((m) => m.role), ["owner"]);
			assertEquals(detail.members[0].party.name, "Unknown");
			assertEquals(detail.client, null, "an unnamed business is no client party, not a bare id");
			assertEquals(detail.channels.teams, []);
			assertEquals(detail.channels.stages.length, 2);
		},
	);
});

Deno.test("a failed DETAIL-row read drops the owner seat and viewerIsClient, while viewerRole still says owner", async () => {
	// Documents current behaviour: `fetchDetailRow` swallows its error, so `owner_user_id` resolves to
	// "" — the members list loses its owner and `resolveViewerIsClient` answers false for the owner
	// themselves, even though the summary read (a separate query) still reports `viewerRole: owner`.
	await withPostgrest(
		happyRoutes({
			"projects.projects": (req: FakeRequest) =>
				req.query.get("select")?.includes("description_text")
					? pgFail("57014", "canceling statement due to statement timeout", 500)
					: [PROJECT_ROW],
		}),
		async () => {
			const detail = await fetchProjectDetail(OWNER, SLUG);
			assert(detail);
			assertEquals(detail.viewerRole, "owner");
			assertEquals(detail.viewerIsClient, false);
			assertEquals(detail.description, "");
			assertEquals(detail.client, null);
			assertEquals(detail.members.some((m) => m.role === "owner"), false);
		},
	);
});
// #endregion

// #region Load-bearing failures THROW (documented contract; the service answers 503)
Deno.test("fetchProjectDetail THROWS when the project read fails", async () => {
	await withPostgrest(
		happyRoutes({ "projects.projects": pgFail("PGRST301", "JWT expired", 401) }),
		async () => {
			await assertRejects(
				() => fetchProjectDetail(OWNER, SLUG),
				Error,
				"projects.projects slug read failed: JWT expired",
			);
		},
	);
});

Deno.test("fetchProjectDetail THROWS when the stage read fails (42501)", async () => {
	await withPostgrest(
		happyRoutes({
			"projects.project_stages": (req: FakeRequest) =>
				req.query.get("select")?.includes("slug")
					? pgFail("42501", "permission denied for table project_stages", 403)
					: [],
		}),
		async () => {
			await assertRejects(
				() => fetchProjectDetail(OWNER, SLUG),
				Error,
				"projects.project_stages read failed",
			);
		},
	);
});

Deno.test("fetchProjectDetail THROWS when the channel read fails", async () => {
	await withPostgrest(
		happyRoutes({ "comms.project_channels": pgFail("XX000", "internal error", 500) }),
		async () => {
			await assertRejects(
				() => fetchProjectDetail(OWNER, SLUG),
				Error,
				"comms.project_channels read failed: internal error",
			);
		},
	);
});
// #endregion

// #region Viewer access (Decision #144)
const STRANGER_ID = "77777777-7777-4777-8777-777777777777";

/** What a viewer the project does not admit can read of it: the project row, its stages, nothing else. */
function strangerRoutes(over: Record<string, Route> = {}): Record<string, Route> {
	return happyRoutes({
		"projects.project_participants": [],
		"projects.rpc.get_viewer_hired_teams": [],
		"comms.project_channels": [],
		...over,
	});
}

Deno.test("access is the database's own predicate, asked with the project's row id", async () => {
	await withPostgrest(
		strangerRoutes({ "projects.rpc.has_project_access": true }),
		async (calls) => {
			const detail = await fetchProjectDetail(actorOf(STRANGER_ID), SLUG);
			assert(detail);
			assertEquals(detail.viewerAccess, "participant");
			const asked = calls.find((c) => c.rpc && c.name === "has_project_access");
			assert(asked, "has_project_access was never called");
			assertEquals(asked.schema, "projects");
			assertEquals(asked.body, { _project_id: PROJECT_UUID });
		},
	);
});

Deno.test("a viewer the predicate refuses is a prospect, though viewerRole still reads member", async () => {
	await withPostgrest(
		strangerRoutes({ "projects.rpc.has_project_access": false }),
		async () => {
			const detail = await fetchProjectDetail(actorOf(STRANGER_ID), SLUG);
			assert(detail);
			ProjectDetailSchema.parse(detail);
			assertEquals(detail.viewerAccess, "prospect");
			assertEquals(detail.viewerIsClient, false);
		},
	);
});

Deno.test("the client side is the owner whatever the predicate answers", async () => {
	await withPostgrest(happyRoutes({ "projects.rpc.has_project_access": false }), async () => {
		const detail = await fetchProjectDetail(OWNER, SLUG);
		assert(detail);
		assertEquals(detail.viewerAccess, "owner");
	});
});

Deno.test("a failed predicate falls back to the seat signals this read holds instead of guessing", async () => {
	const denied = pgFail("42501", "permission denied", 403);
	// A hire whose participant row is readable keeps their workspace when the RPC fails…
	await withPostgrest(happyRoutes({ "projects.rpc.has_project_access": denied }), async () => {
		const detail = await fetchProjectDetail(actorOf(FREELANCER_ID), SLUG);
		assert(detail);
		assertEquals(detail.viewerAccess, "participant");
	});
	// …and so does one who can enter a room, the signal left on a private project.
	await withPostgrest(
		strangerRoutes({
			"projects.rpc.has_project_access": denied,
			"comms.project_channels": [CHANNELS[0]],
		}),
		async () => {
			const detail = await fetchProjectDetail(actorOf(STRANGER_ID), SLUG);
			assert(detail);
			assertEquals(detail.viewerAccess, "participant");
		},
	);
	// With no signal at all, a failed predicate leaves a stranger a stranger.
	await withPostgrest(strangerRoutes({ "projects.rpc.has_project_access": denied }), async () => {
		const detail = await fetchProjectDetail(actorOf(STRANGER_ID), SLUG);
		assert(detail);
		assertEquals(detail.viewerAccess, "prospect");
	});
});
// #endregion
