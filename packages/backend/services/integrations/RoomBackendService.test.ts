import { assertEquals } from "@std/assert";
import type { ReadActor } from "../read-actor.ts";
import { IntegrationsBackendService } from "./IntegrationsBackendService.ts";
import { RoomBackendService } from "./RoomBackendService.ts";

/*
 * The three sweeps and the join (Decision #383). What is pinned is what money and access turn on: a
 * read that failed is never stamped as read, a refusal that cannot change stops retrying, and a
 * provider being down never stops anybody joining. Runs on a fake network: no provider was called.
 */

// #region Fake network
interface Call {
	name: string;
	method: string;
	// deno-lint-ignore no-explicit-any
	json: any;
}

type Route = (call: Call) => unknown;

const ENV: Record<string, string> = {
	INTEGRATIONS_BACKEND_LIVE: "true",
	SUPABASE_URL: "http://postgrest.fake",
	SUPABASE_ANON_KEY: "XXXX-XXXX",
	SUPABASE_SERVICE_ROLE_KEY: "XXXX-XXXX",
};

const json = (payload: unknown, status = 200) =>
	new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

async function world(
	routes: { db?: Record<string, Route>; provider?: (call: Call) => Response; token?: string | null },
	body: (calls: Call[]) => Promise<void>,
) {
	const calls: Call[] = [];
	const saved = Object.keys(ENV).map((name) => [name, Deno.env.get(name)] as const);
	const unmocked = ["USE_MOCKS", "VITE_USE_MOCKS"].map((name) => [name, Deno.env.get(name)] as const);
	for (const [name, value] of Object.entries(ENV)) Deno.env.set(name, value);
	for (const [name] of unmocked) Deno.env.delete(name);

	const realToken = IntegrationsBackendService.accessToken;
	IntegrationsBackendService.accessToken = () =>
		Promise.resolve(routes.token === undefined ? "token" : routes.token);
	const realFetch = globalThis.fetch;
	globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		const text = await request.text();
		const db = url.host === "postgrest.fake";
		const call = {
			name: db ? url.pathname.replace("/rest/v1/rpc/", "") : url.pathname,
			method: request.method,
			json: text.startsWith("{") ? JSON.parse(text) : null,
		};
		calls.push(call);
		if (!db) return (routes.provider ?? (() => json({ code: "unrouted" }, 500)))(call);
		return json(routes.db?.[call.name]?.(call) ?? null);
	};
	try {
		await body(calls);
	} finally {
		globalThis.fetch = realFetch;
		IntegrationsBackendService.accessToken = realToken;
		for (const [name, value] of [...saved, ...unmocked]) {
			if (value === undefined) Deno.env.delete(name);
			else Deno.env.set(name, value);
		}
	}
}

const named = (calls: Call[], name: string) => calls.filter((c) => c.name === name);

const ROOM = {
	room_id: "11111111-1111-4111-8111-111111111111",
	provider: "zoom",
	connection_id: "22222222-2222-4222-8222-222222222222",
	host_account: "zoom-host",
	title: "Portfolio review",
	starts_at: "2026-11-05T10:00:00Z",
	ends_at: "2026-11-05T10:45:00Z",
};

const ADA = {
	userId: "a1000000-0000-4000-8000-000000000001",
	contextId: "",
	contextType: "personal",
	accessToken: "ada-jwt",
} as ReadActor;

const SLUG = "rom-23456789ab";
// #endregion

// #region Mint
Deno.test("mint: a made room is attached with its meeting, its host and whether it can register", () =>
	world({
		db: { claim_rooms_to_mint: () => [ROOM] },
		provider: (call) =>
			call.name.endsWith("/users/me")
				? json({ type: 2 })
				: json({ id: 77, host_id: "zhost", join_url: "https://zoom.us/j/77" }, 201),
	}, async (calls) => {
		const res = await RoomBackendService.mintDue(5);
		assertEquals(res.data, { claimed: 1, done: 1, failed: 0 });
		const [attach] = named(calls, "attach_room");
		assertEquals(attach.json.p_meeting_id, "77");
		assertEquals(attach.json.p_host_id, "zhost");
		assertEquals(attach.json.p_registration, true);
		assertEquals(named(calls, "fail_room").length, 0);
	}));

Deno.test("mint: no connected account stops at once and tells the host", () =>
	world({
		db: { claim_rooms_to_mint: () => [{ ...ROOM, connection_id: null }] },
	}, async (calls) => {
		assertEquals((await RoomBackendService.mintDue()).data?.failed, 1);
		const [failed] = named(calls, "fail_room");
		assertEquals(failed.json, { p_room: ROOM.room_id, p_error: "no_connection", p_final: true });
	}));

Deno.test("mint: a refusal that cannot change is final, and an outage or a busy token goes back in the queue", async () => {
	const failure = async (routes: Parameters<typeof world>[0]) => {
		let args: Call | undefined;
		await world({ ...routes, db: { claim_rooms_to_mint: () => [ROOM] } }, async (calls) => {
			await RoomBackendService.mintDue();
			[args] = named(calls, "fail_room");
		});
		return args?.json;
	};
	assertEquals((await failure({ provider: () => json({ code: 4711 }, 403) })).p_final, true);
	assertEquals((await failure({ provider: () => json({}, 503) })).p_final, false);
	assertEquals(await failure({ token: null }), {
		p_room: ROOM.room_id,
		p_error: "no_token",
		p_final: false,
	});
});

Deno.test("the sweeps stay off while the integrations gate is", async () => {
	await world({}, async (calls) => {
		Deno.env.set("INTEGRATIONS_BACKEND_LIVE", "false");
		assertEquals((await RoomBackendService.mintDue()).status, 503);
		assertEquals(calls.length, 0);
	});
});
// #endregion

