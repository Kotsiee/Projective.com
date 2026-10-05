import { assert, assertEquals, assertRejects } from "@std/assert";
import { SentInvitesPageSchema } from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import { projectsDb } from "./live-support.ts";
import {
	applyInviteAction,
	fetchSentInvitations,
	forceInviteDecision,
	insertInvitations,
	inviteRefusalFrom,
	removeMemberRow,
	reopensAtFrom,
	resolveHandle,
	stageNameMap,
} from "./live-invites.ts";

/**
 * live-invites_test — the invitation write path against a fake PostgREST.
 *
 * The module's contract (its docblock) is: THROW on a genuine query failure, return `null` when the
 * subject does not resolve for this caller, and return `{ refusal }` for anything the database
 * refused in words a reader can act on. The fat service turns each of those into a 502 / 404 / the
 * refusal's own status. These tests pin all three arms, plus the three helpers another module
 * imports (`resolveHandle`, `inviteRefusalFrom`, `stageNameMap`).
 *
 * The fake sits at the HTTP boundary — `globalThis.fetch` — rather than replacing the client, so the
 * real supabase-js builder (and its `maybeSingle`/error parsing) is what the module talks to.
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

/** The value of a PostgREST filter (`eq.x`, `in.(a,b)`) on `column`, or `null`. */
function filterOf(req: FakeRequest, column: string): string | null {
	return req.query.get(column);
}

/** Silence the unmapped-failure log `refusalFrom` writes, while a test asserts the mapping. */
async function quietly<T>(run: () => Promise<T> | T): Promise<T> {
	const real = console.error;
	console.error = () => {};
	try {
		return await run();
	} finally {
		console.error = real;
	}
}
// #endregion

// #region Fixtures
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const SELLER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_UUID = "33333333-3333-4333-8333-333333333333";
const STAGE_A = "44444444-4444-4444-8444-444444444444";
const STAGE_B = "55555555-5555-4555-8555-555555555555";
const INVITE_ID = "66666666-6666-4666-8666-666666666666";
const MEMBER_ID = "77777777-7777-4777-8777-777777777777";
const SLUG = "prj-invites001";
const NOW = Date.parse("2026-10-05T12:00:00.000Z");

const OWNER: ReadActor & { accessToken: string } = {
	userId: OWNER_ID,
	contextId: "",
	contextType: "personal",
	accessToken: "XXXX-XXXX",
};

const PROJECT_ROW = {
	id: PROJECT_UUID,
	slug: SLUG,
	title: "Brand refresh",
	status: "active",
	currency: "GBP",
};

/** A `project_invitations` row as `fetchInvitations` selects it. */
function invitationRow(over: Record<string, unknown> = {}) {
	return {
		id: INVITE_ID,
		project_stage_id: STAGE_A,
		target_email: null,
		target_user_id: SELLER_ID,
		role: "freelancer",
		inviter_user_id: OWNER_ID,
		status: "pending",
		created_at: "2026-10-04T12:00:00.000Z",
		expires_at: "2026-10-20T12:00:00.000Z",
		accepted_at: null,
		declined_at: null,
		dismissed_at: null,
		placeholder: false,
		...over,
	};
}

const PARTY_CARDS = [
	{ user_id: OWNER_ID, username: "olive", first_name: "Olive", last_name: "Owner" },
	{ user_id: SELLER_ID, username: "sam", first_name: "Sam", last_name: "Seller" },
];

const HIRE = {
	projectId: SLUG,
	handle: "@Sam",
	stages: [{ stageId: STAGE_A, priceCents: 12_500 }],
	taskPriceCents: null,
	message: "Join us",
	answers: [],
} as unknown as Parameters<typeof insertInvitations>[1];

const OFFER_ONE_STAGE = { stages: [{ stageId: STAGE_A }] } as unknown as Parameters<
	typeof insertInvitations
>[2];
// #endregion

