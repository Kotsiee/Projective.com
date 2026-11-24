import { assert, assertEquals } from "@std/assert";
import { MessagingBackendService } from "./MessagingBackendService.ts";
import type { ReadActor } from "../read-actor.ts";

/**
 * chat-read_test — the project chat's read door, `MessagingBackendService.markChatRead(ref)`
 * (PROJECTS CH3; PRD-E13, PRD-E17). One ref, the send's own (`projectChatRef`): a room moves the
 * viewer's own mark through `comms.mark_room_read`, resolved by the send's room rule; a thread is the
 * inbox's `markRead`. Run against a fake PostgREST at `globalThis.fetch`, so the real supabase-js
 * builder parses every answer and no database is touched.
 */

// #region Harness
/** One request the service issued, decoded. */
interface FakeRequest {
	schema: string;
	name: string;
	rpc: boolean;
	body: unknown;
}

/** A static answer, a PostgREST error (`{ error }`), or a function of the request. */
type Route = unknown | ((req: FakeRequest) => unknown);

async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
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

/** Answer every Supabase REST call from `routes`; an unrouted table is `[]`, an unrouted RPC `null`. */
async function withPostgrest(
	routes: Record<string, Route>,
	body: (calls: FakeRequest[]) => Promise<void>,
): Promise<void> {
	const calls: FakeRequest[] = [];
	const realFetch = globalThis.fetch;
	const json = (payload: unknown, status = 200) =>
		new Response(JSON.stringify(payload), {
			status,
			headers: { "content-type": "application/json" },
		});
	globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		const path = new URL(request.url).pathname.replace(/^\/rest\/v1\//, "");
		const rpc = path.startsWith("rpc/");
		const name = rpc ? path.slice(4) : path;
		const schema = request.headers.get("accept-profile") ??
			request.headers.get("content-profile") ??
			"public";
		const text = await request.text();
		const req: FakeRequest = { schema, name, rpc, body: text ? JSON.parse(text) : null };
		calls.push(req);
		const key = `${schema}.${rpc ? "rpc." : ""}${name}`;
		const route = key in routes ? routes[key] : (rpc ? null : []);
		const answer = typeof route === "function"
			? (route as (r: FakeRequest) => unknown)(req)
			: route;
		if (answer && typeof answer === "object" && "error" in answer) {
			return json((answer as { error: unknown }).error, 403);
		}
		if ((request.headers.get("accept") ?? "").includes("vnd.pgrst.object")) {
			const rows = Array.isArray(answer) ? answer : [answer];
			if (rows.length !== 1) {
				return json({ code: "PGRST116", message: "no rows", details: null, hint: null }, 406);
			}
			return json(rows[0]);
		}
		return json(answer);
	};
	try {
		await body(calls);
	} finally {
		globalThis.fetch = realFetch;
	}
}

const FAKE_LIVE = {
	SUPABASE_URL: "http://postgrest.fake",
	SUPABASE_ANON_KEY: "XXXX-XXXX",
	USE_MOCKS: "false",
	VITE_USE_MOCKS: undefined,
	MESSAGING_BACKEND_LIVE: "true",
	PROJECTS_BACKEND_LIVE: "true",
};
const OFF = { ...FAKE_LIVE, MESSAGING_BACKEND_LIVE: "false", PROJECTS_BACKEND_LIVE: "false" };

const ME: ReadActor = {
	userId: "00000000-0000-4000-8000-0000000000d1",
	contextId: "00000000-0000-4000-8000-0000000000d1",
	contextType: "personal",
	accessToken: "XXXX-XXXX",
};
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ROOM = "33333333-3333-4333-8333-333333333333";
const ROOM_REF = { kind: "room", ref: "prj-23456789ab", channel: ROOM } as const;
// #endregion

Deno.test("a room ref moves the viewer's own mark through comms.mark_room_read", async () => {
	await withEnv(FAKE_LIVE, async () => {
		await withPostgrest({
			"projects.projects": [{ id: PROJECT }],
			"comms.project_channels": [{ id: ROOM, project_id: PROJECT }],
			"comms.rpc.mark_room_read": true,
		}, async (calls) => {
			const res = await MessagingBackendService.markChatRead(ROOM_REF, ME);
			assert(res.ok, res.message);
			assertEquals(res.data?.moved, true);
			const marks = calls.filter((c) => c.rpc && c.name === "mark_room_read");
			assertEquals(marks.length, 1);
			assertEquals((marks[0].body as { p_channel_id?: string }).p_channel_id, ROOM);
			// The author of the mark is never the payload's: the door writes auth.uid().
			assertEquals(Object.keys(marks[0].body as object), ["p_channel_id"]);
		});
	});
});

Deno.test("a room the viewer cannot read is a 404, whether unresolved or refused 42501", async () => {
	await withEnv(FAKE_LIVE, async () => {
		await withPostgrest({ "projects.projects": [] }, async (calls) => {
			assertEquals((await MessagingBackendService.markChatRead(ROOM_REF, ME)).status, 404);
			assertEquals(
				calls.filter((c) => c.rpc).length,
				0,
				"nothing is marked for an unresolved room",
			);
		});
		await withPostgrest({
			"projects.projects": [{ id: PROJECT }],
			"comms.project_channels": [{ id: ROOM, project_id: PROJECT }],
			"comms.rpc.mark_room_read": {
				error: { code: "42501", message: "Not a member of this room", details: null, hint: null },
			},
		}, async () => {
			assertEquals((await MessagingBackendService.markChatRead(ROOM_REF, ME)).status, 404);
		});
	});
});

