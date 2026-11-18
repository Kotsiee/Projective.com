import { assert, assertEquals } from "@std/assert";
import { MESSAGE_SEND_RULE, MessagingBackendService } from "./MessagingBackendService.ts";
import { INQUIRY_CLOSED_MESSAGE } from "./live-conversation-writes.ts";
import type { ReadActor } from "../read-actor.ts";
import { SlidingWindowLimiter } from "../../core/rate-limit.ts";
import type { SendMessageInput } from "@projective/types/messaging";

/**
 * CAS M24: the fixture corpus answers only while `MESSAGING_BACKEND_LIVE` is off. With the gate on, a
 * request that cannot read live — a guest, or a signed-in actor whose token is missing — is a 401 and
 * carries no data, so a real person is never shown an invented inbox under their own name.
 *
 * MS2 (Decision #339 ruling N1): one send door, `sendMessage(actor, ChatRef, input)`, for a thread and
 * a room alike, rate-limited per sender; conversations addressed by their `cht-` ref, a `dm-<handle>`
 * answering 303 to the pair's thread, a uuid answering 404; the inbox's previews in one
 * `comms.inbox_tails` call, its rows cached once per tenant.
 *
 * The gate cases are refused before any network call. The live cases run against a fake PostgREST
 * at `globalThis.fetch`, so the real supabase-js builder parses every answer and no database is
 * touched. `serverEnv()` reads `Deno.env` on every call, so setting it around each case is enough.
 */

// #region Harness
/** Run `fn` with `vars` applied, restoring the previous environment afterwards. */
async function withEnv(
	vars: Record<string, string | undefined>,
	fn: () => Promise<void>,
): Promise<void> {
	const prior = new Map<string, string | undefined>();
	for (const key of Object.keys(vars)) prior.set(key, Deno.env.get(key));
	try {
		for (const [key, value] of Object.entries(vars)) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
		await fn();
	} finally {
		for (const [key, value] of prior) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
	}
}

const LIVE = {
	SUPABASE_URL: "https://example.supabase.co",
	SUPABASE_ANON_KEY: "anon-key",
	USE_MOCKS: "false",
	VITE_USE_MOCKS: undefined,
	MESSAGING_BACKEND_LIVE: "true",
	PROJECTS_BACKEND_LIVE: "false",
};

const OFF = { ...LIVE, MESSAGING_BACKEND_LIVE: "false" };

/** Both stores live, against the fake PostgREST. */
const FAKE_LIVE = {
	...LIVE,
	SUPABASE_URL: "http://postgrest.fake",
	PROJECTS_BACKEND_LIVE: "true",
};

/** One request the service issued, decoded. */
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
	const json = (payload: unknown, status: number) =>
		new Response(JSON.stringify(payload), {
			status,
			headers: { "content-type": "application/json" },
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
		return json(answer, 200);
	};

	try {
		return await body(calls);
	} finally {
		globalThis.fetch = realFetch;
	}
}

/** The calls to one table or RPC (`schema.table` / `schema.rpc.fn`). */
function callsTo(calls: readonly FakeRequest[], key: string): FakeRequest[] {
	return calls.filter((c) => `${c.schema}.${c.rpc ? "rpc." : ""}${c.name}` === key);
}

/** A signed-in actor with a token, its own cache partition. */
function liveActor(userId: string): ReadActor {
	return { userId, contextId: userId, contextType: "personal", accessToken: `token-${userId}` };
}

/** Signed in, but with no token Postgres could check. */
const TOKENLESS: ReadActor = {
	userId: "00000000-0000-4000-8000-000000000001",
	contextId: "",
	contextType: "personal",
};

const GUEST: ReadActor = { userId: "", contextId: "", contextType: "personal" };

/** A plain one-line message. */
function textMessage(text: string): SendMessageInput {
	return {
		text,
		delta: null,
		replyToId: null,
		attachmentIds: [],
		linkedFileIds: [],
		audio: null,
	};
}

const OTHER = "00000000-0000-4000-8000-0000000000b2";
const THREAD = "11111111-1111-4111-8111-111111111111";
const REF = "cht-23456789ab";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ROOM = "33333333-3333-4333-8333-333333333333";
const AT = "2026-11-18T10:00:00.000000+00:00";

