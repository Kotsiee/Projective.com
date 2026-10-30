import {
	assert,
	assertAlmostEquals,
	assertEquals,
	assertFalse,
	assertStringIncludes,
} from "@std/assert";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "@projective/types/explore";
import {
	EmbeddingBackendService,
	embeddingBreakerState,
	isEmbeddableQuery,
	kvQueryVectorStore,
	MIN_QUERY_CHARS,
	normaliseQuery,
	queryCacheKey,
	QueryVectorCache,
	type QueryVectorStore,
	setEmbeddingDepsForTesting,
} from "./EmbeddingBackendService.ts";
import {
	DOCUMENT_BATCH,
	embeddingsUrlFor,
	MAX_RETRIES,
	planBatches,
	type VoyageDeps,
	voyageEmbed,
} from "./voyage-client.ts";
import {
	type EmbeddingTarget,
	setEmbeddingSyncDepsForTesting,
	syncEmbeddings,
} from "./embedding-sync.ts";
import { estimateEmbeddingTokens } from "../../core/embedding-text.ts";
import type { CatalogEntity } from "../explore/live-catalog.ts";

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

Deno.test("embeddingsUrlFor — Voyage AI by default, whatever the key; an explicit mock host wins", () => {
	assertEquals(embeddingsUrlFor(), "https://api.voyageai.com/v1/embeddings");
	assertEquals(
		embeddingsUrlFor("http://127.0.0.1:8787/"),
		"http://127.0.0.1:8787/v1/embeddings",
	);
	assertEquals(
		embeddingsUrlFor("not a url"),
		"https://api.voyageai.com/v1/embeddings",
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
	assertEquals(normaliseQuery("Logo Design!"), "logo design");
	assertEquals(normaliseQuery("logo design?"), "logo design");
	assertEquals(normaliseQuery("  ¿c++? "), "c++");
	assertEquals(normaliseQuery("c#."), "c#");
	assertEquals(normaliseQuery("Café"), "café");
	assertEquals(normaliseQuery("ｌｏｇｏ　ｄｅｓｉｇｎ！"), "logo design");
	assertEquals(normaliseQuery("x".repeat(600)).length, 512);
});

Deno.test("isEmbeddableQuery — three characters and a letter", () => {
	assertFalse(isEmbeddableQuery(normaliseQuery("a")));
	assertFalse(isEmbeddableQuery(normaliseQuery("ab")));
	assertFalse(isEmbeddableQuery(normaliseQuery("!!")));
	assertFalse(isEmbeddableQuery(normaliseQuery("123")));
	assertFalse(isEmbeddableQuery(normaliseQuery("3d")));
	assert(isEmbeddableQuery(normaliseQuery("abc")));
	assert(isEmbeddableQuery(normaliseQuery("c++")));
	assertEquals(MIN_QUERY_CHARS, 3);
});

Deno.test("embedQuery — a query that is not embeddable never calls out", async () => {
	const { fetch, calls } = scripted([(c) => okResponse(c.body.input)]);
	setEmbeddingDepsForTesting(deps(fetch));
	try {
		const out = await EmbeddingBackendService.embedQuery("!!");
		assertFalse(out.ok);
		assertEquals(out.status, 422);
		assertEquals(out.details?.reason, "not_embeddable");
		assertEquals(calls.length, 0);
	} finally {
		setEmbeddingDepsForTesting(null);
	}
});

Deno.test("embedQuery — trailing punctuation shares the cache entry", async () => {
	const { fetch, calls } = scripted([(c) => okResponse(c.body.input)]);
	setEmbeddingDepsForTesting(deps(fetch));
	try {
		assert((await EmbeddingBackendService.embedQuery("logo design!")).ok);
		assert((await EmbeddingBackendService.embedQuery("logo design")).ok);
		assertEquals(calls.length, 1, "the second search is a cache hit");
		assertEquals(calls[0].body.input, ["logo design"]);
	} finally {
		setEmbeddingDepsForTesting(null);
	}
});

// #region Query store
/** An in-memory {@link QueryVectorStore} that records every read and write. */
function memoryStore(): QueryVectorStore & {
	gets: Deno.KvKey[];
	sets: Array<{ key: Deno.KvKey; vector: number[] }>;
	entries: Map<string, number[]>;
} {
	const entries = new Map<string, number[]>();
	const gets: Deno.KvKey[] = [];
	const sets: Array<{ key: Deno.KvKey; vector: number[] }> = [];
	return {
		entries,
		gets,
		sets,
		get(key) {
			gets.push(key);
			return Promise.resolve(entries.get(JSON.stringify(key)) ?? null);
		},
		set(key, vector) {
			sets.push({ key, vector: [...vector] });
			entries.set(JSON.stringify(key), [...vector]);
			return Promise.resolve();
		},
	};
}

/** Just enough of `Deno.Kv` for {@link kvQueryVectorStore}: `get` answers `read(key)`. */
function fakeKv(read: (key: Deno.KvKey) => Promise<unknown>): {
	kv: Deno.Kv;
	sets: Array<{ key: Deno.KvKey; value: unknown; options?: { expireIn?: number } }>;
} {
	const sets: Array<{ key: Deno.KvKey; value: unknown; options?: { expireIn?: number } }> = [];
	const kv = {
		get: async (key: Deno.KvKey) => {
			const value = await read(key);
			return { key, value, versionstamp: value === null ? null : "1" };
		},
		set: (key: Deno.KvKey, value: unknown, options?: { expireIn?: number }) => {
			sets.push({ key, value, options });
			return Promise.resolve({ ok: true, versionstamp: "1" });
		},
	};
	return { kv: kv as unknown as Deno.Kv, sets };
}

Deno.test("queryCacheKey — model and width namespaced, the query only as its digest", async () => {
	const key = await queryCacheKey("logo design");
	assertEquals(key.length, 6);
	assertEquals(key.slice(0, 5), [
		"cache",
		"embeddings",
		EMBEDDING_MODEL,
		EMBEDDING_DIMENSIONS,
		"query",
	]);
	assert(/^[0-9a-f]{64}$/.test(String(key[5])), "a SHA-256 hex digest");
	assertFalse(key.some((part) => String(part).includes("logo")), "no raw search text");
	assertEquals(await queryCacheKey("logo design"), key);
	assert((await queryCacheKey("brand identity"))[5] !== key[5]);
});

Deno.test("embedQuery — a store hit never calls Voyage and costs no tokens", async () => {
	const { fetch, calls } = scripted([(c) => okResponse(c.body.input)]);
	const store = memoryStore();
	await store.set(await queryCacheKey("brand identity"), vec(3, 1));
	store.sets.length = 0;
	setEmbeddingDepsForTesting(deps(fetch), store);
	try {
		const out = await EmbeddingBackendService.embedQuery("Brand Identity!");
		assert(out.ok && out.data);
		assertEquals(out.data, vec(3, 1));
		assertEquals(calls.length, 0);
		assertEquals(EmbeddingBackendService.tokensUsed(), 0);
		assert((await EmbeddingBackendService.embedQuery("brand identity")).ok);
		assertEquals(store.gets.length, 1, "the second search is an in-memory hit");
		assertEquals(store.sets.length, 0);
	} finally {
		setEmbeddingDepsForTesting(null);
	}
});

Deno.test("embedQuery — a store miss calls Voyage once and stores the vector; failures are never stored", async () => {
	let down = true;
	const { fetch, calls } = scripted([
		(c) => down ? new Response("down", { status: 500 }) : okResponse(c.body.input, 4),
	]);
	const store = memoryStore();
	setEmbeddingDepsForTesting(deps(fetch), store);
	try {
		assertFalse((await EmbeddingBackendService.embedQuery("logo design")).ok);
		assertEquals(store.sets.length, 0, "a failure is not stored");
		down = false;
		const failedCalls = calls.length;
		const [a, b] = await Promise.all([
			EmbeddingBackendService.embedQuery("logo design"),
			EmbeddingBackendService.embedQuery("Logo  Design"),
		]);
		assert(a.ok && b.ok);
		assertEquals(calls.length, failedCalls + 1);
		assertEquals(store.gets.length, 2, "one read per resolution, shared by the concurrent pair");
		assertEquals(store.sets.length, 1);
		assertEquals(store.sets[0].key, await queryCacheKey("logo design"));
		assertEquals(store.sets[0].vector.length, EMBEDDING_DIMENSIONS);
		assertEquals(EmbeddingBackendService.tokensUsed(), 4);
	} finally {
		setEmbeddingDepsForTesting(null);
	}
});

Deno.test("kvQueryVectorStore — round-trips Float32 bytes with a 7-day expiry", async () => {
	const held = new Map<string, unknown>();
	const { kv, sets } = fakeKv((key) => Promise.resolve(held.get(JSON.stringify(key)) ?? null));
	const store = kvQueryVectorStore(() => Promise.resolve(kv));
	const key = await queryCacheKey("logo design");
	const vector = vec(5, 0.1);
	await store.set(key, vector);
	assertEquals(sets.length, 1);
	assert(sets[0].value instanceof Uint8Array);
	assertEquals((sets[0].value as Uint8Array).byteLength, 4_096);
	assertEquals(sets[0].options?.expireIn, 7 * 24 * 60 * 60 * 1000);
	held.set(JSON.stringify(key), sets[0].value);
	const read = await store.get(key);
	assert(read);
	assertEquals(read, Array.from(Float32Array.from(vector)));
});

Deno.test("kvQueryVectorStore — a wrong-length value, a failed read and no KV are all misses", async () => {
	const key = await queryCacheKey("logo design");
	const short = fakeKv(() => Promise.resolve(new Uint8Array(4 * 512)));
	assertEquals(await kvQueryVectorStore(() => Promise.resolve(short.kv)).get(key), null);
	const broken = fakeKv(() => Promise.reject(new Error("kv down")));
	assertEquals(await kvQueryVectorStore(() => Promise.resolve(broken.kv)).get(key), null);
	const none = kvQueryVectorStore(() => Promise.resolve(null));
	assertEquals(await none.get(key), null);
	await none.set(key, vec(0));

	const { fetch, calls } = scripted([(c) => okResponse(c.body.input)]);
	setEmbeddingDepsForTesting(deps(fetch), kvQueryVectorStore(() => Promise.resolve(short.kv)));
	try {
		assert((await EmbeddingBackendService.embedQuery("logo design")).ok);
		assertEquals(calls.length, 1, "a corrupt stored value falls through to Voyage");
	} finally {
		setEmbeddingDepsForTesting(null);
	}
});

Deno.test("kvQueryVectorStore — a read that hangs past 50 ms is a miss, and the search still embeds", async () => {
	const hung = fakeKv(() => new Promise<never>(() => {}));
	const { fetch, calls } = scripted([(c) => okResponse(c.body.input)]);
	setEmbeddingDepsForTesting(deps(fetch), kvQueryVectorStore(() => Promise.resolve(hung.kv)));
	try {
		const started = performance.now();
		const out = await EmbeddingBackendService.embedQuery("logo design");
		assert(out.ok);
		assertEquals(calls.length, 1);
		assert(performance.now() - started >= 45, "it waited for the timeout, not the read");
		await new Promise((resolve) => setTimeout(resolve, 0));
		assertEquals(hung.sets.length, 1, "the fresh vector is still written back");
	} finally {
		setEmbeddingDepsForTesting(null);
	}
});
// #endregion

// #region syncEmbeddings
function syncTarget(n: number, chars: number): EmbeddingTarget {
	const text = `listing ${n} `.padEnd(chars, "x");
	return {
		itemId: `item-${n}`,
		entity: { kind: "product", id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` },
		text,
		hash: `hash-${n}`,
		tokens: estimateEmbeddingTokens(text),
	};
}

/** Every target stale, every write recorded; `failOnWrite` makes that write (1-based) throw. */
function stubIndex(failOnWrite?: number): { written: string[] } {
	const written: string[] = [];
	setEmbeddingSyncDepsForTesting({
		readEmbeddingStates: () => Promise.resolve(new Map()),
		writeEmbedding: (entity: CatalogEntity) => {
			if (written.length + 1 === failOnWrite) {
				return Promise.reject(new Error("search.fn_set_embedding failed — boom"));
			}
			written.push(entity.id);
			return Promise.resolve(true);
		},
	});
	return { written };
}

Deno.test("syncEmbeddings — one Voyage request per chunk, so a failed request keeps the chunks before it", async () => {
	const targets = Array.from({ length: 6 }, (_, n) => syncTarget(n, 14_000));
	const plan = planBatches(targets.map((t) => t.tokens), DOCUMENT_BATCH);
	assertEquals(
		plan.map((b) => b.length),
		[2, 2, 2],
		"two ~3,500-token texts per 8,000-token batch",
	);
	const { fetch, calls } = scripted([
		(c) => okResponse(c.body.input, 5),
		() => new Response(JSON.stringify({ detail: "bad input" }), { status: 400 }),
		(c) => okResponse(c.body.input, 5),
	]);
	setEmbeddingDepsForTesting(deps(fetch));
	const { written } = stubIndex();
	try {
		const report = await syncEmbeddings(targets, { chunkSize: 64 });
		assertEquals(calls.length, 2, "the third chunk is never sent");
		assertEquals(calls[0].body.input, [targets[0].text, targets[1].text]);
		assertEquals(written, [targets[0].entity.id, targets[1].entity.id]);
		assertEquals(report.embedded, 2);
		assertEquals(report.failed, 4);
		assertEquals(report.tokens, 5);
		assertFalse(report.retryable, "a 400 is not worth waiting out");
		assertStringIncludes(report.error ?? "", "rejected");
	} finally {
		setEmbeddingDepsForTesting(null);
		setEmbeddingSyncDepsForTesting(null);
	}
});

Deno.test("syncEmbeddings — the happy path embeds everything, one fetch per planned batch", async () => {
	const targets = [
		...Array.from({ length: 140 }, (_, n) => syncTarget(n, 40)),
		...Array.from({ length: 3 }, (_, n) => syncTarget(140 + n, 20_000)),
	];
	const { fetch, calls } = scripted([(c) => okResponse(c.body.input, 3)]);
	setEmbeddingDepsForTesting(deps(fetch));
	const { written } = stubIndex();
	const chunks: number[] = [];
	try {
		const report = await syncEmbeddings(targets, {
			chunkSize: 64,
			onChunk: (r) => chunks.push(r.embedded),
		});
		const plan = planBatches(targets.map((t) => t.tokens), { ...DOCUMENT_BATCH, maxInputs: 64 });
		assertEquals(calls.map((c) => c.body.input.length), plan.map((b) => b.length));
		assertEquals(calls.map((c) => c.body.input.length), [64, 64, 13, 1, 1]);
		assertEquals(written.length, targets.length);
		assertEquals(report.embedded, targets.length);
		assertEquals(report.failed, 0);
		assertEquals(report.tokens, 3 * calls.length);
		assertEquals(chunks, [64, 128, 141, 142, 143]);
	} finally {
		setEmbeddingDepsForTesting(null);
		setEmbeddingSyncDepsForTesting(null);
	}
});

Deno.test("syncEmbeddings — a refused write counts the rest of its chunk and every later one as failed", async () => {
	const targets = Array.from({ length: 10 }, (_, n) => syncTarget(n, 40));
	const { fetch, calls } = scripted([(c) => okResponse(c.body.input)]);
	setEmbeddingDepsForTesting(deps(fetch));
	const { written } = stubIndex(6);
	try {
		const report = await syncEmbeddings(targets, { chunkSize: 4 });
		assertEquals(calls.length, 2);
		assertEquals(written.length, 5);
		assertEquals(report.embedded, 5);
		assertEquals(report.failed, 5);
		assertStringIncludes(report.error ?? "", "fn_set_embedding");
	} finally {
		setEmbeddingDepsForTesting(null);
		setEmbeddingSyncDepsForTesting(null);
	}
});
// #endregion

// #region Query breaker
function down(): Response {
	return new Response(JSON.stringify({ detail: "Service Unavailable" }), { status: 503 });
}

function limited(seconds: number): () => Response {
	return () =>
		new Response(JSON.stringify({ detail: "Rate limit exceeded" }), {
			status: 429,
			headers: { "retry-after": String(seconds) },
		});
}

/** Capture the `[embeddings]` transition lines instead of printing them. */
function captureLogs(): { lines: string[]; restore: () => void } {
	const lines: string[] = [];
	const { warn, info } = console;
	console.warn = (...args: unknown[]) => lines.push(args.join(" "));
	console.info = (...args: unknown[]) => lines.push(args.join(" "));
	return {
		lines,
		restore: () => {
			console.warn = warn;
			console.info = info;
		},
	};
}

const CLOSED = { open: false, until: null, failures: 0 };

Deno.test("voyageEmbed — retryRateLimited: false returns a 429 at once, carrying its Retry-After", async () => {
	const sleeps: number[] = [];
	const { fetch, calls } = scripted([limited(60), (c) => okResponse(c.body.input)]);
	const out = await voyageEmbed(
		["a"],
		"query",
		{ ...POLICY, retryRateLimited: false },
		deps(fetch, sleeps),
	);
	assert(!out.ok);
	assertEquals(out.reason, "rate_limited");
	assertEquals(out.attempts, 1);
	assertEquals(out.retryAfterMs, 60_000);
	assertEquals(calls.length, 1);
	assertEquals(sleeps, []);
});

Deno.test("query breaker — three failed calls open it; cache hits are still served; one trial closes it", async () => {
	const clock = { t: 0 };
	const voyage = { up: true };
	const { fetch, calls } = scripted([(c) => voyage.up ? okResponse(c.body.input) : down()]);
	setEmbeddingDepsForTesting(deps(fetch, [], clock));
	const logs = captureLogs();
	try {
		assert((await EmbeddingBackendService.embedQuery("brand identity")).ok);
		voyage.up = false;
		for (const q of ["logo design", "web design", "copywriting"]) {
			assertEquals((await EmbeddingBackendService.embedQuery(q)).details?.reason, "upstream");
		}
		assertEquals(calls.length, 1 + 3 * (MAX_RETRIES + 1));
		const state = embeddingBreakerState();
		assert(state.open);
		assertEquals(state.failures, 3);
		assertEquals(state.until, clock.t + 30_000);
		assertEquals(logs.lines.length, 1, "one line for the transition, none per request");
		assertStringIncludes(logs.lines[0], "voyage-4 query breaker open for 30s — upstream");

		const fetched = calls.length;
		const refused = await EmbeddingBackendService.embedQuery("motion graphics");
		assertFalse(refused.ok);
		assertEquals(refused.status, 503);
		assertEquals(refused.details?.reason, "circuit_open");
		assert(
			(await EmbeddingBackendService.embedQuery("Brand Identity")).ok,
			"a memory hit is served while open",
		);
		assertEquals(calls.length, fetched, "neither touched the network");

		clock.t = state.until ?? 0;
		voyage.up = true;
		assert((await EmbeddingBackendService.embedQuery("motion graphics")).ok);
		assertEquals(calls.length, fetched + 1, "one trial call");
		assertEquals(embeddingBreakerState(), CLOSED);
		assertEquals(logs.lines.at(-1), "[embeddings] voyage-4 query breaker closed");
	} finally {
		logs.restore();
		setEmbeddingDepsForTesting(null);
	}
});

Deno.test("query breaker — one trial at a time, and a failed trial re-opens it", async () => {
	const clock = { t: 0 };
	const gate: { hold: boolean; release?: (res: Response) => void } = { hold: false };
	const { fetch, calls } = scripted([
		() => gate.hold ? new Promise<Response>((resolve) => gate.release = resolve) : down(),
	]);
	setEmbeddingDepsForTesting(deps(fetch, [], clock));
	const logs = captureLogs();
	try {
		for (const q of ["logo design", "web design", "copywriting"]) {
			await EmbeddingBackendService.embedQuery(q);
		}
		clock.t = embeddingBreakerState().until ?? 0;
		gate.hold = true;
		const trial = EmbeddingBackendService.embedQuery("motion graphics");
		const fetched = calls.length;
		assertEquals(
			(await EmbeddingBackendService.embedQuery("brand identity")).details?.reason,
			"circuit_open",
			"a second call waits out the trial",
		);
		gate.hold = false;
		gate.release?.(down());
		assertFalse((await trial).ok);
		assertEquals(calls.length, fetched + MAX_RETRIES, "the trial's own retries, nothing else");
		const state = embeddingBreakerState();
		assert(state.open);
		assertEquals(state.until, clock.t + 30_000);
		assertEquals(logs.lines.length, 2);
	} finally {
		logs.restore();
		setEmbeddingDepsForTesting(null);
	}
});

Deno.test("query breaker — a 429 is not retried, and a Retry-After past the cooldown holds it open that long", async () => {
	const clock = { t: 0 };
	const sleeps: number[] = [];
	const { fetch, calls } = scripted([limited(60)]);
	setEmbeddingDepsForTesting(deps(fetch, sleeps, clock));
	const logs = captureLogs();
	try {
		for (const [n, q] of ["logo design", "web design", "copywriting"].entries()) {
			const out = await EmbeddingBackendService.embedQuery(q);
			assertEquals(out.status, 429);
			assertEquals(out.details?.attempts, 1);
			assertEquals(calls.length, n + 1, "no retry attempt");
		}
		assertEquals(sleeps, []);
		const state = embeddingBreakerState();
		assert(state.open);
		assertEquals(state.until, 60_000);
		assertStringIncludes(logs.lines[0], "voyage-4 query breaker open for 60s — rate_limited");
		clock.t = 59_999;
		assertEquals(
			(await EmbeddingBackendService.embedQuery("motion graphics")).details?.reason,
			"circuit_open",
		);
		assertEquals(calls.length, 3);
		clock.t = 60_000;
		await EmbeddingBackendService.embedQuery("motion graphics");
		assertEquals(calls.length, 4, "the trial goes out once Retry-After has passed");
	} finally {
		logs.restore();
		setEmbeddingDepsForTesting(null);
	}
});

Deno.test("query breaker — a Retry-After holds it open for at most five minutes", async () => {
	const { fetch } = scripted([limited(3_600)]);
	setEmbeddingDepsForTesting(deps(fetch));
	const logs = captureLogs();
	try {
		for (const q of ["logo design", "web design", "copywriting"]) {
			await EmbeddingBackendService.embedQuery(q);
		}
		assertEquals(embeddingBreakerState().until, 5 * 60 * 1000);
	} finally {
		logs.restore();
		setEmbeddingDepsForTesting(null);
	}
});

Deno.test("query breaker — a refusal, a malformed answer or a missing key never trips it", async () => {
	const { fetch, calls } = scripted([
		() => new Response(JSON.stringify({ detail: "bad input" }), { status: 400 }),
	]);
	setEmbeddingDepsForTesting(deps(fetch));
	try {
		for (const q of ["logo design", "web design", "copywriting", "motion graphics"]) {
			assertEquals((await EmbeddingBackendService.embedQuery(q)).details?.reason, "rejected");
		}
		assertEquals(calls.length, 4);
		assertEquals(embeddingBreakerState(), CLOSED);
	} finally {
		setEmbeddingDepsForTesting(null);
	}
});

Deno.test("query budget — a burst of 20 cache misses per isolate, then 5 a second", async () => {
	const clock = { t: 0 };
	const { fetch, calls } = scripted([(c) => okResponse(c.body.input)]);
	setEmbeddingDepsForTesting(deps(fetch, [], clock));
	try {
		const queries = Array.from({ length: 21 }, (_, n) => `query number ${n}`);
		const results = await Promise.all(
			queries.map((q) => EmbeddingBackendService.embedQuery(q)),
		);
		assertEquals(results.filter((r) => r.ok).length, 20);
		assertEquals(results[20].status, 503);
		assertEquals(results[20].details?.reason, "budget");
		assertEquals(calls.length, 20, "the 21st never fetched");
		assert((await EmbeddingBackendService.embedQuery("query number 0")).ok, "a hit spends nothing");
		assertEquals(calls.length, 20);

		clock.t += 200;
		assert((await EmbeddingBackendService.embedQuery("refilled one")).ok);
		assertEquals(
			(await EmbeddingBackendService.embedQuery("refilled two")).details?.reason,
			"budget",
		);
		clock.t += 1_000;
		for (const n of [1, 2, 3, 4, 5]) {
			assert((await EmbeddingBackendService.embedQuery(`a second later ${n}`)).ok);
		}
		assertEquals(
			(await EmbeddingBackendService.embedQuery("a second later 6")).details?.reason,
			"budget",
		);
		assertEquals(calls.length, 26);
		assertEquals(embeddingBreakerState(), CLOSED, "a spent budget is not a Voyage failure");
	} finally {
		setEmbeddingDepsForTesting(null);
	}
});

Deno.test("embedDocuments — still retries a 429, and never trips the query breaker", async () => {
	const { fetch, calls } = scripted([limited(1), limited(1), (c) => okResponse(c.body.input)]);
	setEmbeddingDepsForTesting(deps(fetch));
	try {
		assert((await EmbeddingBackendService.embedDocuments(["a listing"])).ok);
		assertEquals(calls.length, 3);
		assertEquals(embeddingBreakerState(), CLOSED);
	} finally {
		setEmbeddingDepsForTesting(null);
	}
});
// #endregion
