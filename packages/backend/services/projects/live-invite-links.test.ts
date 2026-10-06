import { assert, assertEquals } from "@std/assert";
import type { ReadActor } from "../read-actor.ts";
import {
	actOnStageInviteLink,
	fetchStageInviteLink,
	redeemInviteLinkLive,
	resolveInviteLinkLive,
} from "./live-invite-links.ts";

/**
 * live-invite-links_test — the stage invite link's live path against a fake PostgREST (Decision #145):
 * a stage that is not the project's resolves to nothing, each act reaches its definer door with the
 * stage the URL named, and the redeem door's refusals keep their status and sentence.
 */

// #region Fake PostgREST
interface FakeRequest {
	method: string;
	name: string;
	rpc: boolean;
	query: URLSearchParams;
	body: unknown;
}

interface PgFailure {
	failure: true;
	status: number;
	body: { code: string; message: string; details: string | null; hint: null };
}

function pgFail(
	code: string,
	message: string,
	status: number,
	details: string | null = null,
): PgFailure {
	return { failure: true, status, body: { code, message, details, hint: null } };
}

function isFailure(value: unknown): value is PgFailure {
	return typeof value === "object" && value !== null && "failure" in value;
}

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_ANON_KEY"] as const;

async function withPostgrest<T>(
	routes: Record<string, unknown>,
	body: (calls: FakeRequest[]) => Promise<T>,
): Promise<T> {
	const calls: FakeRequest[] = [];
	const realFetch = globalThis.fetch;
	const saved = ENV_KEYS.map((key) => [key, Deno.env.get(key)] as const);
	Deno.env.set("SUPABASE_URL", "http://postgrest.fake");
	Deno.env.set("SUPABASE_ANON_KEY", "XXXX-XXXX");
	const json = (payload: unknown, status: number) =>
		new Response(JSON.stringify(payload), {
			status,
			headers: { "content-type": "application/json", "content-range": "*/*" },
		});

	globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		const path = url.pathname.replace(/^\/rest\/v1\//, "");
		const rpc = path.startsWith("rpc/");
		const name = rpc ? path.slice(4) : path;
		const text = await request.text();
		calls.push({
			method: request.method,
			name,
			rpc,
			query: url.searchParams,
			body: text ? JSON.parse(text) : null,
		});
		const key = rpc ? `rpc.${name}` : name;
		const answer = key in routes ? routes[key] : (rpc ? null : []);
		if (isFailure(answer)) return json(answer.body, answer.status);
		if ((request.headers.get("accept") ?? "").includes("vnd.pgrst.object")) {
			const rows = Array.isArray(answer) ? answer : [answer];
			return rows.length === 1
				? json(rows[0], 200)
				: json({ code: "PGRST116", message: "no rows", details: null, hint: null }, 406);
		}
		return json(answer, 200);
	};

	try {
		return await body(calls);
	} finally {
		globalThis.fetch = realFetch;
		for (const [key, value] of saved) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
	}
}
// #endregion

// #region Fixtures
const ACTOR: ReadActor & { accessToken: string } = {
	userId: "11111111-1111-4111-8111-111111111111",
	contextId: "11111111-1111-4111-8111-111111111111",
	contextType: "personal",
	accessToken: "XXXX-XXXX",
};
const SLUG = "prj-abcdefghij";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const STAGE_ID = "44444444-4444-4444-8444-444444444444";
const TOKEN = "f6gPbVEbcceSEWKdZpNocxAF";

const HAPPY = {
	projects: { id: PROJECT_ID },
	project_stages: { id: STAGE_ID },
};
// #endregion

Deno.test("a stage the project does not hold resolves to nothing and calls no door", async () => {
	await withPostgrest({ projects: { id: PROJECT_ID }, project_stages: [] }, async (calls) => {
		assertEquals(await actOnStageInviteLink(ACTOR, SLUG, STAGE_ID, "ensure"), null);
		assertEquals(calls.some((c) => c.rpc), false);
	});
	await withPostgrest(HAPPY, async (calls) => {
		assertEquals(await fetchStageInviteLink(ACTOR, SLUG, "stage-0"), null, "a non-uuid stage");
		assertEquals(calls.length, 0);
	});
});

Deno.test("reading the link never mints one", async () => {
	await withPostgrest({ ...HAPPY, stage_invite_links: [] }, async (calls) => {
		assertEquals(await fetchStageInviteLink(ACTOR, SLUG, STAGE_ID), { data: null });
		assertEquals(calls.some((c) => c.rpc), false);
	});
});

Deno.test("ensure and reset reach get_stage_invite_link; revoke reaches its own door", async () => {
	const minted = { id: "l-1", token: TOKEN, stageId: STAGE_ID, createdAt: "2026-10-06T00:00:00Z" };
	await withPostgrest({ ...HAPPY, "rpc.get_stage_invite_link": minted }, async (calls) => {
		const reset = await actOnStageInviteLink(ACTOR, SLUG, STAGE_ID, "reset");
		assert(reset && "data" in reset);
		assertEquals(reset.data?.path, `/invite/${TOKEN}`);
		const rpc = calls.find((c) => c.rpc);
		assertEquals(rpc?.body, { p_stage_id: STAGE_ID, p_rotate: true });
	});
	await withPostgrest({ ...HAPPY, "rpc.revoke_stage_invite_link": true }, async (calls) => {
		assertEquals(await actOnStageInviteLink(ACTOR, SLUG, STAGE_ID, "revoke"), { data: null });
		assertEquals(calls.find((c) => c.rpc)?.name, "revoke_stage_invite_link");
	});
});

Deno.test("a delegate refused by the door is a 403 in the database's words", async () => {
	await withPostgrest({
		...HAPPY,
		"rpc.get_stage_invite_link": pgFail(
			"42501",
			"Only the project owner, an admin or a manager may share an invite link.",
			403,
		),
	}, async () => {
		const outcome = await actOnStageInviteLink(ACTOR, SLUG, STAGE_ID, "ensure");
		assert(outcome && "refusal" in outcome);
		assertEquals(outcome.refusal.status, 403);
	});
});

Deno.test("an unknown resolve state degrades to invalid rather than passing through", async () => {
	await withPostgrest({ "rpc.resolve_invite_link": { state: "surprise" } }, async () => {
		assertEquals((await resolveInviteLinkLive(ACTOR, TOKEN)).state, "invalid");
	});
});

Deno.test("redeem keeps the refusal's status: a duplicate is 409, a turned-off link 422", async () => {
	await withPostgrest({
		"rpc.redeem_invite_link": pgFail("23505", "You have already asked to join this stage.", 409),
	}, async () => {
		const outcome = await redeemInviteLinkLive(ACTOR, { token: TOKEN, message: "" });
		assert(outcome && "refusal" in outcome);
		assertEquals(outcome.refusal.status, 409);
		assertEquals(outcome.refusal.message, "You have already asked to join this stage.");
	});
	await withPostgrest({
		"rpc.redeem_invite_link": pgFail("23514", "This invite link has been turned off.", 400),
	}, async (calls) => {
		const outcome = await redeemInviteLinkLive(ACTOR, { token: TOKEN, message: "  " });
		assert(outcome && "refusal" in outcome);
		assertEquals(outcome.refusal.status, 422);
		assertEquals(calls[0].body, { p_token: TOKEN, p_message: null });
	});
});
