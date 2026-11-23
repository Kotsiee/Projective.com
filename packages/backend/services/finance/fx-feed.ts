import {
	DISPLAY_CURRENCIES,
	FX_PROVIDER_SLUG,
	FX_RATE_LITERAL,
	type FxFeedSnapshot,
	type FxRecordAnswer,
	FxRecordAnswerSchema,
	PLATFORM_BASE_CURRENCY,
} from "@projective/types/finance";
import { getServiceClient } from "../../core/supabase.ts";

/**
 * fx-feed — the daily FX feed's provider side (Decision #337, ruling M5 (f); Decision #471; FBP
 * DB17): the adapter interface a reference-rate provider is read through, the exact parse every
 * adapter uses, the validation a feed must pass before anything is recorded, and the door that
 * records it (`finance.record_fx_rates`). `FxService.refreshRates` runs them in order.
 *
 * ## Exact, never a float
 *
 * Since Decision #435 these rates price conversions inside purchases, so a rate is carried as the
 * provider's own decimal text from the response body to the `numeric(20, 10)` column. A JSON number
 * is read through `JSON.parse`'s source text, never through a `number`, and a literal the column
 * could not hold exactly ({@link FX_RATE_LITERAL}) refuses the whole feed.
 *
 * ## The provider
 *
 * One commercial reference-rate API quoting all 12 display currencies against GBP (#471 (A)). Which
 * vendor, and its plan, is still the owner's to pick, so the only adapter is
 * {@link fixtureFxFeed}, over a canonical body; {@link configuredFxFeed} answers `null` until the
 * vendor's adapter lands here, reading `FX_FEED_URL` / `FX_FEED_API_KEY`.
 */

// #region Adapter
/** A source of the day's rates against the platform base. */
export interface FxFeedAdapter {
	/** The provider slug its rows are written under. */
	readonly provider: string;
	/** The newest observation. Rejects with an {@link FxFeedError} when it cannot be had. */
	fetchLatest(): Promise<FxFeedSnapshot>;
}

/** A feed that could not be fetched or read, with the snake_case code the ops row names it by. */
export class FxFeedError extends Error {
	constructor(readonly code: string, message: string) {
		super(message);
		this.name = "FxFeedError";
	}
}

/** The display currencies a feed must quote, in menu order. */
export const FEED_CURRENCIES: readonly string[] = Object.freeze(
	DISPLAY_CURRENCIES.map((c) => c.code),
);

/**
 * Parse JSON with every number kept as its source text, so `1.10` stays `"1.10"` and a twenty-digit
 * rate is not rounded to a double. Throws `SyntaxError` on a malformed body.
 */
export function parseJsonExact(text: string): unknown {
	return JSON.parse(
		text,
		(_key: string, value: unknown, context?: { source?: string }) =>
			typeof value === "number" ? (context?.source ?? String(value)) : value,
	);
}

/**
 * Read a canonical feed body — `{ "base": "GBP", "as_of": <ISO 8601 or Unix seconds>,
 * "rates": { "USD": 1.27, … } }` — into a snapshot: the display currencies only (a provider that
 * quotes more is not refused for it), the base quoting itself at `1` when the body leaves it out, and
 * every rate as its exact text. Throws {@link FxFeedError} `body_invalid` for anything else.
 */
export function readFeedBody(text: string, provider: string): FxFeedSnapshot {
	let body: unknown;
	try {
		body = parseJsonExact(text);
	} catch {
		throw new FxFeedError("body_invalid", "The feed's body is not JSON.");
	}
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new FxFeedError("body_invalid", "The feed's body is not an object.");
	}
	const record = body as Record<string, unknown>;
	const rates = record.rates;
	if (!rates || typeof rates !== "object" || Array.isArray(rates)) {
		throw new FxFeedError("body_invalid", "The feed's body has no rates object.");
	}
	const base = typeof record.base === "string" ? record.base.trim().toUpperCase() : "";
	const out: Record<string, string> = {};
	for (const [code, value] of Object.entries(rates as Record<string, unknown>)) {
		const upper = code.trim().toUpperCase();
		if (!FEED_CURRENCIES.includes(upper)) continue;
		out[upper] = typeof value === "string" ? value.trim() : JSON.stringify(value);
	}
	if (base && !(base in out)) out[base] = "1";
	return { provider, base, asOf: readAsOf(record.as_of), rates: out };
}

/** An `as_of` as ISO 8601: an ISO string, or Unix seconds (a number's source text). `""` when absent. */
function readAsOf(value: unknown): string {
	if (typeof value !== "string" || value.trim() === "") return "";
	const text = value.trim();
	if (/^\d{1,12}$/.test(text)) return new Date(Number(text) * 1000).toISOString();
	const parsed = Date.parse(text);
	return Number.isNaN(parsed) ? text : new Date(parsed).toISOString();
}