// #region resolveHandle
Deno.test("resolveHandle strips the @, compares lowercase and prefers the exact lowercase row", async () => {
	await withPostgrest({
		"org.users_public": [
			{ user_id: "u-mixed", username: "Sam" },
			{ user_id: SELLER_ID, username: "sam" },
		],
	}, async (calls) => {
		assertEquals(await resolveHandle(OWNER, "@@Sam "), SELLER_ID);
		assertEquals(calls.length, 1);
		assertEquals(calls[0].schema, "org");
		// Both spellings are asked for, so a legacy mixed-case row still resolves.
		assertEquals(filterOf(calls[0], "username"), "in.(sam,Sam)");
		assertEquals(calls[0].query.get("limit"), "2");
	});
});

Deno.test("resolveHandle falls back to the first row when no row matches the lowercase form", async () => {
	await withPostgrest(
		{ "org.users_public": [{ user_id: "u-mixed", username: "Sam" }] },
		async () => {
			assertEquals(await resolveHandle(OWNER, "Sam"), "u-mixed");
		},
	);
});

Deno.test("resolveHandle answers null for an unknown handle, and for a bare @ without a query", async () => {
	await withPostgrest({ "org.users_public": [] }, async (calls) => {
		assertEquals(await resolveHandle(OWNER, "@nobody"), null);
		assertEquals(await resolveHandle(OWNER, "@@  "), null);
		assertEquals(calls.length, 1, "an empty handle never reaches the database");
	});
});

Deno.test("resolveHandle THROWS on a refused read (42501) — the module's documented outage contract", async () => {
	await withPostgrest({
		"org.users_public": pgFail("42501", "permission denied for table users_public", 403),
	}, async () => {
		await assertRejects(
			() => resolveHandle(OWNER, "@sam"),
			Error,
			"org.users_public read failed: permission denied for table users_public",
		);
	});
});
// #endregion

// #region inviteRefusalFrom · reopensAtFrom
Deno.test("inviteRefusalFrom: a duplicate open seat is a 409 pinned to stages, with the ERROR: prefix stripped", () => {
	for (
		const message of [
			"ERROR: An invitation is already pending for this stage.",
			"This freelancer is already assigned to that stage.",
			"They are already on the project.",
		]
	) {
		const refusal = inviteRefusalFrom(message);
		assertEquals(refusal.status, 409, message);
		assertEquals(refusal.errors, { stages: "duplicate" });
		assert(!refusal.message.startsWith("ERROR:"));
	}
});

Deno.test("inviteRefusalFrom: the 48-day cooldown is a 422 carrying the reopening instant from DETAIL", () => {
	const refusal = inviteRefusalFrom(
		"You can invite this freelancer to this project again after 2026-11-01.",
		"reopens_at=2026-11-01T09:30:00+00:00",
	);
	assertEquals(refusal.status, 422);
	assertEquals(refusal.errors, { projectId: "cooldown" });
	assertEquals(refusal.details, { reopensAt: "2026-11-01T09:30:00.000Z" });

	// A DETAIL that does not parse is carried as null, never as an invented date.
	const vague = inviteRefusalFrom(
		"You can invite this freelancer to this project again after a while.",
		"reopens_at=soon",
	);
	assertEquals(vague.details, { reopensAt: null });
});

Deno.test("inviteRefusalFrom: a foreign stage is unknown_stage; a closed project is refused", () => {
	const foreign = inviteRefusalFrom("That stage is not part of this project.");
	assertEquals(foreign.status, 422);
	assertEquals(foreign.errors, { stages: "unknown_stage" });

	for (
		const message of [
			"This project is closed to new invitations.",
			"They are already on this project.",
			"owner is not a role an invitation can carry",
		]
	) {
		const refusal = inviteRefusalFrom(message);
		assertEquals(refusal.status, 422, message);
		assertEquals(refusal.errors, { projectId: "refused" });
	}
});

Deno.test("inviteRefusalFrom: an ownership refusal falls through to refusalFrom's 403 in the database's words", () => {
	const refusal = inviteRefusalFrom("Only the project owner may invite people.");
	assertEquals(refusal.status, 403);
	assertEquals(refusal.message, "Only the project owner may invite people.");
	assertEquals(refusal.errors, { projectId: "not_permitted" });
});

