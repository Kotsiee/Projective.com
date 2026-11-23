import { assert, assertEquals } from "@std/assert";
import type { FxRecordAnswer } from "@projective/types/finance";
import { setSharedKvForTesting } from "../../core/kv.ts";
import { FxService } from "./FxService.ts";
import {
	checkFxFeed,
	FEED_CURRENCIES,
	fixtureFxFeed,
	type FxFeedAdapter,
	FxFeedError,
	type FxRecordCall,
	type FxRecordDoor,
	parseJsonExact,
	readFeedBody,
	toFxRecordAnswer,
} from "./fx-feed.ts";

/**
 * FxService.refreshRates — the daily FX feed (FBP DB17; Decision #337, ruling M5 (f); Decision #471),
 * run against the fixture adapter and an in-memory door that keeps `finance.fx_rates`' unique key
 * (base, quote, as_of) and the ops log. The real door's own checks are `supabase/probes/fx_feed.sql`.
 */

// #region Harness
const AS_OF = "2026-11-23T16:00:00.000Z";
const NOW = Date.parse("2026-11-23T16:23:00Z");

/** A canonical body as a provider sends it: JSON numbers, no GBP, and a currency nobody offers. */
function body(rates: Record<string, string> = {}, extra: Record<string, unknown> = {}): string {
	const all: Record<string, string> = {
		USD: "1.2712345678",
		EUR: "1.1634000000",
		CAD: "1.7712",
		AUD: "1.9433",
		JPY: "196.42",
		INR: "108.9",
		SGD: "1.7021",
		CHF: "1.1102",
		ZAR: "22.871",
		NGN: "2034.5",
		AED: "4.6688",
		XAU: "0.0004",
		...rates,
	};
	const literals = Object.entries(all).map(([code, rate]) => `"${code}": ${rate}`).join(", ");
	const head = JSON.stringify({ base: "GBP", as_of: AS_OF, ...extra }).slice(0, -1);
	return `${head}, "rates": { ${literals} } }`;
}

/** The in-memory door: rows keyed like `uq_fx_rate_observation`, and the log rows it would write. */
function fakeDoor() {
	const rows = new Map<string, string>();
	const log: { level: "error" | "metric"; reason: string | null }[] = [];
	const calls: FxRecordCall[] = [];
	const record: FxRecordDoor = (call) => {
		calls.push(call);
		if (call.failure || !call.rates) {
			const reason = call.failure ?? "feed_unavailable";
			log.push({ level: "error", reason });
			return Promise.resolve<FxRecordAnswer>({
				recorded: 0,
				refused: reason,
				provider: call.provider,
				as_of: call.asOf,
			});
		}
		let recorded = 0;
		for (const [quote, rate] of Object.entries(call.rates)) {
			const key = `GBP|${quote}|${call.asOf}`;
			if (rows.has(key)) continue;
			rows.set(key, rate);
			recorded++;
		}
		log.push({ level: "metric", reason: null });
		return Promise.resolve<FxRecordAnswer>({
			recorded,
			quotes: 12,
			provider: call.provider,
			as_of: call.asOf,
			replay: recorded === 0,
		});
	};
	return { rows, log, calls, record };
}

/** Run `body` with no Deno KV, so a refresh's cache drop touches only memory. */
async function withoutKv(run: () => Promise<void>): Promise<void> {
	setSharedKvForTesting(null);
	try {
		await run();
	} finally {
		setSharedKvForTesting(undefined);
	}
}

const now = () => NOW;
// #endregion

// #region The acceptance
Deno.test("refreshRates: a full feed records 12 rows, each exactly as quoted", () =>
	withoutKv(async () => {
		const door = fakeDoor();
		const result = await FxService.refreshRates({
			feed: fixtureFxFeed(body()),
			record: door.record,
			now,
		});
		assert(result.ok);
		assertEquals(result.data, {
			recorded: 12,
			provider: "fixture",
			asOf: AS_OF,
			outcome: "recorded",
			reason: null,
			currencies: [],
		});
		assertEquals(door.rows.size, 12);
		assertEquals(door.calls[0].failure, null);
		assertEquals(door.rows.get(`GBP|USD|${AS_OF}`), "1.2712345678");
		assertEquals(
			door.rows.get(`GBP|EUR|${AS_OF}`),
			"1.1634000000",
			"the provider's text, not a float's",
		);
		assertEquals(door.rows.get(`GBP|GBP|${AS_OF}`), "1", "the base quotes itself at 1");
		assertEquals(door.rows.has(`GBP|XAU|${AS_OF}`), false, "only the display currencies");
		assertEquals(door.log, [{ level: "metric", reason: null }]);
	}));

Deno.test("refreshRates: a feed missing a currency records none and logs", () =>
	withoutKv(async () => {
		const door = fakeDoor();
		const missing = body().replace(/"NGN": [0-9.]+, /, "");
		const result = await FxService.refreshRates({
			feed: fixtureFxFeed(missing),
			record: door.record,
			now,
		});
		assert(result.ok);
		assertEquals(result.data?.outcome, "refused");
		assertEquals(result.data?.reason, "currency_missing");
		assertEquals(result.data?.currencies, ["NGN"]);
		assertEquals(result.data?.recorded, 0);
		assertEquals(door.rows.size, 0, "none of the 11 was recorded");
		assertEquals(
			door.calls[0].failure,
			"currency_missing",
			"the door is told, so it logs and records nothing",
		);
		assertEquals(door.log, [{ level: "error", reason: "currency_missing" }]);
	}));

