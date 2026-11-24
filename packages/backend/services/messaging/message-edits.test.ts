import { assert, assertEquals } from "@std/assert";
import { MESSAGE_SEND_RULE, MessagingBackendService } from "./MessagingBackendService.ts";
import type { ReadActor } from "../read-actor.ts";
import { SlidingWindowLimiter } from "../../core/rate-limit.ts";
import type { ChatRef, SendMessageInput } from "@projective/types/messaging";

/**
 * PROJECTS CH1: the author's edit and delete for everyone, through the service. The fixture backend
 * (the live gates off) refuses with the doors' own rule (`messageEditOffer`) and folds the change
 * over every later read; the live path calls `comms.edit_message` / `comms.delete_message` and puts
 * their SQLSTATEs in HTTP terms. The doors themselves are proved by `supabase/probes/message_edit.sql`.
 */

// #region Harness
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

const OFF = {
	SUPABASE_URL: "https://example.supabase.co",
	SUPABASE_ANON_KEY: "anon-key",
	USE_MOCKS: "false",
	VITE_USE_MOCKS: undefined,
	MESSAGING_BACKEND_LIVE: "false",
	PROJECTS_BACKEND_LIVE: "false",
};

const FAKE_LIVE = {
	...OFF,
	SUPABASE_URL: "http://postgrest.fake",
	MESSAGING_BACKEND_LIVE: "true",
	PROJECTS_BACKEND_LIVE: "true",
};

/** Answer every PostgREST call with `answer(rpcName, body)`: `[status, json]`. */
async function withRpc(
	answer: (name: string, body: unknown) => [number, unknown],
	fn: (calls: { name: string; body: unknown }[]) => Promise<void>,
): Promise<void> {
	const calls: { name: string; body: unknown }[] = [];
	const realFetch = globalThis.fetch;
	globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		const name = new URL(request.url).pathname.replace(/^\/rest\/v1\/rpc\//, "");
		const text = await request.text();
		const body = text ? JSON.parse(text) : null;
		calls.push({ name, body });
		const [status, json] = answer(name, body);
		return new Response(JSON.stringify(json), {
			status,
			headers: { "content-type": "application/json" },
		});
	};
	try {
		await fn(calls);
	} finally {
		globalThis.fetch = realFetch;
	}
}

function textMessage(text: string): SendMessageInput {
	return { text, delta: null, replyToId: null, attachmentIds: [], linkedFileIds: [], audio: null };
}

const THREAD: ChatRef = { kind: "thread", ref: "dm-mara" };
const MESSAGE = "7a010c3d-0a24-4910-a512-71b47c30fc63";
// #endregion

// #region The fixture backend
Deno.test("stub: the author edits a message just sent, every read shows it, then deletes it", async () => {
	const me: ReadActor = { userId: "u-ch1-edit", contextId: "", contextType: "personal" };
	await withEnv(OFF, async () => {
		const sent = await MessagingBackendService.sendMessage(me, THREAD, textMessage("First draft"), {
			limiter: new SlidingWindowLimiter(MESSAGE_SEND_RULE),
		});
		assert(sent.ok && sent.data, sent.message);
		const id = sent.data.message.id;

		const edited = await MessagingBackendService.editMessage(
			id,
			THREAD,
			{ text: "Second draft", delta: null },
			me,
		);
		assert(edited.ok && edited.data, edited.message);
		assertEquals(edited.data.change.text, "Second draft");
		assert(edited.data.change.editedAt, "an edit is stamped");

		const page = await MessagingBackendService.messages({ conversationId: "dm-mara" }, me);
		const row = page.data?.page.messages.find((m) => m.id === id);
		assertEquals([
			row?.text,
			row?.editedAt !== null,
			page.data?.page.permissions.edits?.windowMinutes,
		], [
			"Second draft",
			true,
			15,
		]);

		const deleted = await MessagingBackendService.deleteMessage(id, THREAD, me);
		assert(deleted.ok && deleted.data?.change.deleted, deleted.message);
		const after = await MessagingBackendService.messages({ conversationId: "dm-mara" }, me);
		const tomb = after.data?.page.messages.find((m) => m.id === id);
		assertEquals([tomb?.deleted, tomb?.text], [true, ""]);

		const again = await MessagingBackendService.deleteMessage(id, THREAD, me);
		assertEquals([again.status, again.message], [409, "This message was deleted."]);
		const late = await MessagingBackendService.editMessage(id, THREAD, {
			text: "Back",
			delta: null,
		}, me);
		assertEquals(late.status, 409);
	});
});