Deno.test("inviteRefusalFrom: an expired token is a 401 and an unknown failure a generic 502", async () => {
	const stale = inviteRefusalFrom("JWT expired");
	assertEquals(stale.status, 401);
	assertEquals(stale.errors, { projectId: "session_expired" });

	const unknown = await quietly(() => inviteRefusalFrom("deadlock detected"));
	assertEquals(unknown.status, 502);
	assertEquals(unknown.errors, { projectId: "write_failed" });
	assert(!unknown.message.includes("deadlock"), "internal wording never reaches the caller");

	const permanent = await quietly(() => inviteRefusalFrom("permission denied for table x"));
	assertEquals(permanent.status, 500);
	assertEquals(permanent.errors, { projectId: "write_blocked" });
});

Deno.test("reopensAtFrom reads only a parseable reopens_at=… token", () => {
	assertEquals(reopensAtFrom("reopens_at=2026-12-24T00:00:00Z extra"), "2026-12-24T00:00:00.000Z");
	assertEquals(reopensAtFrom("nothing here"), null);
	assertEquals(reopensAtFrom("reopens_at=not-a-date"), null);
	assertEquals(reopensAtFrom(null), null);
	assertEquals(reopensAtFrom(undefined), null);
});
// #endregion

// #region stageNameMap
Deno.test("stageNameMap maps id → name, scoped to the project, with a fallback and a clamp", async () => {
	await withPostgrest({
		"projects.project_stages": [
			{ id: STAGE_A, name: "Discovery" },
			{ id: STAGE_B, name: null },
			{ id: "s-long", name: "x".repeat(300) },
		],
	}, async (calls) => {
		const names = await stageNameMap(projectsDb(OWNER), PROJECT_UUID);
		assertEquals(names.get(STAGE_A), "Discovery");
		assertEquals(names.get(STAGE_B), "Untitled stage");
		assertEquals(names.get("s-long")?.length, 120);
		assertEquals(calls[0].schema, "projects");
		assertEquals(filterOf(calls[0], "project_id"), `eq.${PROJECT_UUID}`);
	});
});

Deno.test("stageNameMap degrades to an empty map on a failed read instead of throwing", async () => {
	await withPostgrest({
		"projects.project_stages": pgFail("42501", "permission denied for table project_stages", 403),
	}, async () => {
		const names = await stageNameMap(projectsDb(OWNER), PROJECT_UUID);
		assertEquals(names.size, 0);
	});
});
// #endregion

// #region insertInvitations
Deno.test("insertInvitations issues one RPC per offered stage and returns the re-read queue rows", async () => {
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"org.users_public": [{ user_id: SELLER_ID, username: "sam" }],
		"projects.rpc.invite_to_project": INVITE_ID,
		"projects.project_stages": [{ id: STAGE_A, name: "Discovery" }],
		"projects.project_invitations": [invitationRow()],
		"org.rpc.get_party_cards": PARTY_CARDS,
	}, async (calls) => {
		const outcome = await insertInvitations(OWNER, HIRE, OFFER_ONE_STAGE, NOW);
		assert(outcome && "data" in outcome);
		assertEquals(outcome.data.projectId, PROJECT_UUID);
		assertEquals(outcome.data.targetUserId, SELLER_ID);
		assertEquals(outcome.data.invites.length, 1);
		const [invite] = outcome.data.invites;
		assertEquals(invite.id, INVITE_ID);
		assertEquals(invite.handle, "@sam");
		assertEquals(invite.stageName, "Discovery");
		assertEquals(invite.invitedBy, "Olive Owner");
		assertEquals(invite.status, "pending");

		const rpc = calls.find((c) => c.rpc && c.name === "invite_to_project");
		assert(rpc);
		assertEquals(rpc.body, {
			p_project_id: PROJECT_UUID,
			p_stage_id: STAGE_A,
			p_target_user_id: SELLER_ID,
			p_role: "freelancer",
			p_message: "Join us",
			p_offer_price_cents: 12_500,
			p_answers: [],
		});
	});
});