Deno.test("a thread ref is the inbox's own read: a uuid is a 404 with no database call", async () => {
	await withEnv(FAKE_LIVE, async () => {
		await withPostgrest({}, async (calls) => {
			const res = await MessagingBackendService.markChatRead(
				{ kind: "thread", ref: "11111111-1111-4111-8111-111111111111", project: "prj-23456789ab" },
				ME,
			);
			assertEquals(res.status, 404);
			assertEquals(calls.length, 0);
		});
	});
});

Deno.test("the fixture backend keeps its own flags: a room or a thread mark moves nothing", async () => {
	await withEnv(OFF, async () => {
		const room = await MessagingBackendService.markChatRead(ROOM_REF, ME);
		assert(room.ok);
		assertEquals(room.data?.moved, false);
		const thread = await MessagingBackendService.markChatRead(
			{ kind: "thread", ref: "dm-anyone" },
			ME,
		);
		assert(thread.ok);
		assertEquals(thread.data?.moved, false);
	});
});

Deno.test("a signed-in viewer with no token is a 401 on the live path", async () => {
	await withEnv(FAKE_LIVE, async () => {
		const tokenless: ReadActor = {
			userId: ME.userId,
			contextId: ME.contextId,
			contextType: "personal",
		};
		assertEquals((await MessagingBackendService.markChatRead(ROOM_REF, tokenless)).status, 401);
	});
});

// #region Bringing a DM into the project, and taking it out (Decision #560)
const HANDLE = "fern";
const FERN = "00000000-0000-4000-8000-0000000000f1";
const THREAD = "11111111-1111-4111-8111-111111111111";
const REF = "cht-23456789ab";

Deno.test("bring-in names the project and the person by id and answers the thread's cht- address", async () => {
	await withEnv(FAKE_LIVE, async () => {
		await withPostgrest({
			"projects.projects": [{ id: PROJECT }],
			"org.users_public": [{ user_id: FERN }],
			"comms.rpc.bring_dm_into_project": { thread_id: THREAD, thread_ref: REF, moved: true },
		}, async (calls) => {
			const res = await MessagingBackendService.bringDmIntoProject(
				{ projectId: "prj-23456789ab", handle: HANDLE },
				ME,
			);
			assert(res.ok, res.message);
			assertEquals(res.data, { ref: REF, moved: true });
			const [rpc] = calls.filter((c) => c.rpc && c.name === "bring_dm_into_project");
			assertEquals(rpc.body, { p_project_id: PROJECT, p_target_user_id: FERN });
		});
	});
});

Deno.test("bring-in refuses in the door's own words, and answers 404 for what the caller cannot see", async () => {
	await withEnv(FAKE_LIVE, async () => {
		const refusal = (code: string, message: string) => ({
			"projects.projects": [{ id: PROJECT }],
			"org.users_public": [{ user_id: FERN }],
			"comms.rpc.bring_dm_into_project": { error: { code, message, details: null, hint: null } },
		});
		const input = { projectId: "prj-23456789ab", handle: HANDLE };
		const offProject =
			"They are not on this project, so your conversation cannot be brought into it.";
		await withPostgrest(refusal("CH409", offProject), async () => {
			const res = await MessagingBackendService.bringDmIntoProject(input, ME);
			assertEquals(res.status, 409);
			assertEquals(res.message, offProject);
		});
		await withPostgrest(refusal("42501", "No such project"), async () => {
			assertEquals((await MessagingBackendService.bringDmIntoProject(input, ME)).status, 404);
		});
		await withPostgrest(
			{ "projects.projects": [], "org.users_public": [{ user_id: FERN }] },
			async (calls) => {
				assertEquals((await MessagingBackendService.bringDmIntoProject(input, ME)).status, 404);
				assertEquals(
					calls.filter((c) => c.rpc).length,
					0,
					"nothing is asked of the door for an unseen project",
				);
			},
		);
	});
});

Deno.test("take-out resolves the thread by its cht- address and says whether it moved", async () => {
	await withEnv(FAKE_LIVE, async () => {
		await withPostgrest({
			"projects.projects": [{ id: PROJECT }],
			"comms.dm_threads": [{ id: THREAD }],
			"comms.rpc.take_dm_out_of_project": true,
		}, async (calls) => {
			const res = await MessagingBackendService.takeDmOutOfProject(
				{ projectId: "prj-23456789ab", conversationId: REF },
				ME,
			);
			assert(res.ok, res.message);
			assertEquals(res.data, { moved: true });
			const [rpc] = calls.filter((c) => c.rpc && c.name === "take_dm_out_of_project");
			assertEquals(rpc.body, { p_thread_id: THREAD, p_project_id: PROJECT });
		});
	});
});

Deno.test("the fixture backend has no thread to bring in: a 503 the roster reads as its own fallback", async () => {
	await withEnv(OFF, async () => {
		const res = await MessagingBackendService.bringDmIntoProject(
			{ projectId: "prj-23456789ab", handle: HANDLE },
			ME,
		);
		assertEquals(res.status, 503);
		assertEquals(res.details?.reason, "not_live");
	});
});
// #endregion