/** The `comms.dm_messages` row an insert reads back. */
function storedDm(sender: string, body: string) {
	return {
		id: "44444444-4444-4444-8444-444444444444",
		thread_id: THREAD,
		sender_user_id: sender,
		body,
		has_attachments: false,
		is_audio: false,
		created_at: AT,
		deleted_at: null,
		body_delta: null,
		reply_to_id: null,
	};
}

/** `comms.dm_threads`, answering a `ref=eq.` lookup with `refs` and an `id=in.` read with `rows`. */
function threadsRoute(rows: Array<{ id: string; ref: string }>) {
	return (req: FakeRequest) => {
		const ref = req.query.get("ref");
		if (ref) return rows.filter((r) => `eq.${r.ref}` === ref);
		return rows.map((r) => ({
			kind: "dm",
			title: null,
			photo_file_id: null,
			created_by_user_id: OTHER,
			created_at: AT,
			owner_type: null,
			owner_entity_id: null,
			slug: null,
			last_message_at: AT,
			last_message_id: storedDm(OTHER, "hi").id,
			...r,
		}));
	};
}

/** The viewer's own `comms.dm_participants` row for `threadId`. */
function participantOf(userId: string, threadId: string) {
	return {
		thread_id: threadId,
		user_id: userId,
		last_read_at: null,
		is_starred: false,
		is_archived: false,
		inbox_folder: "primary",
		is_muted: false,
		deleted_at: null,
	};
}
// #endregion

// #region The live gate
Deno.test("live gate on: a tokenless reader gets 401 and no fixture data", async () => {
	await withEnv(LIVE, async () => {
		const results = [
			await MessagingBackendService.conversations({ role: "freelancer" }, TOKENLESS),
			await MessagingBackendService.conversation("dm-anyone", TOKENLESS),
			await MessagingBackendService.messages({ conversationId: "dm-anyone" }, TOKENLESS),
			await MessagingBackendService.contacts(undefined, undefined, TOKENLESS),
			await MessagingBackendService.settings("freelancer", TOKENLESS),
			await MessagingBackendService.suggestions({}, TOKENLESS),
			await MessagingBackendService.members("dm-anyone", TOKENLESS),
			await MessagingBackendService.markRead("dm-anyone", TOKENLESS),
		];
		for (const res of results) {
			assertEquals(res.status, 401);
			assertEquals(res.data, undefined);
		}
	});
});

Deno.test("live gate on: a guest gets 401 from the gated reads, never the corpus", async () => {
	await withEnv(LIVE, async () => {
		const contacts = await MessagingBackendService.contacts(undefined, undefined, GUEST);
		assertEquals(contacts.status, 401);
		const suggestions = await MessagingBackendService.suggestions({}, undefined);
		assertEquals(suggestions.status, 401);
	});
});

Deno.test("live gate on: a tokenless sender is refused rather than written to the stub store", async () => {
	await withEnv(LIVE, async () => {
		const sent = await MessagingBackendService.sendMessage(
			TOKENLESS,
			{ kind: "thread", ref: "dm-anyone" },
			textMessage("hello"),
		);
		assertEquals(sent.status, 401);
	});
});

Deno.test("live gate off: the fixture backend still answers", async () => {
	await withEnv(OFF, async () => {
		const res = await MessagingBackendService.conversations({ role: "freelancer" }, TOKENLESS);
		assert(res.ok);
		const read = await MessagingBackendService.markRead("dm-anyone", TOKENLESS);
		assert(read.ok);
		assertEquals(read.data?.moved, false);
	});
});

Deno.test("live gate off: an inquiry offers no Add members and refuses one in the database's words (#482)", async () => {
	await withEnv(OFF, async () => {
		const res = await MessagingBackendService.conversation("dm-omar", TOKENLESS);
		assert(res.ok);
		assertEquals(res.data?.detail.kind, "service_inquiry");
		assertEquals(res.data?.detail.canAddMembers, false);

		const add = await MessagingBackendService.addMembers(
			{ conversationId: "dm-omar", contactIds: ["mara"] },
			TOKENLESS,
		);
		assertEquals(add.ok, false);
		assertEquals(add.status, 422);
		assertEquals(add.message, INQUIRY_CLOSED_MESSAGE);
	});
});
// #endregion

