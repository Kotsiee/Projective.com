import {
	assert,
	assertAlmostEquals,
	assertEquals,
	assertFalse,
	assertStringIncludes,
} from "@std/assert";
import { EMBEDDING_DIMENSIONS } from "@projective/types/explore";
import {
	EmbeddingBackendService,
	normaliseQuery,
	QueryVectorCache,
	setEmbeddingDepsForTesting,
} from "./EmbeddingBackendService.ts";
import {
	embeddingsUrlFor,
	MAX_RETRIES,
	planBatches,
	type VoyageDeps,
	voyageEmbed,
} from "./voyage-client.ts";

const KEY = "pa-test-secret-key-1234567890";

interface Call {
	url: string;
	auth: string | null;
	body: { input: string[]; model: string; input_type: string; output_dimension: number };
}

function vec(axis: number, scale = 2): number[] {
	return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === axis ? scale : 0));
}

function okResponse(inputs: string[], tokens = 7): Response {
	return Response.json({
		object: "list",
		data: inputs.map((_, index) => ({ object: "embedding", embedding: vec(index % 8), index })),
		model: "voyage-4",
		usage: { total_tokens: tokens },
	});
}

function scripted(
	steps: Array<(call: Call) => Response | Promise<Response>>,
): { fetch: typeof fetch; calls: Call[] } {
	const calls: Call[] = [];
	const fetchStub: typeof fetch = (input, init) => {
		const call: Call = {
			url: String(input),
			auth: new Headers(init?.headers).get("authorization"),
			body: JSON.parse(String(init?.body)),
		};
		calls.push(call);
		return Promise.resolve(steps[Math.min(calls.length - 1, steps.length - 1)](call));
	};
	return { fetch: fetchStub, calls };
}

function deps(fetchStub: typeof fetch, sleeps: number[] = [], clock = { t: 0 }): VoyageDeps {
	return {
		fetch: fetchStub,
		sleep: (ms) => {
			sleeps.push(ms);
			clock.t += ms;
			return Promise.resolve();
		},
		now: () => clock.t,
		random: () => 1,
		apiKey: () => KEY,
		apiBase: () => undefined,
	};
}

const POLICY = { timeoutMs: 1_000, deadlineMs: 60_000, baseBackoffMs: 100, maxBackoffMs: 5_000 };

Deno.test("voyageEmbed — success sends model, input_type, output_dimension and the key, and normalises", async () => {
	const { fetch, calls } = scripted([(c) => okResponse(c.body.input, 11)]);
	const out = await voyageEmbed(["logo design"], "query", POLICY, deps(fetch));
	assert(out.ok);
	assertEquals(out.attempts, 1);
	assertEquals(out.tokens, 11);
	assertEquals(
		calls[0].url,
		"https://api.voyageai.com/v1/embeddings",
		"a pa- key is a Voyage platform key",
	);
	assertEquals(calls[0].auth, `Bearer ${KEY}`);
	assertEquals(calls[0].body, {
		input: ["logo design"],
		model: "voyage-4",
		input_type: "query",
		output_dimension: 1024,
	});
	assertAlmostEquals(Math.hypot(...out.vectors[0]), 1, 1e-9);
});

Deno.test("voyageEmbed — a 429 is retried after Retry-After, then succeeds", async () => {
	const sleeps: number[] = [];
	const { fetch, calls } = scripted([
		() =>
			new Response(JSON.stringify({ detail: "Rate limit exceeded" }), {
				status: 429,
				headers: { "retry-after": "2" },
			}),
		(c) => okResponse(c.body.input),
	]);
	const out = await voyageEmbed(["a"], "document", POLICY, deps(fetch, sleeps));
	assert(out.ok);
	assertEquals(out.attempts, 2);
	assertEquals(calls.length, 2);
	assertEquals(sleeps, [2_000]);
});

