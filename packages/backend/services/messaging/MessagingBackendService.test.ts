import { assert, assertEquals } from "@std/assert";
import { MessagingBackendService } from "./MessagingBackendService.ts";
import type { ReadActor } from "../read-actor.ts";

/**
 * CAS M24: the fixture corpus answers only while `MESSAGING_BACKEND_LIVE` is off. With the gate on, a
 * request that cannot read live — a guest, or a signed-in actor whose token is missing — is a 401 and
 * carries no data, so a real person is never shown an invented inbox under their own name.
 *
 * Every case here is refused before any network call, so the tests need no database. `serverEnv()`
 * reads `Deno.env` on every call, so setting it around each case is enough.
 */

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
};

const OFF = { ...LIVE, MESSAGING_BACKEND_LIVE: "false" };

/** Signed in, but with no token Postgres could check. */
const TOKENLESS: ReadActor = {
	userId: "00000000-0000-4000-8000-000000000001",
	contextId: "",
	contextType: "personal",
};

const GUEST: ReadActor = { userId: "", contextId: "", contextType: "personal" };

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
			{
				conversationId: "dm-anyone",
				text: "hello",
				delta: null,
				replyToId: null,
				attachmentIds: [],
				audio: null,
			},
			TOKENLESS,
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