Deno.test("insertInvitations answers null for a project this caller cannot see", async () => {
	await withPostgrest({ "projects.projects": [] }, async () => {
		assertEquals(await insertInvitations(OWNER, HIRE, OFFER_ONE_STAGE, NOW), null);
	});
});

Deno.test("insertInvitations refuses an unknown handle with a 404 naming it", async () => {
	await withPostgrest({ "projects.projects": [PROJECT_ROW], "org.users_public": [] }, async () => {
		const outcome = await insertInvitations(OWNER, HIRE, OFFER_ONE_STAGE, NOW);
		assert(outcome && "refusal" in outcome);
		assertEquals(outcome.refusal.status, 404);
		assertEquals(outcome.refusal.message, 'No profile found for "@Sam".');
	});
});

Deno.test("insertInvitations maps a P0001 duplicate raise to a 409 refusal instead of throwing", async () => {
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"org.users_public": [{ user_id: SELLER_ID, username: "sam" }],
		"projects.rpc.invite_to_project": pgFail(
			"P0001",
			"An invitation is already pending for this stage.",
		),
	}, async () => {
		const outcome = await insertInvitations(OWNER, HIRE, OFFER_ONE_STAGE, NOW);
		assert(outcome && "refusal" in outcome);
		assertEquals(outcome.refusal.status, 409);
		assertEquals(outcome.refusal.errors, { stages: "duplicate" });
	});
});

Deno.test("insertInvitations maps a 42501 ownership raise to a 403 refusal", async () => {
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"org.users_public": [{ user_id: SELLER_ID, username: "sam" }],
		"projects.rpc.invite_to_project": pgFail(
			"42501",
			"Only the project owner may invite people.",
			403,
		),
	}, async () => {
		const outcome = await insertInvitations(OWNER, HIRE, OFFER_ONE_STAGE, NOW);
		assert(outcome && "refusal" in outcome);
		assertEquals(outcome.refusal.status, 403);
	});
});

Deno.test("insertInvitations refuses a non-uuid stage before any RPC is issued", async () => {
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"org.users_public": [{ user_id: SELLER_ID, username: "sam" }],
	}, async (calls) => {
		const offer = { stages: [{ stageId: "stage-0" }] } as unknown as typeof OFFER_ONE_STAGE;
		const outcome = await insertInvitations(OWNER, HIRE, offer, NOW);
		assert(outcome && "refusal" in outcome);
		assertEquals(outcome.refusal.status, 422);
		assertEquals(outcome.refusal.errors, { stages: "not_allowed" });
		assertEquals(calls.filter((c) => c.rpc && c.name === "invite_to_project").length, 0);
	});
});

Deno.test("insertInvitations reports an issued-but-unreadable invitation as a placeholder row", async () => {
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"org.users_public": [{ user_id: SELLER_ID, username: "sam" }],
		"projects.rpc.invite_to_project": INVITE_ID,
		"projects.project_invitations": pgFail("42501", "permission denied", 403),
	}, async () => {
		const outcome = await insertInvitations(OWNER, HIRE, OFFER_ONE_STAGE, NOW);
		assert(outcome && "data" in outcome);
		assertEquals(outcome.data.invites.map((i) => [i.id, i.handle, i.invitedLabel]), [
			[INVITE_ID, "@Sam", "Just now"],
		]);
	});
});

Deno.test("insertInvitations THROWS when the project lookup itself fails (outage, not a miss)", async () => {
	await withPostgrest({
		"projects.projects": pgFail("XX000", "connection reset", 503),
	}, async () => {
		await assertRejects(
			() => insertInvitations(OWNER, HIRE, OFFER_ONE_STAGE, NOW),
			Error,
			"projects.projects slug read failed",
		);
	});
});
// #endregion