Deno.test("voyageEmbed — a persistent 500 stops after two retries with backoff", async () => {
	const sleeps: number[] = [];
	const { fetch, calls } = scripted([() => new Response("boom", { status: 500 })]);
	const out = await voyageEmbed(["a"], "document", POLICY, deps(fetch, sleeps));
	assertFalse(out.ok);
	if (out.ok) return;
	assertEquals(out.reason, "upstream");
	assertEquals(out.status, 500);
	assertEquals(calls.length, MAX_RETRIES + 1);
	assertEquals(sleeps, [100, 200]);
});

Deno.test("voyageEmbed — a 400 or 401 is not retried, and the key never reaches the detail", async () => {
	const { fetch, calls } = scripted([
		() =>
			new Response(JSON.stringify({ detail: `Provided API key ${KEY} is invalid` }), {
				status: 401,
			}),
	]);
	const out = await voyageEmbed(["a"], "query", POLICY, deps(fetch));
	assertFalse(out.ok);
	if (out.ok) return;
	assertEquals(out.reason, "rejected");
	assertEquals(calls.length, 1);
	assertFalse(out.detail.includes(KEY));
	assertStringIncludes(out.detail, "[redacted]");
});

Deno.test("voyageEmbed — network errors are retried; a missing key never calls out", async () => {
	let attempts = 0;
	const flaky: typeof fetch = (_input, init) => {
		attempts++;
		if (attempts < 3) return Promise.reject(new TypeError("connection reset"));
		return Promise.resolve(okResponse(JSON.parse(String(init?.body)).input));
	};
	const out = await voyageEmbed(["a"], "query", POLICY, deps(flaky));
	assert(out.ok);
	assertEquals(out.attempts, 3);

	const { fetch, calls } = scripted([(c) => okResponse(c.body.input)]);
	const unconfigured = await voyageEmbed(["a"], "query", POLICY, {
		...deps(fetch),
		apiKey: () => "XXXX-XXXX",
	});
	assertFalse(unconfigured.ok);
	assertEquals(calls.length, 0);
});

Deno.test("voyageEmbed — a hung request times out, and no attempt starts past the deadline", async () => {
	const clock = { t: 0 };
	const hung: typeof fetch = (_input, init) =>
		new Promise((_resolve, reject) => {
			init?.signal?.addEventListener("abort", () => {
				clock.t += 20;
				reject(new DOMException("aborted", "AbortError"));
			});
		});
	const out = await voyageEmbed(
		["a"],
		"query",
		{ timeoutMs: 20, deadlineMs: 25, baseBackoffMs: 10, maxBackoffMs: 10 },
		deps(hung, [], clock),
	);
	assertFalse(out.ok);
	if (out.ok) return;
	assertEquals(out.reason, "timeout");
	assertEquals(out.attempts, 1, "the 10 ms backoff would cross the 25 ms deadline");
});

Deno.test("voyageEmbed — a response with the wrong width is refused, not stored", async () => {
	const { fetch } = scripted([
		() => Response.json({ data: [{ embedding: [1, 0, 0], index: 0 }], usage: { total_tokens: 1 } }),
	]);
	const out = await voyageEmbed(["a"], "document", POLICY, deps(fetch));
	assertFalse(out.ok);
	if (!out.ok) assertEquals(out.reason, "invalid_response");
});

Deno.test("embeddingsUrlFor — Atlas by default, Voyage for a platform key, an explicit host wins", () => {
	assertEquals(embeddingsUrlFor("al-atlas-model-key"), "https://ai.mongodb.com/v1/embeddings");
	assertEquals(embeddingsUrlFor("pa-platform-key"), "https://api.voyageai.com/v1/embeddings");
	assertEquals(
		embeddingsUrlFor("pa-platform-key", "https://eu.ai.mongodb.com/"),
		"https://eu.ai.mongodb.com/v1/embeddings",
	);
	assertEquals(
		embeddingsUrlFor("al-atlas-model-key", "not a url"),
		"https://ai.mongodb.com/v1/embeddings",
		"an unusable override is ignored, not followed",
	);
});

