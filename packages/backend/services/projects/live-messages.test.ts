import { assert, assertEquals, assertRejects } from "@std/assert";
import { MessagePageSchema } from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import { fetchChannelMessagePage } from "./live-messages.ts";

/**
 * live-messages_test — one page of a project channel's history against a fake PostgREST.
 *
 * Contract (module docblock + `fetchChannel`): `null` when the routed channel does not resolve for
 * this viewer — including a channel that belongs to a DIFFERENT project than the URL names — and a
 * THROWN error (naming the table) when the channel or the page read itself fails. Every enrichment
 * (count, pins, reactions, favourites, reply originals, attachments, parties) degrades instead. The
 * fat service's `liveRead` catches the throw.
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
const OTHER_PROJECT = "44444444-4444-4444-8444-444444444444";
const CHANNEL_ID = "55555555-5555-4555-8555-555555555555";
const M1 = "66666666-6666-4666-8666-666666666661";
const M2 = "66666666-6666-4666-8666-666666666662";
const M3 = "66666666-6666-4666-8666-666666666663";
const SLUG = "prj-messages22";
const NOW = Date.parse("2026-10-05T12:00:00.000Z");

function actorOf(userId: string): ReadActor & { accessToken: string } {
	return { userId, contextId: "", contextType: "personal", accessToken: "XXXX-XXXX" };
}

const OWNER = actorOf(OWNER_ID);

function message(id: string, over: Record<string, unknown> = {}) {
	return {
		id,
		channel_id: CHANNEL_ID,
		sender_user_id: OWNER_ID,
		body: "hello",
		body_delta: null,
		reply_to_id: null,
		has_attachments: false,
		is_audio: false,
		created_at: "2026-10-01T00:00:00.000Z",
		deleted_at: null,
		...over,
	};
}

const ROW_M1 = message(M1, {
	sender_user_id: FREELANCER_ID,
	body: "The first draft is up",
	created_at: "2026-10-03T08:00:00.000Z",
});
const ROW_M2 = message(M2, { body: "Looks good", created_at: "2026-10-04T15:30:00.000Z" });
const ROW_M3 = message(M3, {
	sender_user_id: FREELANCER_ID,
	body: "Thanks!",
	reply_to_id: M1,
	created_at: "2026-10-05T09:05:00.000Z",
});

/**
 * `comms.project_messages` answers five different reads; route each by its shape: the exact-count
 * HEAD, the cursor anchor (`id=eq.`), the pinned rows (`id=in.` with the page columns), the reply
 * originals (`id=in.` with the narrower columns), and the page itself (newest first).
 */
function messagesRoute(opts: { total?: number; page?: unknown[]; fail?: string } = {}) {
	const page = opts.page ?? [ROW_M3, ROW_M2, ROW_M1];
	const all = [ROW_M1, ROW_M2, ROW_M3];
	return (req: FakeRequest) => {
		const id = req.query.get("id") ?? "";
		const select = req.query.get("select") ?? "";
		const kind = req.method === "HEAD"
			? "count"
			: id.startsWith("eq.")
			? "anchor"
			: id.startsWith("in.")
			? (select.includes("channel_id") ? "pinned" : "originals")
			: "page";
		if (opts.fail === kind) {
			return pgFail("42501", "permission denied for table project_messages", 403);
		}
		switch (kind) {
			case "count":
				return Array.from({ length: opts.total ?? 5 }, () => ({}));
			case "anchor":
				return all.filter((row) => `eq.${row.id}` === id).map((row) => ({
					id: row.id,
					created_at: row.created_at,
				}));
			case "pinned":
			case "originals":
				return all.filter((row) => id.includes(row.id));
			default:
				return page.slice(0, Number(req.query.get("limit") ?? page.length));
		}
	};
}

/** The full happy-path database for one channel of {@link SLUG}. */
function messageRoutes(over: Record<string, Route> = {}): Record<string, Route> {
	return {
		"projects.projects": [{ id: PROJECT_UUID, owner_user_id: OWNER_ID }],
		"comms.project_channels": [{ id: CHANNEL_ID, project_id: PROJECT_UUID }],
		"comms.project_messages": messagesRoute(),
		"comms.message_pins": [{ message_id: M2 }, { message_id: "pinned-elsewhere" }],
		"comms.message_reactions": [
			{ message_id: M2, user_id: OWNER_ID, emoji: "👍" },
			{ message_id: M2, user_id: FREELANCER_ID, emoji: "👍" },
			{ message_id: M2, user_id: FREELANCER_ID, emoji: "🎉" },
		],
		"comms.message_favorites": [{ message_id: M3 }],
		"org.rpc.get_party_cards": [
			{ user_id: OWNER_ID, username: "olive", first_name: "Olive", last_name: "Owner" },
			{ user_id: FREELANCER_ID, username: "fern", first_name: "Fern", last_name: null },
		],
		...over,
	};
}