/**
 * An adapter over a fixed body, for tests and local runs: it reads `body` exactly as a vendor's
 * adapter reads a response. Never configured by environment.
 */
export function fixtureFxFeed(body: string, provider = "fixture"): FxFeedAdapter {
	return {
		provider,
		fetchLatest: () => Promise.resolve().then(() => readFeedBody(body, provider)),
	};
}

/**
 * The feed this environment runs: `null` until the owner picks the vendor (#471) and its adapter
 * lands here, keyed by `FX_FEED_URL` and `FX_FEED_API_KEY`. A run with no feed records nothing and
 * says so (`feed_not_configured`).
 */
export function configuredFxFeed(): FxFeedAdapter | null {
	return null;
}
// #endregion

// #region Validation
/** A feed that may be recorded, or why it may not, and which currencies the reason names. */
export type FxFeedCheck =
	| { ok: true }
	| { ok: false; reason: string; currencies: string[] };

/**
 * Whether `snapshot` may be recorded, by the rules `finance.record_fx_rates` applies again: a
 * provider slug that is not `seed`; the platform base; an `as_of` that parses and is not in the
 * future; every display currency and nothing else; every rate an exact positive decimal the column
 * holds, and the base at exactly 1. Pure.
 */
export function checkFxFeed(snapshot: FxFeedSnapshot, now: number): FxFeedCheck {
	const refuse = (reason: string, currencies: string[] = []): FxFeedCheck => ({
		ok: false,
		reason,
		currencies,
	});
	if (!FX_PROVIDER_SLUG.test(snapshot.provider) || snapshot.provider === "seed") {
		return refuse("provider_invalid");
	}
	if (snapshot.base !== PLATFORM_BASE_CURRENCY) return refuse("base_invalid");
	const asOf = Date.parse(snapshot.asOf);
	if (!snapshot.asOf || Number.isNaN(asOf)) return refuse("as_of_missing");
	if (asOf > now) return refuse("as_of_in_future");
	const given = Object.keys(snapshot.rates);
	const missing = FEED_CURRENCIES.filter((code) => !given.includes(code));
	if (missing.length > 0) return refuse("currency_missing", [...missing].sort());
	const unexpected = given.filter((code) => !FEED_CURRENCIES.includes(code));
	if (unexpected.length > 0) return refuse("currency_unexpected", unexpected.sort());
	const invalid = FEED_CURRENCIES.filter((code) => !exactRate(snapshot.rates[code], code));
	if (invalid.length > 0) return refuse("rate_invalid", [...invalid].sort());
	return { ok: true };
}

/** Whether `text` is a rate the column stores exactly: positive, and exactly 1 for the base. */
function exactRate(text: string | undefined, code: string): boolean {
	if (typeof text !== "string" || !FX_RATE_LITERAL.test(text)) return false;
	const [whole, fraction = ""] = text.split(".");
	const positive = /[1-9]/.test(whole + fraction);
	if (code !== PLATFORM_BASE_CURRENCY) return positive;
	return /^0*1$/.test(whole) && /^0*$/.test(fraction);
}
// #endregion

// #region Recording
/** One call of `finance.record_fx_rates`: the observation, or a refusal found before it. */
export interface FxRecordCall {
	provider: string;
	asOf: string | null;
	rates: Record<string, string> | null;
	/** A refusal the service found first; the door then records nothing and logs it. */
	failure: string | null;
}

/** Where a feed is recorded. Rejects only when the door could not be reached. */
export type FxRecordDoor = (call: FxRecordCall) => Promise<FxRecordAnswer>;

/** The live door, as the service role (`finance.record_fx_rates`, Decision #471). */
export const liveFxRecordDoor: FxRecordDoor = async (call) => {
	const { data, error } = await getServiceClient().schema("finance").rpc("record_fx_rates", {
		p_provider: call.provider,
		p_as_of: call.asOf,
		p_rates: call.rates,
		p_failure: call.failure,
	});
	if (error) throw new Error(`finance.record_fx_rates failed (${error.code ?? "no code"})`);
	return toFxRecordAnswer(data);
};

/** Map the door's jsonb answer; a shape it never returns is an error, not a guess. */
export function toFxRecordAnswer(data: unknown): FxRecordAnswer {
	const parsed = FxRecordAnswerSchema.safeParse(data);
	if (!parsed.success) throw new Error("finance.record_fx_rates answered an unexpected shape");
	return parsed.data;
}
// #endregion
