import { assertEquals } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { createSuggestController, SUGGEST_DEBOUNCE_MS } from "./suggest-controller.ts";
import type { Suggestions, SuggestQuery } from "../types/explore-types.ts";
import type { ExploreResult } from "../types/results.ts";

/**
 * The typeahead's three guards: a debounce so a burst of keystrokes is one request, an abort so a
 * superseded request stops, and a sequence number so an answer that lands late — even from a
 * transport that ignores its abort signal — never overwrites the newer query's results.
 */

// #region Stub transport
interface Call {
	query: SuggestQuery;
	signal: AbortSignal;
	resolve: (res: ExploreResult<Suggestions>) => void;
	reject: (error: Error) => void;
}

function stubFetcher() {
	const calls: Call[] = [];
	const fetcher = (query: SuggestQuery, signal: AbortSignal) => {
		const { promise, resolve, reject } = Promise.withResolvers<ExploreResult<Suggestions>>();
		calls.push({ query, signal, resolve, reject });
		return promise;
	};
	return { calls, fetcher };
}

function answer(q: string, extra: Partial<Suggestions> = {}): ExploreResult<Suggestions> {
	return {
		ok: true,
		data: { q, scope: "all", hits: [], terms: [], handles: [], trending: [], ...extra },
	};
}

async function settle(time: FakeTime): Promise<void> {
	await time.runMicrotasks();
}
// #endregion

// #region Debounce
Deno.test("a burst of keystrokes is one request for the last value, after the quiet period", async () => {
	using time = new FakeTime(0);
	const { calls, fetcher } = stubFetcher();
	const ctrl = createSuggestController({ fetcher });

	ctrl.setQuery("b");
	time.tick(120);
	ctrl.setQuery("br");
	time.tick(120);
	ctrl.setQuery("bra");
	assertEquals(ctrl.status.value, "loading");
	time.tick(SUGGEST_DEBOUNCE_MS - 1);
	assertEquals(calls.length, 0);
	time.tick(1);
	assertEquals(calls.length, 1);
	assertEquals(calls[0].query, { q: "bra", scope: "all" });

	calls[0].resolve(answer("bra"));
	await settle(time);
	assertEquals(ctrl.status.value, "ready");
	assertEquals(ctrl.data.value?.q, "bra");
	ctrl.dispose();
});

Deno.test("whitespace-only input cancels the pending request and returns to idle", () => {
	using time = new FakeTime(0);
	const { calls, fetcher } = stubFetcher();
	const ctrl = createSuggestController({ fetcher });

	ctrl.setQuery("design");
	ctrl.setQuery("   ");
	time.tick(SUGGEST_DEBOUNCE_MS * 2);
	assertEquals(calls.length, 0);
	assertEquals(ctrl.status.value, "idle");
	assertEquals(ctrl.data.value, null);
	ctrl.dispose();
});

Deno.test("a scope change re-runs a non-empty query at once, without waiting out the debounce", () => {
	using time = new FakeTime(0);
	const { calls, fetcher } = stubFetcher();
	const ctrl = createSuggestController({ fetcher });

	ctrl.setQuery("motion");
	time.tick(SUGGEST_DEBOUNCE_MS);
	ctrl.setScope("services");
	assertEquals(calls.length, 2);
	assertEquals(calls[0].signal.aborted, true);
	assertEquals(calls[1].query, { q: "motion", scope: "services" });
	ctrl.dispose();
});
// #endregion

// #region Stale responses
Deno.test("a newer query aborts the request in flight", () => {
	using time = new FakeTime(0);
	const { calls, fetcher } = stubFetcher();
	const ctrl = createSuggestController({ fetcher });

	ctrl.setQuery("a");
	time.tick(SUGGEST_DEBOUNCE_MS);
	ctrl.setQuery("ab");
	assertEquals(calls[0].signal.aborted, true);
	time.tick(SUGGEST_DEBOUNCE_MS);
	assertEquals(calls.length, 2);
	assertEquals(calls[1].signal.aborted, false);
	ctrl.dispose();
});