// #region Sync
Deno.test("sync: a cancelled room is taken down, a moved one follows, and neither blocks on a refusal", () =>
	world({
		db: {
			claim_rooms_to_sync: () => [
				{ ...ROOM, closing: true, provider_meeting_id: "77" },
				{ ...ROOM, room_id: "moved", closing: false, provider_meeting_id: "78" },
			],
		},
		provider: (call) => call.method === "DELETE" ? new Response(null, { status: 204 }) : json({ code: 3000 }, 400),
	}, async (calls) => {
		assertEquals((await RoomBackendService.syncDue()).data, { claimed: 2, done: 1, failed: 1 });
		const [closed, moved] = named(calls, "room_synced");
		assertEquals(closed.json.p_error, undefined);
		assertEquals(moved.json.p_room, "moved");
		assertEquals(moved.json.p_error, "3000");
	}));

Deno.test("sync: a Meet space has no time and nothing to take down, so it settles with no call", () =>
	world({
		db: { claim_rooms_to_sync: () => [{ ...ROOM, provider: "google", closing: true, provider_meeting_id: "spaces/a" }] },
	}, async (calls) => {
		assertEquals((await RoomBackendService.syncDue()).data?.done, 1);
		assertEquals(calls.filter((c) => c.name.startsWith("/")).length, 0);
	}));
// #endregion

// #region Reconcile
const READ = { ...ROOM, provider_meeting_id: "77" };

Deno.test("reconcile: every stretch is recorded as the provider's, then the room is stamped", () =>
	world({
		db: { claim_rooms_to_reconcile: () => [READ] },
		provider: () =>
			json({
				participants: [
					{ id: "zhost", join_time: "2026-11-05T10:00:00Z", leave_time: "2026-11-05T10:40:00Z" },
					{ registrant_id: "reg-1", join_time: "2026-11-05T10:05:00Z" },
				],
			}),
	}, async (calls) => {
		assertEquals((await RoomBackendService.reconcileDue()).data?.done, 1);
		const rows = named(calls, "record_presence");
		assertEquals(rows.map((r) => r.json.p_action), ["joined", "left", "joined"]);
		assertEquals(rows.every((r) => r.json.p_source === "reconcile"), true);
		assertEquals(rows[0].json.p_account_id, "zhost");
		assertEquals(rows[2].json.p_registrant_id, "reg-1");
		assertEquals(named(calls, "room_reconciled")[0].json, { p_room: ROOM.room_id });
	}));

Deno.test("reconcile: a failed read is never stamped as read, because that would let a refund fire", () =>
	world({
		db: { claim_rooms_to_reconcile: () => [READ] },
		provider: () => json({ code: 200, message: "Only available for paid users" }, 400),
	}, async (calls) => {
		assertEquals((await RoomBackendService.reconcileDue()).data?.failed, 1);
		assertEquals(named(calls, "record_presence").length, 0);
		assertEquals(named(calls, "room_reconciled")[0].json.p_error, "200");
	}));
// #endregion

// #region Join
const OPEN = {
	state: "open",
	url: "https://zoom.us/j/77",
	provider: "zoom",
	role: "attendee",
	connection_id: ROOM.connection_id,
	provider_meeting_id: "77",
};

Deno.test("join: a host gets a fresh link, read at the moment of joining", () =>
	world({
		db: { room_join: () => ({ ...OPEN, role: "host" }) },
		provider: () => json({ start_url: "https://zoom.us/s/77?zak=fresh", join_url: OPEN.url }),
	}, async () => {
		assertEquals((await RoomBackendService.join(SLUG, ADA)).data?.url, "https://zoom.us/s/77?zak=fresh");
	}));

Deno.test("join: an attendee's first join makes their own link, for the person the door names", () =>
	world({
		db: {
			room_join: () => ({
				...OPEN,
				register: { room_id: ROOM.room_id, user_id: "from-the-door", email: "a@example.test", first_name: "Ada" },
			}),
		},
		provider: () => json({ registrant_id: "reg-1", join_url: "https://zoom.us/w/own" }, 201),
	}, async (calls) => {
		assertEquals((await RoomBackendService.join(SLUG, ADA)).data?.url, "https://zoom.us/w/own");
		assertEquals(named(calls, "save_room_registrant")[0].json, {
			p_room: ROOM.room_id,
			p_user: "from-the-door",
			p_registrant_id: "reg-1",
			p_join_url: "https://zoom.us/w/own",
		});
	}));

Deno.test("join: a provider being down leaves the room's own link, and nobody is stopped", () =>
	world({
		db: {
			room_join: () => ({ ...OPEN, register: { room_id: "r", user_id: "u", email: "e", first_name: "f" } }),
		},
		provider: () => json({}, 503),
	}, async () => {
		const res = await RoomBackendService.join(SLUG, ADA);
		assertEquals(res.ok, true);
		assertEquals(res.data?.url, OPEN.url);
	}));

Deno.test("join: a room that is not open asks no provider, and a malformed address asks nobody", async () => {
	await world({ db: { room_join: () => ({ state: "upcoming", url: null }) } }, async (calls) => {
		assertEquals((await RoomBackendService.join(SLUG, ADA)).data?.state, "upcoming");
		assertEquals(calls.length, 1);
	});
	await world({}, async (calls) => {
		assertEquals((await RoomBackendService.join("rom-nope", ADA)).data?.state, "not_party");
		assertEquals(calls.length, 0);
	});
});
// #endregion
