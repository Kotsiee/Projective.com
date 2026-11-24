import { assert, assertEquals } from "@std/assert";
import { MESSAGE_SEND_RULE, MessagingBackendService } from "./MessagingBackendService.ts";
import type { ReadActor } from "../read-actor.ts";
import { SlidingWindowLimiter } from "../../core/rate-limit.ts";
import type { SendMessageInput } from "@projective/types/messaging";

/**
 * message-send_test — a send with files is one write (CAS M15, PROJECTS CH4).
 *
 * The send door used to insert the message, then its `comms.message_attachments` links, then its
 * `comms.channel_files` rows, as three PostgREST calls that never read the second and third answers.
 * A link the database refused (a file the sender cannot read, a file deleted meanwhile) left a
 * message that said "see attached" with nothing attached, and the door reported it as sent. These
 * cases pin the contract: the whole send is the one `comms.send_message` call, and a refused file
 * fails the send with a field error naming the attachments, for a thread and a room alike.
 *
 * The fake sits at `globalThis.fetch`, so the real supabase-js builder parses every answer.
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

/** Both stores live, against the fake PostgREST. */
const FAKE_LIVE = {
	SUPABASE_URL: "http://postgrest.fake",
	SUPABASE_ANON_KEY: "anon-key",
	USE_MOCKS: "false",
	VITE_USE_MOCKS: undefined,
	MESSAGING_BACKEND_LIVE: "true",
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

const FAIL = Symbol("pg-fail");

/** A route answer PostgREST serialises as an error envelope. */
interface PgFailure {
	[FAIL]: true;
	status: number;
	body: { code: string; message: string; details: string | null; hint: string | null };
}

/** An error answer — `42501`, `22023`, `23505`… — as PostgREST sends it. */
function pgFail(code: string, message: string, status = 400): PgFailure {
	return { [FAIL]: true, status, body: { code, message, details: null, hint: null } };
}

function isFailure(value: unknown): value is PgFailure {
	return typeof value === "object" && value !== null && FAIL in value;
}

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
// #endregion

// #region Fixtures
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const THREAD = "11111111-1111-4111-8111-111111111111";
const REF = "cht-23456789ab";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ROOM = "33333333-3333-4333-8333-333333333333";
const DM_ID = "44444444-4444-4444-8444-444444444444";
const ROOM_MSG = "55555555-5555-4555-8555-555555555555";
const FILE = "66666666-6666-4666-8666-666666666666";
const AT = "2026-11-24T10:00:00.000000+00:00";

/** The sentence `comms.send_message` raises when a file cannot be linked (00001300). */
const NOT_ATTACHED = "A file could not be attached to this message, so nothing was sent.";

/** A message carrying one uploaded file. */
function withFile(text: string): SendMessageInput {
	return {
		text,
		delta: null,
		replyToId: null,
		attachmentIds: [FILE],
		linkedFileIds: [],
		audio: null,
	};
}

/** The stored `comms.dm_messages` row the send reads back. */
function storedDm(sender: string, body: string) {
	return {
		id: DM_ID,
		thread_id: THREAD,
		sender_user_id: sender,
		body,
		has_attachments: true,
		is_audio: false,
		created_at: AT,
		deleted_at: null,
		body_delta: null,
		reply_to_id: null,
	};
}

/** `comms.dm_threads`, answering a `ref=eq.` lookup and an `id=in.` read with the one thread. */
function threadsRoute(req: FakeRequest) {
	const row = {
		id: THREAD,
		ref: REF,
		kind: "dm",
		title: null,
		photo_file_id: null,
		created_by_user_id: OTHER,
		created_at: AT,
		owner_type: null,
		owner_entity_id: null,
		slug: null,
		last_message_at: AT,
		last_message_id: DM_ID,
	};
	const ref = req.query.get("ref");
	return ref ? (ref === `eq.${REF}` ? [row] : []) : [row];
}

/**
 * The database as it answers a send whose one file cannot be linked: a message insert the store
 * accepts, a link insert RLS refuses, and the send door's own function refusing the whole send.
 */
function refusedFileRoutes(sender: string): Record<string, Route> {
	return {
		"comms.dm_threads": threadsRoute,
		"projects.projects": [{ id: PROJECT }],
		"comms.project_channels": [{ id: ROOM, project_id: PROJECT }],
		"comms.dm_messages": (req: FakeRequest) =>
			req.method === "POST"
				? [storedDm(sender, "See attached.")]
				: [storedDm(sender, "See attached.")],
		"comms.project_messages": (req: FakeRequest) =>
			req.method === "POST"
				? [{ id: ROOM_MSG, created_at: AT, body: "See attached.", body_delta: null }]
				: [],
		"comms.message_attachments": (req: FakeRequest) =>
			req.method === "POST"
				? pgFail(
					"42501",
					'new row violates row-level security policy for table "message_attachments"',
					403,
				)
				: [],
		"comms.rpc.send_message": pgFail("42501", NOT_ATTACHED, 403),
	};
}
// #endregion

// #region All or nothing
Deno.test("a thread send whose file cannot be linked fails whole, as one write", async () => {
	const me = liveActor("00000000-0000-4000-8000-0000000000d1");
	await withEnv(FAKE_LIVE, async () => {
		await withPostgrest(refusedFileRoutes(me.userId), async (calls) => {
			const sent = await MessagingBackendService.sendMessage(
				me,
				{ kind: "thread", ref: REF },
				withFile("See attached."),
				{ limiter: new SlidingWindowLimiter(MESSAGE_SEND_RULE) },
			);
			assert(!sent.ok, "a message whose file was refused must not be reported as sent");
			assertEquals(sent.status, 422);
			assertEquals(sent.errors?.attachmentIds, "not_attached");
			// One write, never a message row and then its links.
			assertEquals(callsTo(calls, "comms.dm_messages").filter((c) => c.method === "POST"), []);
			assertEquals(
				callsTo(calls, "comms.message_attachments").filter((c) => c.method === "POST"),
				[],
			);
			assertEquals(callsTo(calls, "comms.rpc.send_message").length, 1);
		});
	});
});

Deno.test("a room send whose file cannot be linked fails whole, as one write", async () => {
	const me = liveActor("00000000-0000-4000-8000-0000000000d2");
	await withEnv(FAKE_LIVE, async () => {
		await withPostgrest(refusedFileRoutes(me.userId), async (calls) => {
			const sent = await MessagingBackendService.sendMessage(
				me,
				{ kind: "room", ref: "prj-23456789ab", channel: ROOM },
				withFile("See attached."),
				{ limiter: new SlidingWindowLimiter(MESSAGE_SEND_RULE) },
			);
			assert(!sent.ok, "a message whose file was refused must not be reported as sent");
			assertEquals(sent.status, 422);
			assertEquals(sent.errors?.attachmentIds, "not_attached");
			assertEquals(callsTo(calls, "comms.project_messages").filter((c) => c.method === "POST"), []);
			assertEquals(callsTo(calls, "comms.channel_files").filter((c) => c.method === "POST"), []);
			assertEquals(callsTo(calls, "comms.rpc.send_message").length, 1);
		});
	});
});

Deno.test("a copy id that could never be linked refuses the send before any write", async () => {
	const me = liveActor("00000000-0000-4000-8000-0000000000d3");
	await withEnv(FAKE_LIVE, async () => {
		await withPostgrest(refusedFileRoutes(me.userId), async (calls) => {
			const sent = await MessagingBackendService.sendMessage(
				me,
				{ kind: "thread", ref: REF },
				{ ...withFile("See attached."), attachmentIds: ["asset-fixture-7"] },
				{ limiter: new SlidingWindowLimiter(MESSAGE_SEND_RULE) },
			);
			assertEquals(sent.status, 422);
			assertEquals(sent.errors?.attachmentIds, "not_attached");
			assertEquals(callsTo(calls, "comms.rpc.send_message"), []);
		});
	});
});
// #endregion

// #region The voice memo
const PEAKS = [0.125, 0.5, 0.875];

/** A voice memo send: no text, the memo's own upload, its length and envelope. */
function memoSend(): SendMessageInput {
	return {
		text: "",
		delta: null,
		replyToId: null,
		attachmentIds: [FILE],
		linkedFileIds: [],
		audio: { attachmentId: FILE, durationMs: 42_000, peaks: PEAKS },
	};
}

Deno.test("a memo send names its upload, and the echo is the player its link row rebuilds", async () => {
	const me = liveActor("00000000-0000-4000-8000-0000000000d4");
	await withEnv(FAKE_LIVE, async () => {
		await withPostgrest({
			"comms.dm_threads": threadsRoute,
			"comms.dm_messages": [{ ...storedDm(me.userId, ""), is_audio: true }],
			"comms.rpc.send_message": DM_ID,
			"comms.message_attachments": [{
				id: "77777777-7777-4777-8777-777777777777",
				message_id: DM_ID,
				attachment_id: FILE,
				mode: "copy",
				created_at: AT,
				audio_duration_ms: 42_000,
				audio_peaks: PEAKS,
			}],
			"files.items": [{
				id: FILE,
				display_name: "voice-message-20261124-100000.webm",
				original_name: "voice-message-20261124-100000.webm",
				mime_type: "audio/webm",
				source: "supabase",
				status: "uploaded",
				link_url: null,
				external_web_url: null,
				metadata: {},
				size_bytes: 52_000,
			}],
		}, async (calls) => {
			const sent = await MessagingBackendService.sendMessage(
				me,
				{ kind: "thread", ref: REF },
				memoSend(),
				{ limiter: new SlidingWindowLimiter(MESSAGE_SEND_RULE) },
			);
			assert(sent.ok, sent.message);
			const [send] = callsTo(calls, "comms.rpc.send_message");
			assertEquals((send.body as { p_copies?: string[] }).p_copies, [FILE]);
			assertEquals((send.body as { p_audio?: unknown }).p_audio, {
				attachmentId: FILE,
				durationMs: 42_000,
				peaks: PEAKS,
			});
			assertEquals(sent.data?.message.audio, {
				url: `/api/media/proxy/${FILE}`,
				durationMs: 42_000,
				durationLabel: "0:42",
				peaks: PEAKS,
			});
			assertEquals(sent.data?.message.attachments, []);
		});
	});
});

Deno.test("a memo the database refuses names the memo", async () => {
	const me = liveActor("00000000-0000-4000-8000-0000000000d5");
	await withEnv(FAKE_LIVE, async () => {
		await withPostgrest({
			"comms.dm_threads": threadsRoute,
			"comms.rpc.send_message": pgFail("22023", "audio: The voice memo's waveform is not valid."),
		}, async () => {
			const sent = await MessagingBackendService.sendMessage(
				me,
				{ kind: "thread", ref: REF },
				memoSend(),
				{ limiter: new SlidingWindowLimiter(MESSAGE_SEND_RULE) },
			);
			assertEquals(sent.status, 422);
			assertEquals(sent.message, "The voice memo's waveform is not valid.");
			assertEquals(sent.errors?.audio, "invalid");
		});
	});
});
// #endregion
