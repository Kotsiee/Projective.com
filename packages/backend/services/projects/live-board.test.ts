import { assert, assertEquals, assertRejects } from "@std/assert";
import { BoardPageSchema } from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import {
	fetchBoardPage,
	fetchTicketLocation,
	STAGE_WINDOW_COLUMNS,
	type StageWindowRow,
	stageWindows,
} from "./live-board.ts";

/**
 * live-board_test — the board read and the ticket deep-link lookup against a fake PostgREST, plus the
 * pure stage-window resolver.
 *
 * Contract (module docblock): `null` is "no such row" (the caller's 404); a thrown `Error` naming the
 * table means a load-bearing query failed (project, stages, tickets) and the service's `liveRead`
 * falls back to fixtures; every SECONDARY lookup (currency, history, participants, assignments,
 * parties) degrades to a neutral value instead of throwing. The provider-visibility filter is applied
 * on the READ, so it is asserted here against what a freelancer is handed.
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
const PROJECT_UUID = "33333333-3333-4333-8333-333333333333";
const S1 = "44444444-4444-4444-8444-444444444441";
const S2 = "44444444-4444-4444-8444-444444444442";
const S3 = "44444444-4444-4444-8444-444444444443";
const T1 = "55555555-5555-4555-8555-555555555551";
const T2 = "55555555-5555-4555-8555-555555555552";
const T3 = "55555555-5555-4555-8555-555555555553";
const SLUG = "prj-b2ardpage2";
const S1_SLUG = "stg-dscvery222";

function actorOf(userId: string): ReadActor & { accessToken: string } {
	return { userId, contextId: "", contextType: "personal", accessToken: "XXXX-XXXX" };
}

const OWNER = actorOf(OWNER_ID);
const PROVIDER = actorOf(FREELANCER_ID);

/** One row answering every `projects.projects` read (summary, facts). */
const PROJECT_ROW = {
	id: PROJECT_UUID,
	slug: SLUG,
	title: "Brand refresh",
	format: "pipeline",
	status: "active",
	visibility: "unlisted",
	currency: "gbp",
	structure_variation: "standard",
	owner_user_id: OWNER_ID,
	owner_team_id: null,
	owner_organisation_id: null,
	client_business_id: null,
	source_blueprint_id: null,
	updated_at: "2026-10-01T00:00:00.000Z",
	last_activity_at: null,
};

function stage(id: string, over: Record<string, unknown> = {}) {
	return {
		id,
		slug: `stg-${id.slice(-1)}abcdefghj`,
		project_id: PROJECT_UUID,
		name: "Stage",
		description_text: null,
		sort_order: 0,
		status: "open",
		unit_price_cents: null,
		assignment_mode: null,
		max_concurrent_intensity: null,
		fixed_start_date: null,
		start_dependency_stage_id: null,
		start_dependency_lag_days: null,
		file_duration_mode: null,
		file_duration_days: null,
		file_due_date: null,
		...over,
	};
}

const STAGES = [
	stage(S1, {
		slug: S1_SLUG,
		name: "Discovery",
		sort_order: 0,
		unit_price_cents: "10000",
		assignment_mode: "manual",
		fixed_start_date: "2026-11-02T00:00:00.000Z",
		file_duration_mode: "relative_duration",
		file_duration_days: 5,
	}),
	stage(S2, {
		name: "Delivery",
		sort_order: 1,
		status: "in_progress",
		unit_price_cents: 20000,
		max_concurrent_intensity: -1,
		start_dependency_stage_id: S1,
		start_dependency_lag_days: 2,
	}),
	stage(S3, { name: null, sort_order: 2 }),
];

function ticket(id: string, over: Record<string, unknown> = {}) {
	return {
		id,
		slug: null,
		project_id: PROJECT_UUID,
		current_stage_id: null,
		current_assignee_id: null,
		owner_user_id: OWNER_ID,
		title: "Ticket",
		text_description: null,
		status: "backlog",
		priority: null,
		attachment_count: null,
		required_stages: [],
		tasks: [],
		due_date: null,
		workload_intensity: null,
		payment_status: null,
		unit_price_cents: null,
		sort_order: null,
		claimed_at: null,
		hidden_until: null,
		updated_at: "2026-10-03T09:15:00.000Z",
		...over,
	};
}