// #region applyInviteAction
Deno.test("applyInviteAction cancels a pending invitation with a status-guarded UPDATE", async () => {
	const keyRow = invitationRow();
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"projects.project_invitations": (req: FakeRequest) =>
			req.method === "PATCH" ? [{ id: INVITE_ID }] : [keyRow],
	}, async (calls) => {
		const outcome = await applyInviteAction(OWNER, {
			projectId: SLUG,
			inviteId: INVITE_ID,
			action: "cancel",
		});
		assertEquals(outcome, { data: null });
		const patch = calls.find((c) => c.method === "PATCH");
		assert(patch);
		assertEquals(patch.body, { status: "revoked" });
		assertEquals(filterOf(patch, "status"), "eq.pending");
	});
});

Deno.test("applyInviteAction: an UPDATE that RLS filtered to zero rows is a 403, not a success", async () => {
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"projects.project_invitations": (req: FakeRequest) =>
			req.method === "PATCH" ? [] : [invitationRow()],
	}, async () => {
		const outcome = await applyInviteAction(OWNER, {
			projectId: SLUG,
			inviteId: INVITE_ID,
			action: "cancel",
		});
		assert(outcome && "refusal" in outcome);
		assertEquals(outcome.refusal.status, 403);
		assertEquals(outcome.refusal.errors, { inviteId: "not_permitted" });
	});
});

Deno.test("applyInviteAction maps an UPDATE error to a refusal rather than throwing", async () => {
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"projects.project_invitations": (req: FakeRequest) =>
			req.method === "PATCH"
				? pgFail("42501", "new row violates row-level security policy: insufficient_privilege", 403)
				: [invitationRow()],
	}, async () => {
		const outcome = await applyInviteAction(OWNER, {
			projectId: SLUG,
			inviteId: INVITE_ID,
			action: "cancel",
		});
		assert(outcome && "refusal" in outcome);
		assertEquals(outcome.refusal.status, 403);
	});
});

Deno.test("applyInviteAction refuses to cancel an answered invitation and to dismiss an open one", async () => {
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"projects.project_invitations": [invitationRow({ status: "accepted" })],
	}, async () => {
		const outcome = await applyInviteAction(OWNER, {
			projectId: SLUG,
			inviteId: INVITE_ID,
			action: "cancel",
		});
		assert(outcome && "refusal" in outcome);
		assertEquals(outcome.refusal.status, 409);
		assertEquals(outcome.refusal.errors, { inviteId: "not_pending" });
	});
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"projects.project_invitations": [invitationRow()],
	}, async () => {
		const outcome = await applyInviteAction(OWNER, {
			projectId: SLUG,
			inviteId: INVITE_ID,
			action: "dismiss",
		});
		assert(outcome && "refusal" in outcome);
		assertEquals(outcome.refusal.errors, { inviteId: "still_pending" });
	});
});

Deno.test("applyInviteAction: an already-dismissed record is an idempotent no-op", async () => {
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"projects.project_invitations": [
			invitationRow({ status: "declined", dismissed_at: "2026-10-01T00:00:00Z" }),
		],
	}, async (calls) => {
		const outcome = await applyInviteAction(OWNER, {
			projectId: SLUG,
			inviteId: INVITE_ID,
			action: "dismiss",
		});
		assertEquals(outcome, { data: null });
		assertEquals(calls.some((c) => c.method === "PATCH"), false);
	});
});

Deno.test("applyInviteAction: a non-uuid or unseen invitation is a plain miss (null)", async () => {
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"projects.project_invitations": [],
	}, async () => {
		assertEquals(
			await applyInviteAction(OWNER, { projectId: SLUG, inviteId: "inv-1", action: "cancel" }),
			null,
		);
		assertEquals(
			await applyInviteAction(OWNER, { projectId: SLUG, inviteId: INVITE_ID, action: "cancel" }),
			null,
		);
	});
});

Deno.test("applyInviteAction THROWS when the invitation pre-check read fails", async () => {
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"projects.project_invitations": pgFail(
			"57014",
			"canceling statement due to statement timeout",
			500,
		),
	}, async () => {
		await assertRejects(
			() => applyInviteAction(OWNER, { projectId: SLUG, inviteId: INVITE_ID, action: "cancel" }),
			Error,
			"projects.project_invitations read failed",
		);
	});
});
// #endregion