const PARAMS = { projectId: SLUG, channelId: CHANNEL_ID, limit: 2 };
// #endregion

// #region Happy path
Deno.test("fetchChannelMessagePage maps one page onto a schema-valid MessagePage, oldest first", async () => {
	await withPostgrest(messageRoutes(), async () => {
		const page = await fetchChannelMessagePage(OWNER, PARAMS, NOW);
		assert(page);
		MessagePageSchema.parse(page);
		assertEquals(page.channelId, CHANNEL_ID);
		// Three fetched for a page of two: the extra row only proves there is more.
		assertEquals(page.messages.map((m) => m.id), [M2, M3]);
		assertEquals(page.hasMore, true);
		assertEquals(page.nextCursor, M2);
		assertEquals(page.total, 5);
		assertEquals(page.permissions, { canPin: true });
	});
});

Deno.test("fetchChannelMessagePage: labels, ownership, sender, reply quote, pins, reactions, favourites", async () => {
	await withPostgrest(messageRoutes(), async () => {
		const page = await fetchChannelMessagePage(OWNER, PARAMS, NOW);
		assert(page);
		const [m2, m3] = page.messages;
		assertEquals([m2.timeLabel, m2.dayLabel], ["3:30 PM", "Yesterday"]);
		assertEquals([m3.timeLabel, m3.dayLabel], ["9:05 AM", "Today"]);
		assertEquals([m2.isOwn, m3.isOwn], [true, false]);
		assertEquals(m3.sender?.name, "Fern");
		assertEquals(m3.sender?.handle, "fern");

		// The original is outside the page, so it is fetched by id and quoted.
		assertEquals(m3.replyTo?.id, M1);
		assertEquals(m3.replyTo?.senderName, "Fern");
		assertEquals(m3.replyTo?.excerpt, "The first draft is up");
		assertEquals(m3.replyTo?.available, true);

		assertEquals(m2.pinned, true);
		assertEquals(page.pinned.map((m) => m.id), [M2]);
		assertEquals(m2.reactions, [{ emoji: "👍", count: 2, mine: true }, {
			emoji: "🎉",
			count: 1,
			mine: false,
		}]);
		assertEquals([m2.favorited, m3.favorited], [false, true]);
	});
});

Deno.test("fetchChannelMessagePage clamps the page size and asks for one extra row", async () => {
	await withPostgrest(messageRoutes(), async (calls) => {
		await fetchChannelMessagePage(OWNER, { projectId: SLUG, channelId: CHANNEL_ID }, NOW);
		const pageRead = () =>
			calls.filter((c) => c.name === "project_messages" && c.method === "GET" && !c.query.get("id"))
				.at(-1)!;
		assertEquals(pageRead().query.get("limit"), "29", "default page of 28, plus one");
		assertEquals(pageRead().query.get("deleted_at"), "is.null");
		await fetchChannelMessagePage(OWNER, { projectId: SLUG, channelId: CHANNEL_ID, limit: 0 }, NOW);
		assertEquals(pageRead().query.get("limit"), "2");
	});
});

Deno.test("fetchChannelMessagePage pages backwards from a cursor with a (created_at, id) tie-break", async () => {
	await withPostgrest(
		messageRoutes({ "comms.project_messages": messagesRoute({ page: [ROW_M1] }) }),
		async (calls) => {
			const page = await fetchChannelMessagePage(OWNER, { ...PARAMS, before: M2 }, NOW);
			assert(page);
			assertEquals(page.messages.map((m) => m.id), [M1]);
			assertEquals(page.hasMore, false);
			assertEquals(page.nextCursor, null);
			const pageRead = calls.find((c) => c.name === "project_messages" && c.query.get("or"))!;
			assertEquals(
				pageRead.query.get("or"),
				`(created_at.lt."${ROW_M2.created_at}",and(created_at.eq."${ROW_M2.created_at}",id.lt.${M2}))`,
			);
		},
	);
});
// #endregion