const TICKETS = [
	ticket(T1, {
		slug: "tkt-abcdefghjk",
		title: "Audit the type ramp",
		text_description: "  Check every heading.  ",
		current_stage_id: S1,
		current_assignee_id: FREELANCER_ID,
		status: "in_progress",
		priority: "urgent",
		attachment_count: "3",
		payment_status: "escrow_funded",
		// Stored out of order and with a gap: the read re-sorts and re-indexes.
		required_stages: [{ stage_id: S2, order: 5 }, { stage_id: S1, order: 1 }],
		tasks: [
			{ id: "k1", text: "Draft", done: true, completed_by: [FREELANCER_ID] },
			{ id: "k2", text: "   " },
			{ text: "Review", done: false },
		],
		workload_intensity: "2.5",
		hidden_until: "2099-01-01T00:00:00.000Z",
		claimed_at: "2026-10-02T00:00:00.000Z",
	}),
	ticket(T2, { title: null, priority: "high" }),
	// Points at a stage this viewer cannot read — it must land in New rather than vanish.
	ticket(T3, { title: "Orphan", current_stage_id: "99999999-9999-4999-8999-999999999999" }),
];

const HISTORY = [
	{
		id: "h2",
		ticket_id: T1,
		actor_id: FREELANCER_ID,
		action_type: "stage_moved",
		previous_stage_id: null,
		new_stage_id: S2,
		previous_status: null,
		new_status: null,
		changes: null,
		created_at: "2026-10-02T10:00:00.000Z",
	},
	{
		id: "h1",
		ticket_id: T1,
		actor_id: OWNER_ID,
		action_type: "created",
		previous_stage_id: null,
		new_stage_id: null,
		previous_status: null,
		new_status: null,
		changes: null,
		created_at: "2026-10-01T10:00:00.000Z",
	},
];

const PARTICIPANTS = [
	{
		project_id: PROJECT_UUID,
		profile_type: "freelancer",
		profile_id: FREELANCER_ID,
		role: "assignee",
	},
	{ project_id: PROJECT_UUID, profile_type: "business", profile_id: "biz-1", role: "client" },
];

const ASSIGNMENTS = [
	{
		project_stage_id: S2,
		assignee_type: "freelancer",
		freelancer_profile_id: FREELANCER_ID,
		status: "accepted",
	},
	{ project_stage_id: S1, assignee_type: "team", freelancer_profile_id: null, status: "assigned" },
];

const PARTY_CARDS = [
	{ user_id: OWNER_ID, username: "olive", first_name: "Olive", last_name: "Owner" },
	{ user_id: FREELANCER_ID, username: "fern", first_name: "Fern", last_name: null },
];

/** The full happy-path database for {@link SLUG}. */
function boardRoutes(over: Record<string, Route> = {}): Record<string, Route> {
	return {
		"projects.projects": [PROJECT_ROW],
		"projects.project_stages": (req: FakeRequest) =>
			req.query.get("select")?.includes("slug")
				? STAGES
				: STAGES.map((s) => ({ project_id: PROJECT_UUID, status: s.status })),
		"projects.tickets": TICKETS,
		"projects.ticket_history": HISTORY,
		"projects.project_participants": (req: FakeRequest) => {
			// `fetchViewerRoles` filters on the viewer server-side; honour it so roles are not invented.
			const viewer = req.query.get("profile_id");
			return viewer ? PARTICIPANTS.filter((p) => `eq.${p.profile_id}` === viewer) : PARTICIPANTS;
		},
		"projects.stage_assignments": ASSIGNMENTS,
		"org.rpc.get_party_cards": PARTY_CARDS,
		...over,
	};
}
// #endregion

// #region stageWindows (pure)
function windowRow(id: string, over: Partial<StageWindowRow> = {}): StageWindowRow {
	return {
		id,
		fixed_start_date: null,
		start_dependency_stage_id: null,
		start_dependency_lag_days: null,
		file_duration_mode: null,
		file_duration_days: null,
		file_due_date: null,
		...over,
	};
}

Deno.test("STAGE_WINDOW_COLUMNS names exactly the id and the six scheduling columns", () => {
	assertEquals(
		STAGE_WINDOW_COLUMNS,
		"id, fixed_start_date, start_dependency_stage_id, start_dependency_lag_days, file_duration_mode, file_duration_days, file_due_date",
	);
});