// #region forceInviteDecision
Deno.test("forceInviteDecision refuses a caller who is not the inviter before the service role is touched", async () => {
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"projects.project_invitations": [invitationRow({ inviter_user_id: SELLER_ID })],
	}, async (calls) => {
		const outcome = await forceInviteDecision(OWNER, {
			projectId: SLUG,
			inviteId: INVITE_ID,
			decision: "accept",
		}, NOW);
		assert(outcome && "refusal" in outcome);
		assertEquals(outcome.refusal.status, 403);
		assertEquals(calls.some((c) => c.rpc), false);
	});
});

Deno.test("forceInviteDecision refuses an answered or email-addressed invitation", async () => {
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"projects.project_invitations": [invitationRow({ status: "declined" })],
	}, async () => {
		const outcome = await forceInviteDecision(OWNER, {
			projectId: SLUG,
			inviteId: INVITE_ID,
			decision: "accept",
		}, NOW);
		assert(outcome && "refusal" in outcome);
		assertEquals(outcome.refusal.status, 409);
	});
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"projects.project_invitations": [invitationRow({ target_user_id: null })],
	}, async () => {
		const outcome = await forceInviteDecision(OWNER, {
			projectId: SLUG,
			inviteId: INVITE_ID,
			decision: "decline",
		}, NOW);
		assert(outcome && "refusal" in outcome);
		assertEquals(outcome.refusal.errors, { inviteId: "email_addressed" });
	});
});

Deno.test("forceInviteDecision records the answer AS THE INVITEE and returns the re-read row", async () => {
	const accepted = invitationRow({ status: "accepted", accepted_at: "2026-10-05T11:00:00Z" });
	let decided = false;
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"projects.project_invitations": (req: FakeRequest) =>
			filterOf(req, "id") ? [invitationRow()] : decided ? [accepted] : [],
		"projects.rpc.fn_apply_invitation_decision": () => {
			decided = true;
			return null;
		},
		"org.rpc.get_party_cards": PARTY_CARDS,
	}, async (calls) => {
		const outcome = await forceInviteDecision(OWNER, {
			projectId: SLUG,
			inviteId: INVITE_ID,
			decision: "accept",
		}, NOW);
		assert(outcome && "data" in outcome);
		assertEquals(outcome.data?.status, "accepted");
		const rpc = calls.find((c) => c.name === "fn_apply_invitation_decision");
		assertEquals(rpc?.body, {
			p_invitation_id: INVITE_ID,
			p_accept: true,
			p_actor: SELLER_ID,
		});
	});
});

Deno.test("forceInviteDecision maps an RPC failure to a refusal", async () => {
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"projects.project_invitations": [invitationRow()],
		"projects.rpc.fn_apply_invitation_decision": pgFail(
			"P0001",
			"This invitation can no longer change state.",
		),
	}, async () => {
		const outcome = await forceInviteDecision(OWNER, {
			projectId: SLUG,
			inviteId: INVITE_ID,
			decision: "accept",
		}, NOW);
		assert(outcome && "refusal" in outcome);
		assertEquals(outcome.refusal.status, 422);
		assertEquals(outcome.refusal.errors, { inviteId: "not_allowed" });
	});
});
// #endregion

// #region removeMemberRow
Deno.test("removeMemberRow returns the RPC's applied counts, floored at zero", async () => {
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"projects.rpc.remove_project_member": {
			participant_id: MEMBER_ID,
			removed_from: "stage",
			claimed_tickets: 2,
			submitted_tickets: -1,
			started_stages: null,
		},
	}, async (calls) => {
		const outcome = await removeMemberRow(
			OWNER,
			{
				projectId: SLUG,
				memberId: MEMBER_ID,
				stageId: STAGE_A,
			} as Parameters<typeof removeMemberRow>[1],
		);
		assert(outcome && "data" in outcome);
		assertEquals(outcome.data, {
			memberId: MEMBER_ID,
			removedFrom: "stage",
			impact: { claimedTickets: 2, submittedTickets: 0, startedStages: 0 },
		});
		assertEquals(calls.find((c) => c.rpc)?.body, {
			p_project_id: PROJECT_UUID,
			p_participant_id: MEMBER_ID,
			p_stage_id: STAGE_A,
		});
	});
});