// #region The one send door (MS2)
Deno.test("one door: a thread send and a room send both go through sendMessage(ref)", async () => {
	const me = liveActor("00000000-0000-4000-8000-0000000000c1");
	const limiter = new SlidingWindowLimiter(MESSAGE_SEND_RULE);
	await withEnv(FAKE_LIVE, async () => {
		await withPostgrest({
			"comms.dm_threads": threadsRoute([{ id: THREAD, ref: REF }]),
			"comms.dm_messages": (req: FakeRequest) =>
				req.method === "POST" ? [storedDm(me.userId, "To the thread.")] : [],
			"projects.projects": [{ id: PROJECT }],
			"comms.project_channels": [{ id: ROOM, project_id: PROJECT }],
			"comms.project_messages": (req: FakeRequest) =>
				req.method === "POST"
					? [{
						id: "55555555-5555-4555-8555-555555555555",
						created_at: AT,
						body: "To the room.",
						body_delta: null,
					}]
					: [],
		}, async (calls) => {
			const thread = await MessagingBackendService.sendMessage(
				me,
				{ kind: "thread", ref: REF },
				textMessage("To the thread."),
				{ limiter },
			);
			assert(thread.ok, thread.message);
			assertEquals(thread.data?.ref, REF);
			assertEquals(thread.data?.message.text, "To the thread.");
			const dmInsert = callsTo(calls, "comms.dm_messages").find((c) => c.method === "POST");
			assertEquals((dmInsert?.body as { thread_id?: string }).thread_id, THREAD);
			assertEquals((dmInsert?.body as { sender_user_id?: string }).sender_user_id, me.userId);

			const room = await MessagingBackendService.sendMessage(
				me,
				{ kind: "room", ref: "prj-23456789ab", channel: ROOM },
				textMessage("To the room."),
				{ limiter },
			);
			assert(room.ok, room.message);
			assertEquals(room.data?.message.text, "To the room.");
			assertEquals(room.data?.ref, undefined);
			const roomInsert = callsTo(calls, "comms.project_messages").find((c) => c.method === "POST");
			assertEquals((roomInsert?.body as { channel_id?: string }).channel_id, ROOM);
		});
	});
	// Both were counted by the one limiter: the same door, whichever store it wrote.
	assertEquals(limiter.peek(me.userId).remaining, MESSAGE_SEND_RULE.max - 2);
});

Deno.test("one door: a thread opened inside a project stamps the message with it", async () => {
	const me = liveActor("00000000-0000-4000-8000-0000000000c2");
	await withEnv(FAKE_LIVE, async () => {
		await withPostgrest({
			"comms.dm_threads": threadsRoute([{ id: THREAD, ref: REF }]),
			"projects.projects": [{ id: PROJECT }],
			"comms.dm_messages": (req: FakeRequest) =>
				req.method === "POST" ? [storedDm(me.userId, "From the project.")] : [],
		}, async (calls) => {
			const sent = await MessagingBackendService.sendMessage(
				me,
				{ kind: "thread", ref: REF, project: "prj-23456789ab" },
				textMessage("From the project."),
				{ limiter: new SlidingWindowLimiter(MESSAGE_SEND_RULE) },
			);
			assert(sent.ok, sent.message);
			const insert = callsTo(calls, "comms.dm_messages").find((c) => c.method === "POST");
			assertEquals((insert?.body as { project_id?: string }).project_id, PROJECT);
		});
	});
});

Deno.test("one door: the 31st message in a minute is a 429 with details.retryAt", async () => {
	const me: ReadActor = { userId: "u-rate-limit", contextId: "", contextType: "personal" };
	const limiter = new SlidingWindowLimiter(MESSAGE_SEND_RULE);
	await withEnv(OFF, async () => {
		for (let i = 1; i <= MESSAGE_SEND_RULE.max; i++) {
			const sent = await MessagingBackendService.sendMessage(
				me,
				{ kind: "thread", ref: "dm-mara" },
				textMessage(`Message ${i}`),
				{ limiter },
			);
			assert(sent.ok, `message ${i}: ${sent.message}`);
		}
		const refused = await MessagingBackendService.sendMessage(
			me,
			{ kind: "thread", ref: "dm-mara" },
			textMessage("One too many."),
			{ limiter },
		);
		assertEquals(refused.ok, false);
		assertEquals(refused.status, 429);
		const retryAt = refused.details?.retryAt;
		assert(typeof retryAt === "string" && Date.parse(retryAt) > Date.now(), "retryAt is ahead");
	});
});