Deno.test("stageWindows resolves a fixed start, a relative duration and a fixed deadline", () => {
	const windows = stageWindows([
		windowRow("a", {
			fixed_start_date: "2026-11-02T00:00:00Z",
			file_duration_mode: "relative_duration",
			file_duration_days: "5",
		}),
		windowRow("b", {
			fixed_start_date: "2026-11-02T00:00:00Z",
			file_duration_mode: "fixed_deadline",
			file_due_date: "2026-11-20T00:00:00Z",
			file_duration_days: 99,
		}),
		windowRow("c", {
			fixed_start_date: "2026-11-02T00:00:00Z",
			file_duration_mode: "no_due_date",
			file_due_date: "2026-11-20T00:00:00Z",
		}),
	]);
	assertEquals(windows.get("a"), {
		startAt: "2026-11-02T00:00:00.000Z",
		endAt: "2026-11-07T00:00:00.000Z",
	});
	assertEquals(windows.get("b"), {
		startAt: "2026-11-02T00:00:00.000Z",
		endAt: "2026-11-20T00:00:00.000Z",
	});
	assertEquals(windows.get("c"), { startAt: "2026-11-02T00:00:00.000Z", endAt: null });
});

Deno.test("stageWindows chains dependencies regardless of row order, adding the lag", () => {
	// Listed child-first: the fixed point still resolves the whole chain.
	const windows = stageWindows([
		windowRow("c", { start_dependency_stage_id: "b", file_duration_days: 1 }),
		windowRow("b", {
			start_dependency_stage_id: "a",
			start_dependency_lag_days: 2,
			file_duration_days: 3,
		}),
		windowRow("a", { fixed_start_date: "2026-11-01T00:00:00Z", file_duration_days: 1 }),
	]);
	assertEquals(windows.get("a")?.endAt, "2026-11-02T00:00:00.000Z");
	assertEquals(windows.get("b"), {
		startAt: "2026-11-04T00:00:00.000Z",
		endAt: "2026-11-07T00:00:00.000Z",
	});
	assertEquals(windows.get("c"), {
		startAt: "2026-11-07T00:00:00.000Z",
		endAt: "2026-11-08T00:00:00.000Z",
	});
});

Deno.test("stageWindows leaves a dependency cycle and an end-less predecessor unresolved", () => {
	const windows = stageWindows([
		windowRow("x", { start_dependency_stage_id: "y", file_duration_days: 1 }),
		windowRow("y", { start_dependency_stage_id: "x", file_duration_days: 1 }),
		windowRow("open", { fixed_start_date: "2026-11-01T00:00:00Z" }),
		windowRow("after-open", { start_dependency_stage_id: "open" }),
		windowRow("garbage", { fixed_start_date: "not a date", file_due_date: "also not" }),
	]);
	assertEquals(windows.get("x"), { startAt: null, endAt: null });
	assertEquals(windows.get("y"), { startAt: null, endAt: null });
	assertEquals(windows.get("open"), { startAt: "2026-11-01T00:00:00.000Z", endAt: null });
	assertEquals(windows.get("after-open"), { startAt: null, endAt: null });
	assertEquals(windows.get("garbage"), { startAt: null, endAt: null });
});
// #endregion

// #region fetchBoardPage — happy path (client side)
Deno.test("fetchBoardPage maps a well-formed engagement onto a schema-valid BoardPage", async () => {
	await withPostgrest(boardRoutes(), async () => {
		const page = await fetchBoardPage(OWNER, { projectId: SLUG });
		assert(page);
		BoardPageSchema.parse(page);
		assertEquals(page.scope, "project");
		assertEquals(page.kind, "project");
		assertEquals(page.view, "stages");
		assertEquals(page.viewerIsClient, true);
		assertEquals(page.viewerStageIds, []);
		assertEquals(page.viewerId, OWNER_ID);
		assertEquals(page.workspaceKind, "personal");
		assertEquals(page.clientMembers, [], "a personal engagement has no seat selector");
		assertEquals(page.total, 3);
		assertEquals(page.cards.map((c) => c.id), [T1, T2, T3]);
	});
});