Deno.test("removeMemberRow: 'not on this project' is a miss (null); other raises are refusals", async () => {
	const input = { projectId: SLUG, memberId: MEMBER_ID, stageId: null } as Parameters<
		typeof removeMemberRow
	>[1];
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"projects.rpc.remove_project_member": pgFail("P0002", "That person is not on this project."),
	}, async () => {
		assertEquals(await removeMemberRow(OWNER, input), null);
	});
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"projects.rpc.remove_project_member": pgFail(
			"42501",
			"Only the project owner may remove members.",
			403,
		),
	}, async () => {
		const outcome = await removeMemberRow(OWNER, input);
		assert(outcome && "refusal" in outcome);
		assertEquals(outcome.refusal.status, 403);
		assertEquals(outcome.refusal.errors, { memberId: "not_permitted" });
	});
});

Deno.test("removeMemberRow: an RPC that returns nothing is a refusal, not a fabricated success", async () => {
	await withPostgrest({
		"projects.projects": [PROJECT_ROW],
		"projects.rpc.remove_project_member": null,
	}, async () => {
		const outcome = await quietly(() =>
			removeMemberRow(
				OWNER,
				{ projectId: SLUG, memberId: MEMBER_ID, stageId: null } as Parameters<
					typeof removeMemberRow
				>[1],
			)
		);
		assert(outcome && "refusal" in outcome);
		assertEquals(outcome.refusal.status, 502);
	});
});

Deno.test("removeMemberRow screens malformed ids before the RPC", async () => {
	await withPostgrest({ "projects.projects": [PROJECT_ROW] }, async (calls) => {
		assertEquals(
			await removeMemberRow(
				OWNER,
				{ projectId: SLUG, memberId: "owner:x", stageId: null } as Parameters<
					typeof removeMemberRow
				>[1],
			),
			null,
		);
		const outcome = await removeMemberRow(
			OWNER,
			{
				projectId: SLUG,
				memberId: MEMBER_ID,
				stageId: "stage-0",
			} as Parameters<typeof removeMemberRow>[1],
		);
		assert(outcome && "refusal" in outcome);
		assertEquals(outcome.refusal.errors, { stageId: "not_allowed" });
		assertEquals(calls.some((c) => c.rpc), false);
	});
});
// #endregion

// #region fetchSentInvitations
Deno.test("fetchSentInvitations groups each owned project's queue and totals across them", async () => {
	await withPostgrest({
		"projects.projects": [PROJECT_ROW, {
			...PROJECT_ROW,
			id: "p-2",
			slug: "prj-empty00001",
			title: null,
		}],
		"projects.project_stages": [{ id: STAGE_A, name: "Discovery" }],
		"projects.project_invitations": (req: FakeRequest) =>
			filterOf(req, "project_id") === `eq.${PROJECT_UUID}` ? [invitationRow()] : [],
		"org.rpc.get_party_cards": PARTY_CARDS,
	}, async (calls) => {
		const page = await fetchSentInvitations(OWNER, NOW);
		SentInvitesPageSchema.parse(page);
		assertEquals(page.total, 1);
		assertEquals(page.projects.map((p) => [p.id, p.title, p.invites.length]), [
			[SLUG, "Brand refresh", 1],
			["prj-empty00001", "Untitled project", 0],
		]);
		const projectsRead = calls.find((c) => c.name === "projects");
		assertEquals(filterOf(projectsRead!, "owner_user_id"), `eq.${OWNER_ID}`);
		assertEquals(filterOf(projectsRead!, "status"), "neq.archived");
	});
});

Deno.test("fetchSentInvitations THROWS when the owned-projects read fails", async () => {
	await withPostgrest({
		"projects.projects": pgFail("42501", "permission denied for table projects", 403),
	}, async () => {
		await assertRejects(
			() => fetchSentInvitations(OWNER, NOW),
			Error,
			"projects.projects read failed",
		);
	});
});
// #endregion