Deno.test("one door: a non-participant's thread send is a 404 and writes nothing", async () => {
	const me = liveActor("00000000-0000-4000-8000-0000000000c3");
	await withEnv(FAKE_LIVE, async () => {
		// RLS hides a thread the caller is not in, so its ref resolves to nothing.
		await withPostgrest({ "comms.dm_threads": threadsRoute([]) }, async (calls) => {
			const sent = await MessagingBackendService.sendMessage(
				me,
				{ kind: "thread", ref: REF },
				textMessage("Let me in."),
				{ limiter: new SlidingWindowLimiter(MESSAGE_SEND_RULE) },
			);
			assertEquals(sent.status, 404);
			assertEquals(callsTo(calls, "comms.dm_messages").length, 0);
		});
	});
});
// #endregion

// #region cht- addresses (MS2)
Deno.test("addresses: a uuid conversation id is a 404 on every read and on the send", async () => {
	const me = liveActor("00000000-0000-4000-8000-0000000000c4");
	await withEnv(FAKE_LIVE, async () => {
		await withPostgrest({ "comms.dm_threads": threadsRoute([{ id: THREAD, ref: REF }]) }, async (
			calls,
		) => {
			assertEquals((await MessagingBackendService.route(THREAD, me)).status, 404);
			assertEquals((await MessagingBackendService.conversation(THREAD, me)).status, 404);
			assertEquals(
				(await MessagingBackendService.messages({ conversationId: THREAD }, me)).status,
				404,
			);
			assertEquals((await MessagingBackendService.members(THREAD, me)).status, 404);
			assertEquals((await MessagingBackendService.markRead(THREAD, me)).status, 404);
			const sent = await MessagingBackendService.sendMessage(
				me,
				{ kind: "thread", ref: THREAD },
				textMessage("By id."),
				{ limiter: new SlidingWindowLimiter(MESSAGE_SEND_RULE) },
			);
			assertEquals(sent.status, 404);
			// A uuid is refused by its shape: nothing is asked of the database for it.
			assertEquals(calls.length, 0);
		});
	});
});

Deno.test("addresses: a cht- ref the viewer is in renders the conversation at that address", async () => {
	const me = liveActor("00000000-0000-4000-8000-0000000000c5");
	await withEnv(FAKE_LIVE, async () => {
		await withPostgrest({
			"comms.dm_threads": threadsRoute([{ id: THREAD, ref: REF }]),
			"comms.dm_participants": [participantOf(me.userId, THREAD)],
			"comms.rpc.dm_thread_roster": [
				{ thread_id: THREAD, user_id: me.userId, joined_at: AT },
				{ thread_id: THREAD, user_id: OTHER, joined_at: AT },
			],
			"comms.rpc.inbox_tails": [{ ...storedDm(OTHER, "Hi there") }],
		}, async (calls) => {
			const res = await MessagingBackendService.route(REF, me);
			assertEquals(res.status, 200);
			assertEquals(res.data?.location, null);
			assertEquals(res.data?.detail.id, REF);
			assertEquals(res.data?.detail.ref, REF);
			// One thread's read: the viewer's ONE participant row and `inbox_tails([thread])` (RED D-05).
			const participation = callsTo(calls, "comms.dm_participants");
			assertEquals(participation.length, 1);
			assertEquals(participation[0].query.get("thread_id"), `eq.${THREAD}`);
			const tails = callsTo(calls, "comms.rpc.inbox_tails");
			assertEquals(tails.length, 1);
			assertEquals((tails[0].body as { p_thread_ids: string[] }).p_thread_ids, [THREAD]);
		});
	});
});