Deno.test("fetchBoardPage stage refs: order, price coercion, lock rule, roster, window and caps", async () => {
	await withPostgrest(boardRoutes(), async () => {
		const page = await fetchBoardPage(OWNER, { projectId: SLUG });
		assert(page);
		const [s1, s2, s3] = page.stages;
		assertEquals([s1.id, s2.id, s3.id], [S1, S2, S3]);
		assertEquals(s3.name, "Untitled stage");
		assertEquals(s1.unitPriceCents, 10_000, "a numeric string price is coerced, not zeroed");
		assertEquals(s1.assignmentMode, "manual");
		assertEquals(s2.assignmentMode, "open_pull");
		assertEquals(s2.maxConcurrentIntensity, null, "a negative cap reads as no cap");
		// S1 holds a (team) assignment, S2 is in progress, S3 is open and empty.
		assertEquals([s1.locked, s2.locked, s3.locked], [true, true, false]);
		assertEquals(s1.members, [], "a team assignment locks the stage but names nobody");
		assertEquals(s2.members.map((m) => m.handle), ["fern"]);
		assertEquals(s1.ticketCount, 1);
		assertEquals(s1.startAt, "2026-11-02T00:00:00.000Z");
		assertEquals(s1.endAt, "2026-11-07T00:00:00.000Z");
		assertEquals(s2.startAt, "2026-11-09T00:00:00.000Z", "S1's end plus a two-day lag");
		assertEquals(s2.dependsOnStageId, S1);
	});
});

Deno.test("fetchBoardPage card mapping: stages, funding, freeze, checklist, history and contributors", async () => {
	await withPostgrest(boardRoutes(), async () => {
		const page = await fetchBoardPage(OWNER, { projectId: SLUG });
		assert(page);
		const card = page.cards.find((c) => c.id === T1);
		assert(card);
		assertEquals(card.slug, "tkt-abcdefghjk");
		assertEquals(card.description, "Check every heading.");
		assertEquals(card.hasDescription, true);
		assertEquals(card.priority, "urgent");
		assertEquals(card.workload, 2.5);
		assertEquals(card.attachmentCount, 3);
		assertEquals(card.frozen, true);
		assertEquals(card.claimed, true);
		assertEquals(card.escrowHeld, true);
		assertEquals(card.paymentScope, "per_stage");
		assertEquals(card.paidStageIds, [S1]);
		assertEquals(card.assignee?.name, "Fern");
		assertEquals(card.owner?.name, "Olive Owner");

		// Required stages re-sorted by stored order and re-indexed 0..n.
		assertEquals(card.stages.map((s) => [s.stageId, s.name, s.order, s.unitPriceCents]), [
			[S1, "Discovery", 0, 10_000],
			[S2, "Delivery", 1, 20_000],
		]);
		assertEquals(card.budgetCents, card.stages.reduce((sum, s) => sum + (s.costCents ?? 0), 0));
		assert(
			card.budgetLabel?.includes("£"),
			`currency is GBP from the facts row: ${card.budgetLabel}`,
		);

		// A blank checklist step is dropped; a missing id is synthesised from the ticket id.
		assertEquals(card.tasks.map((t) => [t.text, t.done]), [["Draft", true], ["Review", false]]);
		assertEquals(card.tasks[1].id, `${T1}-task-2`);
		assertEquals(card.tasks[0].completedBy.map((p) => p.handle), ["fern"]);
		assertEquals([card.checklistDone, card.checklistTotal], [1, 2]);

		assertEquals(card.history.map((h) => [h.kind, h.summary]), [
			["stage", "moved it to the Delivery stage"],
			["created", "created this ticket"],
		]);
		// Oldest contributor first.
		assertEquals(card.contributors.map((p) => p.handle), ["olive", "fern"]);
	});
});

Deno.test("fetchBoardPage: a nameless ticket is titled, and a card in an unreadable stage lands in New", async () => {
	await withPostgrest(boardRoutes(), async () => {
		const page = await fetchBoardPage(OWNER, { projectId: SLUG });
		assert(page);
		const untitled = page.cards.find((c) => c.id === T2);
		assertEquals(untitled?.title, "Untitled ticket");
		assertEquals(untitled?.paymentScope, "unpaid");
		assertEquals(page.cards.find((c) => c.id === T3)?.stageId, null);
	});
});

Deno.test("fetchBoardPage applies query and priority filters after counting the full load", async () => {
	await withPostgrest(boardRoutes(), async () => {
		const page = await fetchBoardPage(OWNER, { projectId: SLUG, query: "AUDIT" });
		assert(page);
		assertEquals(page.cards.map((c) => c.id), [T1]);
		assertEquals(page.total, 1);
		assertEquals(page.stages[0].ticketCount, 1, "ticketCount ignores the search box");

		const high = await fetchBoardPage(OWNER, { projectId: SLUG, priority: "high" });
		assertEquals(high?.cards.map((c) => c.id), [T2]);
	});
});