// #region Authorization-relevant resolution
Deno.test("a non-owner may not pin", async () => {
	await withPostgrest(messageRoutes(), async () => {
		const page = await fetchChannelMessagePage(actorOf(FREELANCER_ID), PARAMS, NOW);
		assert(page);
		assertEquals(page.permissions.canPin, false);
		assertEquals(page.messages.map((m) => m.isOwn), [false, true]);
	});
});

Deno.test("a channel id that belongs to ANOTHER project than the URL names is null", async () => {
	await withPostgrest(
		messageRoutes({
			"comms.project_channels": [{ id: CHANNEL_ID, project_id: OTHER_PROJECT }],
		}),
		async (calls) => {
			assertEquals(await fetchChannelMessagePage(OWNER, PARAMS, NOW), null);
			assertEquals(calls.some((c) => c.name === "project_messages"), false, "no history is read");
		},
	);
});

Deno.test("a channel RLS hides is null; a non-uuid segment on an unknown project is null without a read", async () => {
	await withPostgrest(messageRoutes({ "comms.project_channels": [] }), async () => {
		assertEquals(await fetchChannelMessagePage(OWNER, PARAMS, NOW), null);
	});
	await withPostgrest(messageRoutes({ "projects.projects": [] }), async (calls) => {
		assertEquals(
			await fetchChannelMessagePage(OWNER, { ...PARAMS, channelId: "general" }, NOW),
			null,
		);
		assertEquals(calls.some((c) => c.schema === "comms"), false);
	});
});

Deno.test("an unresolvable project segment still opens a channel addressed by its own uuid (DM-style)", async () => {
	await withPostgrest(messageRoutes({ "projects.projects": [] }), async () => {
		const page = await fetchChannelMessagePage(OWNER, PARAMS, NOW);
		assert(page);
		assertEquals(page.channelId, CHANNEL_ID);
		assertEquals(page.permissions.canPin, false);
	});
});
// #endregion

// #region Degradation
Deno.test("failed enrichments degrade: total falls back to a floor, no pins, reactions or favourites", async () => {
	const denied = pgFail("42501", "permission denied", 403);
	await withPostgrest(
		messageRoutes({
			"comms.project_messages": messagesRoute({ fail: "count" }),
			"comms.message_pins": denied,
			"comms.message_reactions": denied,
			"comms.message_favorites": denied,
			"comms.message_attachments": denied,
			"files.items": denied,
			"org.rpc.get_party_cards": denied,
			"org.users_public": denied,
		}),
		async () => {
			const page = await fetchChannelMessagePage(OWNER, PARAMS, NOW);
			assert(page);
			MessagePageSchema.parse(page);
			assertEquals(page.total, 3, "two shown + one 'more' marker");
			assertEquals(page.pinned, []);
			assertEquals(
				page.messages.every((m) => m.reactions.length === 0 && !m.favorited && !m.pinned),
				true,
			);
			assertEquals(page.messages[0].sender?.name, "Unknown");
		},
	);
});

Deno.test("a reply whose original cannot be read is quoted as unavailable, not dropped", async () => {
	await withPostgrest(
		messageRoutes({
			"comms.project_messages": messagesRoute({ fail: "originals" }),
		}),
		async () => {
			const page = await fetchChannelMessagePage(OWNER, PARAMS, NOW);
			assert(page);
			const reply = page.messages.find((m) => m.id === M3)?.replyTo;
			assertEquals(reply?.available, false);
		},
	);
});
// #endregion

// #region Load-bearing failures THROW (documented contract)
Deno.test("fetchChannelMessagePage THROWS when the channel read fails", async () => {
	await withPostgrest(
		messageRoutes({
			"comms.project_channels": pgFail("PGRST301", "JWT expired", 401),
		}),
		async () => {
			await assertRejects(
				() => fetchChannelMessagePage(OWNER, PARAMS, NOW),
				Error,
				"comms.project_channels read failed: JWT expired",
			);
		},
	);
});

Deno.test("fetchChannelMessagePage THROWS when the page read fails (42501)", async () => {
	await withPostgrest(
		messageRoutes({
			"comms.project_messages": messagesRoute({ fail: "page" }),
		}),
		async () => {
			await assertRejects(
				() => fetchChannelMessagePage(OWNER, PARAMS, NOW),
				Error,
				"comms.project_messages read failed: permission denied for table project_messages",
			);
		},
	);
});
// #endregion
