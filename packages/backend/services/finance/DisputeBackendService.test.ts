import { assertEquals } from "@std/assert";
import type { ReadActor } from "../read-actor.ts";
import { DisputeBackendService } from "./DisputeBackendService.ts";

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

const ACTOR = {
	userId: "u-1",
	contextId: "",
	contextType: "personal",
	accessToken: "token",
} as ReadActor;
const CASE = "3b1d6e0c-1f2a-4c3b-9d4e-5f6a7b8c9d0e";

Deno.test("a dispute call that throws answers 503 rather than throwing into the route (FCA N25)", async () => {
	// Live, but with a Supabase URL the client refuses to build: the throw a real outage can raise.
	await withEnv({
		USE_MOCKS: "false",
		VITE_USE_MOCKS: undefined,
		FINANCE_BACKEND_LIVE: "true",
		SUPABASE_URL: "not a url",
		SUPABASE_ANON_KEY: "anon-key",
	}, async () => {
		const calls = [
			DisputeBackendService.get(CASE, ACTOR),
			DisputeBackendService.escalate(CASE, ACTOR),
			DisputeBackendService.respond(CASE, { statement: "Delivered on time.", fileIds: [] }, ACTOR),
			DisputeBackendService.queue({}, ACTOR),
			DisputeBackendService.resolve(CASE, {
				outcome: "release",
				payeeShareBp: null,
				notes: "Delivered.",
			}, ACTOR),
		];
		for (const res of await Promise.all(calls)) assertEquals([res.ok, res.status], [false, 503]);
	});
});