Deno.test("an answer that lands after a newer one is dropped, even if the transport ignored abort", async () => {
	using time = new FakeTime(0);
	const { calls, fetcher } = stubFetcher();
	const ctrl = createSuggestController({ fetcher });

	ctrl.setQuery("a");
	time.tick(SUGGEST_DEBOUNCE_MS);
	ctrl.setQuery("ab");
	time.tick(SUGGEST_DEBOUNCE_MS);

	calls[1].resolve(answer("ab"));
	await settle(time);
	calls[0].resolve(answer("a"));
	await settle(time);

	assertEquals(ctrl.data.value?.q, "ab");
	assertEquals(ctrl.status.value, "ready");
	ctrl.dispose();
});

Deno.test("an answer for a query the reader has since cleared is dropped", async () => {
	using time = new FakeTime(0);
	const { calls, fetcher } = stubFetcher();
	const ctrl = createSuggestController({ fetcher });

	ctrl.setQuery("brand");
	time.tick(SUGGEST_DEBOUNCE_MS);
	ctrl.setQuery("");
	calls[0].resolve(answer("brand"));
	await settle(time);

	assertEquals(ctrl.status.value, "idle");
	assertEquals(ctrl.data.value, null);
	ctrl.dispose();
});

Deno.test("nothing lands after dispose", async () => {
	using time = new FakeTime(0);
	const { calls, fetcher } = stubFetcher();
	const ctrl = createSuggestController({ fetcher });

	ctrl.setQuery("deno");
	time.tick(SUGGEST_DEBOUNCE_MS);
	ctrl.dispose();
	assertEquals(calls[0].signal.aborted, true);
	calls[0].resolve(answer("deno"));
	await settle(time);
	assertEquals(ctrl.data.value, null);
});
// #endregion

// #region Errors + trending
Deno.test("a failure is an error state, and retry re-asks without a debounce", async () => {
	using time = new FakeTime(0);
	const { calls, fetcher } = stubFetcher();
	const ctrl = createSuggestController({ fetcher });

	ctrl.setQuery("seo");
	time.tick(SUGGEST_DEBOUNCE_MS);
	calls[0].resolve({ ok: false, message: "Discovery is unavailable right now." });
	await settle(time);
	assertEquals(ctrl.status.value, "error");
	assertEquals(ctrl.error.value, "Discovery is unavailable right now.");

	ctrl.retry();
	assertEquals(calls.length, 2);
	assertEquals(ctrl.status.value, "loading");
	assertEquals(ctrl.error.value, null);
	calls[1].resolve(answer("seo"));
	await settle(time);
	assertEquals(ctrl.status.value, "ready");
	ctrl.dispose();
});

Deno.test("a transport that rejects reads as an error, not an unhandled rejection", async () => {
	using time = new FakeTime(0);
	const { calls, fetcher } = stubFetcher();
	const ctrl = createSuggestController({ fetcher });

	ctrl.setQuery("ux");
	time.tick(SUGGEST_DEBOUNCE_MS);
	calls[0].reject(new Error("boom"));
	await settle(time);
	assertEquals(ctrl.status.value, "error");
	ctrl.dispose();
});

Deno.test("trending loads once per scope and is served from cache after", async () => {
	using time = new FakeTime(0);
	const { calls, fetcher } = stubFetcher();
	const ctrl = createSuggestController({ fetcher });

	ctrl.prime();
	ctrl.prime();
	assertEquals(calls.length, 1);
	assertEquals(calls[0].query, { q: "", scope: "all" });
	calls[0].resolve(answer("", { trending: ["Branding", "Figma"] }));
	await settle(time);
	assertEquals(ctrl.trending.value, ["Branding", "Figma"]);

	ctrl.setScope("services");
	assertEquals(ctrl.trending.value, null);
	ctrl.setScope("all");
	ctrl.prime();
	assertEquals(calls.length, 1);
	assertEquals(ctrl.trending.value, ["Branding", "Figma"]);
	ctrl.dispose();
});

Deno.test("trending for a scope the reader has left is dropped", async () => {
	using time = new FakeTime(0);
	const { calls, fetcher } = stubFetcher();
	const ctrl = createSuggestController({ fetcher });

	ctrl.prime();
	ctrl.setScope("products");
	assertEquals(calls[0].signal.aborted, true);
	calls[0].resolve(answer("", { trending: ["Branding"] }));
	await settle(time);
	assertEquals(ctrl.trending.value, null);
	ctrl.dispose();
});
// #endregion