Deno.test("fetchBoardPage scoped to a stage slug shows that stage's cards; an unknown slug shows none", async () => {
	await withPostgrest(boardRoutes(), async () => {
		const page = await fetchBoardPage(OWNER, { projectId: SLUG, channelId: S1_SLUG });
		assert(page);
		assertEquals(page.scope, "channel");
		assertEquals(page.kind, "stage");
		assertEquals(page.cards.map((c) => c.id), [T1]);

		const none = await fetchBoardPage(OWNER, { projectId: SLUG, channelId: "stg-zzzzzzzzzz" });
		assertEquals(none?.cards, []);
	});
});
// #endregion

// #region fetchBoardPage — authorization on the read
Deno.test("a provider is handed only paid tickets in stages they are onboarded to", async () => {
	await withPostgrest(boardRoutes(), async () => {
		const page = await fetchBoardPage(PROVIDER, { projectId: SLUG });
		assert(page);
		BoardPageSchema.parse(page);
		assertEquals(page.viewerIsClient, false);
		// S2 from the accepted assignment, S1 from the ticket they hold.
		assertEquals(page.viewerStageIds, [S2, S1]);
		// T1 is escrow-funded in S1; T2 is New (never a provider's); T3 sits nowhere they are seated.
		assertEquals(page.cards.map((c) => c.id), [T1]);
		assertEquals(page.total, 1);
	});
});

Deno.test("a provider whose assignment was declined or is pending funding is not onboarded by it", async () => {
	for (const status of ["declined", "pending_funding"]) {
		await withPostgrest(
			boardRoutes({
				"projects.stage_assignments": [
					{
						project_stage_id: S2,
						assignee_type: "freelancer",
						freelancer_profile_id: FREELANCER_ID,
						status,
					},
				],
				"projects.tickets": [ticket(T2, { current_stage_id: S2, payment_status: "released" })],
			}),
			async () => {
				const page = await fetchBoardPage(PROVIDER, { projectId: SLUG });
				assert(page);
				assertEquals(page.viewerStageIds, [], status);
				assertEquals(page.cards, [], "a fully paid ticket is still hidden outside their stages");
			},
		);
	}
});

Deno.test("CURRENT BEHAVIOUR: a CANCELLED assignment still onboards the provider and shows them paid tickets", async () => {
	// Documented, not endorsed. `countsAsOnboarded` is the setup surface's price-LOCK deny-list
	// (`declined`, `pending_funding`), where keeping `cancelled` is deliberate. The board reuses it for
	// VISIBILITY, so a freelancer whose seat was cancelled keeps reading that stage's paid tickets —
	// while this same read's roster (and live-members' HELD list) treat `cancelled` as seat given up.
	await withPostgrest(
		boardRoutes({
			"projects.stage_assignments": [
				{
					project_stage_id: S2,
					assignee_type: "freelancer",
					freelancer_profile_id: FREELANCER_ID,
					status: "cancelled",
				},
			],
			"projects.tickets": [ticket(T2, { current_stage_id: S2, payment_status: "released" })],
		}),
		async () => {
			const page = await fetchBoardPage(PROVIDER, { projectId: SLUG });
			assert(page);
			assertEquals(page.viewerStageIds, [S2]);
			assertEquals(page.cards.map((c) => c.id), [T2]);
			assertEquals(page.stages.find((s) => s.id === S2)?.members, [], "yet the roster drops them");
		},
	);
});

Deno.test("fetchBoardPage answers null — after ONE read — for a project RLS hides", async () => {
	await withPostgrest(boardRoutes({ "projects.projects": [] }), async (calls) => {
		assertEquals(await fetchBoardPage(OWNER, { projectId: SLUG }), null);
		assertEquals(calls.length, 1);
	});
});
// #endregion