Deno.test("refreshRates: a replay records nothing", () =>
	withoutKv(async () => {
		const door = fakeDoor();
		const feed = fixtureFxFeed(body());
		await FxService.refreshRates({ feed, record: door.record, now });
		const again = await FxService.refreshRates({ feed, record: door.record, now });
		assert(again.ok);
		assertEquals(again.data?.outcome, "replay");
		assertEquals(again.data?.recorded, 0);
		assertEquals(door.rows.size, 12);
	}));
// #endregion

// #region Every other refusal
Deno.test("refreshRates: a failed fetch, a missing feed and a wrong base record nothing and log", () =>
	withoutKv(async () => {
		const failing: FxFeedAdapter = {
			provider: "vendor",
			fetchLatest: () => Promise.reject(new FxFeedError("http_error", "503 from the provider")),
		};
		const cases: [FxFeedAdapter | null, string][] = [
			[failing, "http_error"],
			[
				{ provider: "vendor", fetchLatest: () => Promise.reject(new TypeError("network")) },
				"fetch_failed",
			],
			[null, "feed_not_configured"],
			[fixtureFxFeed(body({}, { base: "USD" })), "base_invalid"],
			[fixtureFxFeed("not json"), "body_invalid"],
		];
		for (const [feed, reason] of cases) {
			const door = fakeDoor();
			const result = await FxService.refreshRates({ feed, record: door.record, now });
			assert(result.ok, reason);
			assertEquals(result.data?.outcome, "refused", reason);
			assertEquals(result.data?.reason, reason);
			assertEquals(door.rows.size, 0, reason);
			assertEquals(door.log, [{ level: "error", reason }], reason);
		}
	}));

Deno.test("refreshRates: an unreachable door is a 503, never a silent success", () =>
	withoutKv(async () => {
		const result = await FxService.refreshRates({
			feed: fixtureFxFeed(body()),
			record: () => Promise.reject(new Error("connection refused")),
			now,
		});
		assertEquals(result.ok, false);
		assertEquals(result.status, 503);
	}));

Deno.test("checkFxFeed: refuses what the column could not hold exactly, and an impossible as_of", () => {
	const snapshot = (rates: Record<string, string>, asOf = AS_OF, provider = "fixture") => ({
		...readFeedBody(body(), provider),
		asOf,
		rates: { ...readFeedBody(body(), provider).rates, ...rates },
	});
	const refusal = (s: ReturnType<typeof snapshot>) => {
		const check = checkFxFeed(s, NOW);
		return check.ok ? "ok" : `${check.reason}:${check.currencies.join(",")}`;
	};
	assertEquals(refusal(snapshot({})), "ok");
	assertEquals(refusal(snapshot({ JPY: "1.9642e2" })), "rate_invalid:JPY");
	assertEquals(refusal(snapshot({ USD: "1.27123456789" })), "rate_invalid:USD", "eleven places");
	assertEquals(refusal(snapshot({ EUR: "0" })), "rate_invalid:EUR");
	assertEquals(refusal(snapshot({ EUR: "-1.16" })), "rate_invalid:EUR");
	assertEquals(refusal(snapshot({ GBP: "1.01" })), "rate_invalid:GBP");
	assertEquals(refusal(snapshot({ GBP: "1.0000" })), "ok", "the base at 1, written with places");
	assertEquals(refusal(snapshot({ XAU: "0.0004" })), "currency_unexpected:XAU");
	assertEquals(refusal(snapshot({}, "2026-11-23T17:00:00Z")), "as_of_in_future:");
	assertEquals(refusal(snapshot({}, "")), "as_of_missing:");
	assertEquals(refusal(snapshot({}, AS_OF, "seed")), "provider_invalid:");
	assertEquals(refusal(snapshot({}, AS_OF, "Vendor Name")), "provider_invalid:");
});
// #endregion

// #region The exact parse
Deno.test("parseJsonExact: a JSON number reaches the feed as its own text", () => {
	const parsed = parseJsonExact('{"a": 1.27123456789012345678, "b": [1.10, 2034.5], "c": "x"}');
	assertEquals(parsed, { a: "1.27123456789012345678", b: ["1.10", "2034.5"], c: "x" });
});

Deno.test("readFeedBody: the display currencies only, Unix seconds read as an instant", () => {
	const snapshot = readFeedBody(body({}, { as_of: 1795449600 }), "fixture");
	assertEquals(snapshot.asOf, new Date(1795449600 * 1000).toISOString());
	assertEquals(Object.keys(snapshot.rates).sort(), [...FEED_CURRENCIES].sort());
});

Deno.test("toFxRecordAnswer: the door's two answers map, and any other shape is an error", () => {
	assertEquals(
		toFxRecordAnswer({ recorded: 12, quotes: 12, provider: "fixture", as_of: AS_OF, replay: false })
			.recorded,
		12,
	);
	assertEquals(
		toFxRecordAnswer({
			recorded: 0,
			refused: "currency_missing",
			currencies: ["NGN"],
			provider: "fixture",
			as_of: AS_OF,
		}).refused,
		"currency_missing",
	);
	let threw = false;
	try {
		toFxRecordAnswer({ ok: true });
	} catch {
		threw = true;
	}
	assert(threw);
});
// #endregion