Deno.test("planBatches — respects both the input and the token ceilings", () => {
	assertEquals(planBatches([1, 1, 1, 1, 1], { maxInputs: 2, maxTokens: 100 }), [[0, 1], [2, 3], [
		4,
	]]);
	assertEquals(planBatches([60, 60, 30], { maxInputs: 10, maxTokens: 100 }), [[0], [1, 2]]);
	assertEquals(planBatches([500], { maxInputs: 10, maxTokens: 100 }), [[0]]);
	assertEquals(planBatches([]), []);
});

Deno.test("embedDocuments — batches in order and adds up Voyage's token usage", async () => {
	const { fetch, calls } = scripted([(c) => okResponse(c.body.input, 5)]);
	setEmbeddingDepsForTesting(deps(fetch));
	try {
		const texts = Array.from({ length: 300 }, (_, i) => `document ${i}`);
		const res = await EmbeddingBackendService.embedDocuments(texts);
		assert(res.ok && res.data);
		assertEquals(res.data.length, 300);
		assertEquals(calls.length, 3, "128 + 128 + 44");
		assert(calls.every((c) => c.body.input_type === "document"));
		assertEquals(EmbeddingBackendService.tokensUsed(), 15);
	} finally {
		setEmbeddingDepsForTesting(null);
	}
});

Deno.test("embedDocuments — a batch that keeps failing fails the call (the caller falls back)", async () => {
	const { fetch } = scripted([() => new Response("unavailable", { status: 503 })]);
	setEmbeddingDepsForTesting(deps(fetch));
	try {
		const res = await EmbeddingBackendService.embedDocuments(["a", "b"]);
		assertFalse(res.ok);
		assertEquals(res.status, 502);
		assertEquals(res.details?.reason, "upstream");
	} finally {
		setEmbeddingDepsForTesting(null);
	}
});

Deno.test("embedQuery — cached by the normalised query, shared while in flight, failures not cached", async () => {
	let fail = true;
	const { fetch, calls } = scripted([
		(c) => fail ? new Response("down", { status: 500 }) : okResponse(c.body.input),
	]);
	setEmbeddingDepsForTesting(deps(fetch));
	try {
		const first = await EmbeddingBackendService.embedQuery("Brand  Identity");
		assertFalse(first.ok, "the first call fails after its retries");
		const failedCalls = calls.length;
		fail = false;
		const [a, b] = await Promise.all([
			EmbeddingBackendService.embedQuery("brand identity"),
			EmbeddingBackendService.embedQuery("  BRAND identity "),
		]);
		assert(a.ok && b.ok);
		assertEquals(calls.length, failedCalls + 1, "one call for the concurrent pair");
		assertEquals(calls.at(-1)?.body.input, ["brand identity"]);
		assertEquals(calls.at(-1)?.body.input_type, "query");
		const again = await EmbeddingBackendService.embedQuery("Brand Identity");
		assert(again.ok);
		assertEquals(calls.length, failedCalls + 1, "served from the cache");
	} finally {
		setEmbeddingDepsForTesting(null);
	}
});

Deno.test("QueryVectorCache — least recently used goes first, and entries expire", () => {
	let now = 0;
	const cache = new QueryVectorCache(2, 1_000, () => now);
	cache.set("a", [1]);
	cache.set("b", [2]);
	assertEquals(cache.get("a"), [1], "a is now the most recent");
	cache.set("c", [3]);
	assertEquals(cache.get("b"), undefined, "b was the least recently used");
	assertEquals(cache.get("a"), [1]);
	now = 1_000;
	assertEquals(cache.get("a"), undefined, "expired at its TTL");
	assertEquals(cache.size, 1);
});

Deno.test("normaliseQuery — one key for one meaning", () => {
	assertEquals(normaliseQuery("  Brnd\tIdentity  "), "brnd identity");
	assertEquals(normaliseQuery("ＬＯＧＯ"), "logo");
	assertEquals(normaliseQuery("   "), "");
});