// #region fetchBoardPage — failures
Deno.test("fetchBoardPage: failed secondary reads degrade (USD, no history, no rosters) instead of throwing", async () => {
	const denied = pgFail("42501", "permission denied", 403);
	await withPostgrest(
		boardRoutes({
			"projects.projects": (req: FakeRequest) =>
				req.query.get("select")?.includes("structure_variation") ? denied : [PROJECT_ROW],
			"projects.ticket_history": denied,
			"projects.project_participants": denied,
			"projects.stage_assignments": denied,
			"org.rpc.get_party_cards": denied,
			"org.users_public": denied,
		}),
		async () => {
			const page = await fetchBoardPage(OWNER, { projectId: SLUG });
			assert(page);
			BoardPageSchema.parse(page);
			const card = page.cards.find((c) => c.id === T1)!;
			assert(card.budgetLabel?.includes("$"), `currency falls back to USD: ${card.budgetLabel}`);
			assertEquals(card.history, []);
			assertEquals(card.assignee?.name, "Unknown");
			assertEquals(page.stages.every((s) => s.members.length === 0), true);
			// With no assignment rows S1 is no longer assignment-locked, but its ticket is in progress.
			assertEquals(page.stages.map((s) => s.locked), [true, true, false]);
		},
	);
});

Deno.test("fetchBoardPage THROWS when the tickets read fails (42501)", async () => {
	await withPostgrest(
		boardRoutes({
			"projects.tickets": pgFail("42501", "permission denied for table tickets", 403),
		}),
		async () => {
			await assertRejects(
				() => fetchBoardPage(OWNER, { projectId: SLUG }),
				Error,
				"projects.tickets read failed: permission denied for table tickets",
			);
		},
	);
});

Deno.test("fetchBoardPage THROWS when the stages read fails", async () => {
	await withPostgrest(
		boardRoutes({
			"projects.project_stages": (req: FakeRequest) =>
				req.query.get("select")?.includes("slug") ? pgFail("XX000", "internal error", 500) : [],
		}),
		async () => {
			await assertRejects(
				() => fetchBoardPage(OWNER, { projectId: SLUG }),
				Error,
				"projects.project_stages read failed: internal error",
			);
		},
	);
});

Deno.test("fetchBoardPage THROWS when the project read fails", async () => {
	await withPostgrest(
		boardRoutes({ "projects.projects": pgFail("PGRST301", "JWT expired", 401) }),
		async () => {
			await assertRejects(
				() => fetchBoardPage(OWNER, { projectId: SLUG }),
				Error,
				"projects.projects slug read failed",
			);
		},
	);
});
// #endregion

// #region fetchTicketLocation
Deno.test("fetchTicketLocation resolves a ticket slug to its project's slug in two reads", async () => {
	await withPostgrest({
		"projects.tickets": [{ project_id: PROJECT_UUID }],
		"projects.projects": [{ slug: SLUG }],
	}, async (calls) => {
		assertEquals(await fetchTicketLocation(OWNER, "tkt-abcdefghjk"), { projectSlug: SLUG });
		assertEquals(calls.map((c) => c.name), ["tickets", "projects"]);
		assertEquals(calls[0].query.get("slug"), "eq.tkt-abcdefghjk");
		assertEquals(calls[1].query.get("id"), `eq.${PROJECT_UUID}`);
	});
});

Deno.test("fetchTicketLocation refuses a malformed slug without a query, and answers null for a hidden ticket", async () => {
	await withPostgrest({ "projects.tickets": [] }, async (calls) => {
		assertEquals(await fetchTicketLocation(OWNER, "prj-abcdefghjk"), null);
		assertEquals(await fetchTicketLocation(OWNER, T1), null);
		assertEquals(calls.length, 0);
		// "No row" is the same answer for missing and not-yours (RLS), so a deep link cannot probe.
		assertEquals(await fetchTicketLocation(OWNER, "tkt-abcdefghjk"), null);
		assertEquals(calls.length, 1);
	});
	await withPostgrest({
		"projects.tickets": [{ project_id: PROJECT_UUID }],
		"projects.projects": [],
	}, async () => {
		assertEquals(await fetchTicketLocation(OWNER, "tkt-abcdefghjk"), null);
	});
});

Deno.test("fetchTicketLocation THROWS when either read fails", async () => {
	await withPostgrest({
		"projects.tickets": pgFail("42501", "permission denied for table tickets", 403),
	}, async () => {
		await assertRejects(
			() => fetchTicketLocation(OWNER, "tkt-abcdefghjk"),
			Error,
			"projects.tickets read failed",
		);
	});
	await withPostgrest({
		"projects.tickets": [{ project_id: PROJECT_UUID }],
		"projects.projects": pgFail("XX000", "internal error", 500),
	}, async () => {
		await assertRejects(
			() => fetchTicketLocation(OWNER, "tkt-abcdefghjk"),
			Error,
			"projects.projects read failed",
		);
	});
});
// #endregion