Deno.test("stub: somebody else's message is refused, and an old one of mine can only be deleted", async () => {
	const me: ReadActor = { userId: "u-ch1-other", contextId: "", contextType: "personal" };
	await withEnv(OFF, async () => {
		const page = await MessagingBackendService.messages({ conversationId: "dm-mara" }, me);
		const messages = page.data?.page.messages ?? [];
		const theirs = messages.find((m) => m.type === "user" && !m.isOwn);
		assert(theirs, "the fixture thread has a message from the other side");
		const refused = await MessagingBackendService.editMessage(
			theirs.id,
			THREAD,
			{ text: "Not mine", delta: null },
			me,
		);
		assertEquals(refused.status, 403);
		assertEquals((await MessagingBackendService.deleteMessage(theirs.id, THREAD, me)).status, 403);

		const mine = messages.find((m) => m.type === "user" && m.isOwn && !m.quoteEventId);
		if (!mine) return;
		const tooLate = await MessagingBackendService.editMessage(
			mine.id,
			THREAD,
			{ text: "Too late", delta: null },
			me,
		);
		assertEquals([tooLate.status, tooLate.message], [
			409,
			"A message can be edited for 15 minutes after it is sent.",
		]);
		assert((await MessagingBackendService.deleteMessage(mine.id, THREAD, me)).ok);
	});
});

Deno.test("stub: a message the chat does not hold is a 404, and a guest is a 401", async () => {
	await withEnv(OFF, async () => {
		const me: ReadActor = { userId: "u-ch1-miss", contextId: "", contextType: "personal" };
		assertEquals((await MessagingBackendService.deleteMessage("nope", THREAD, me)).status, 404);
		const guest: ReadActor = { userId: "", contextId: "", contextType: "personal" };
		assertEquals((await MessagingBackendService.deleteMessage("nope", THREAD, guest)).status, 401);
	});
});
// #endregion

// #region The live doors
const LIVE_ME: ReadActor = {
	userId: "00000000-0000-4000-8000-0000000000e1",
	contextId: "00000000-0000-4000-8000-0000000000e1",
	contextType: "personal",
	accessToken: "token-e1",
};

Deno.test("live: an edit calls comms.edit_message and answers what the message now reads", async () => {
	await withEnv(FAKE_LIVE, async () => {
		await withRpc(
			(name) =>
				name === "edit_message"
					? [200, {
						id: MESSAGE,
						body: "Hello there",
						body_delta: null,
						pii_masked: false,
						edited_at: "2026-11-24T12:05:00+00:00",
						deleted_at: null,
					}]
					: [200, null],
			async (calls) => {
				const res = await MessagingBackendService.editMessage(
					MESSAGE,
					{ kind: "thread", ref: "cht-23456789ab" },
					{ text: "Hello there", delta: null },
					LIVE_ME,
				);
				assert(res.ok, res.message);
				assertEquals(res.data?.change, {
					id: MESSAGE,
					text: "Hello there",
					delta: null,
					editedAt: "2026-11-24T12:05:00+00:00",
					deleted: false,
				});
				const call = calls.find((c) => c.name === "edit_message");
				assertEquals(call?.body, {
					p_message_id: MESSAGE,
					p_body: "Hello there",
					p_body_delta: null,
				});
			},
		);
	});
});

Deno.test("live: the doors' refusals keep their words, and a message nobody can read is a 404", async () => {
	await withEnv(FAKE_LIVE, async () => {
		const cases: [string, number][] = [
			["PM410", 409],
			["PM423", 409],
			["PM409", 409],
			["42501", 403],
			["22023", 422],
			["P0002", 404],
		];
		for (const [code, status] of cases) {
			await withRpc(
				() => [400, { code, message: `refused ${code}`, details: null, hint: null }],
				async () => {
					const res = await MessagingBackendService.deleteMessage(
						MESSAGE,
						{ kind: "room", ref: "prj-abc", channel: "stg-def" },
						LIVE_ME,
					);
					assertEquals(res.status, status, code);
					if (code !== "P0002") assertEquals(res.message, `refused ${code}`);
				},
			);
		}
	});
});
// #endregion