Deno.test("addresses: dm-<handle> with a thread answers 303 to /messages/cht-…", async () => {
	const me = liveActor("00000000-0000-4000-8000-0000000000c6");
	await withEnv(FAKE_LIVE, async () => {
		await withPostgrest({
			"org.users_public": [{
				user_id: OTHER,
				username: "juno",
				first_name: "Juno",
				last_name: null,
			}],
			"comms.dm_participants": [participantOf(me.userId, THREAD)],
			"comms.rpc.dm_thread_roster": [
				{ thread_id: THREAD, user_id: me.userId, joined_at: AT },
				{ thread_id: THREAD, user_id: OTHER, joined_at: AT },
			],
			"comms.dm_threads": threadsRoute([{ id: THREAD, ref: REF }]),
			"comms.rpc.inbox_tails": [{ ...storedDm(OTHER, "Hi there") }],
		}, async () => {
			const res = await MessagingBackendService.route("dm-juno", me);
			assertEquals(res.status, 303);
			assertEquals(res.data?.location, `/messages/${REF}`);
		});
	});
});

Deno.test("addresses: dm-<handle> with no thread renders the virtual conversation", async () => {
	const me = liveActor("00000000-0000-4000-8000-0000000000c7");
	await withEnv(FAKE_LIVE, async () => {
		await withPostgrest({
			"org.users_public": [{
				user_id: OTHER,
				username: "juno",
				first_name: "Juno",
				last_name: null,
			}],
			"comms.dm_participants": [],
		}, async (calls) => {
			const res = await MessagingBackendService.route("dm-juno", me);
			assertEquals(res.status, 200);
			assertEquals(res.data?.location, null);
			assertEquals(res.data?.detail.id, "dm-juno");
			assertEquals(res.data?.detail.kind, "dm");
			assertEquals(res.data?.detail.ref, undefined);
			// Reading never mints a thread.
			assertEquals(callsTo(calls, "comms.rpc.get_or_create_dm_thread").length, 0);
		});
	});
});
// #endregion

// #region The inbox read model (MS2, RED D-04 / D-13)
Deno.test("inbox: N threads' previews come from ONE inbox_tails call, and two pages share one row set", async () => {
	const me = liveActor("00000000-0000-4000-8000-0000000000c8");
	const threads = [1, 2, 3].map((n) => ({
		id: `1111111${n}-1111-4111-8111-111111111111`,
		ref: `cht-${"23456789a".slice(0, 9)}${"bcd"[n - 1]}`,
	}));
	await withEnv(FAKE_LIVE, async () => {
		await withPostgrest({
			"comms.dm_participants": threads.map((t) => participantOf(me.userId, t.id)),
			"comms.dm_threads": threadsRoute(threads),
			"comms.rpc.dm_thread_roster": threads.flatMap((t) => [
				{ thread_id: t.id, user_id: me.userId, joined_at: AT },
				{ thread_id: t.id, user_id: OTHER, joined_at: AT },
			]),
			"comms.rpc.inbox_tails": threads.map((t) => ({ ...storedDm(OTHER, "Hi"), thread_id: t.id })),
		}, async (calls) => {
			const first = await MessagingBackendService.conversations({ limit: 2 }, me);
			assert(first.ok && first.data, first.message);
			assertEquals(first.data.page.total, 3);
			assertEquals(first.data.page.conversations.length, 2);
			for (const c of first.data.page.conversations) {
				assert(c.id.startsWith("cht-"), `${c.id} is addressed by its ref`);
				assertEquals(c.preview, "Hi");
			}
			assertEquals(callsTo(calls, "comms.rpc.inbox_tails").length, 1);
			assertEquals(callsTo(calls, "comms.dm_messages").length, 0, "no per-thread read");

			const reads = calls.length;
			const second = await MessagingBackendService.conversations({
				limit: 2,
				cursor: first.data.page.nextCursor,
			}, me);
			assert(second.ok && second.data, second.message);
			assertEquals(second.data.page.conversations.length, 1);
			const folder = await MessagingBackendService.conversations({ folder: "primary" }, me);
			assert(folder.ok);
			assertEquals(calls.length, reads, "the second page and the folder reuse the cached rows");
		});
	});
});
// #endregion
