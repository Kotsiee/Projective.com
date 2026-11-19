import { assert, assertEquals, assertFalse } from "@std/assert";
import { hasVoyageKey } from "../../core/embeddings-gate.ts";
import {
	embeddingsUrlFor,
	VOYAGE_PLATFORM_EMBEDDINGS_URL,
	type VoyageDeps,
	voyageEmbed,
} from "./voyage-client.ts";

/**
 * Voyage pinned (Decision #339 (d); #340, ruling T5; Decision #412 flag (d)): every call goes to
 * api.voyageai.com, and only a Voyage platform key (`pa-…`) counts as a key.
 */

/** Stubbed transport that records every request it is asked to send. */
function stubDeps(key: string): { deps: VoyageDeps; urls: string[] } {
	const urls: string[] = [];
	return {
		urls,
		deps: {
			fetch: (input) => {
				urls.push(String(input));
				return Promise.resolve(Response.json({ data: [], usage: { total_tokens: 0 } }));
			},
			sleep: () => Promise.resolve(),
			now: () => 0,
			random: () => 1,
			apiKey: () => key,
			apiBase: () => undefined,
		},
	};
}

const POLICY = { timeoutMs: 1_000, deadlineMs: 2_000, baseBackoffMs: 1, maxBackoffMs: 1 };

Deno.test("a Voyage platform key counts; an Atlas-shaped or other key is absent, like the placeholder", () => {
	assert(hasVoyageKey("pa-1a2b3c4d5e6f7g8h9i0j"));
	assert(hasVoyageKey("  pa-1a2b3c4d5e6f  "), "surrounding whitespace is trimmed");
	for (
		const key of [
			"al-1a2b3c4d5e6f7g8h",
			"sk-1a2b3c4d5e6f",
			"1a2b3c4d5e6f",
			"pa-",
			"pa- x",
			"XXXX-XXXX",
			"",
			undefined,
		]
	) {
		assertFalse(hasVoyageKey(key), `${key} is not a Voyage key`);
	}
});

Deno.test("an Atlas-shaped key never leaves the process: the call is unconfigured", async () => {
	const { deps, urls } = stubDeps("al-1a2b3c4d5e6f7g8h");
	const outcome = await voyageEmbed(["logo design"], "query", POLICY, deps);
	assertFalse(outcome.ok);
	if (!outcome.ok) assertEquals(outcome.reason, "unconfigured");
	assertEquals(urls, [], "nothing was sent");
});

Deno.test("the URL is api.voyageai.com unless a test points the client at a mock", async () => {
	assertEquals(embeddingsUrlFor(), "https://api.voyageai.com/v1/embeddings");
	assertEquals(embeddingsUrlFor(undefined), VOYAGE_PLATFORM_EMBEDDINGS_URL);
	assertEquals(embeddingsUrlFor("  "), VOYAGE_PLATFORM_EMBEDDINGS_URL);
	assertEquals(embeddingsUrlFor("http://127.0.0.1:9999/"), "http://127.0.0.1:9999/v1/embeddings");
	const { deps, urls } = stubDeps("pa-1a2b3c4d5e6f7g8h");
	await voyageEmbed(["logo design"], "query", POLICY, deps);
	assertEquals(urls, [VOYAGE_PLATFORM_EMBEDDINGS_URL]);
});
