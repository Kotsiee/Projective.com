import Stripe from "stripe";
import { serverEnv } from "./env.ts";
import { isFinanceBackendLive } from "./supabase.ts";

/**
 * stripe.ts — server-side Stripe provisioning for the fat service layer, the twin of `supabase.ts`.
 *
 * Stripe owns the FIAT RAILS (card acquiring, Connect payouts, Identity checks); Projective's
 * `finance.*` tables stay the ledger of record (SYSTEM_ARCHITECTURE §Integration Blueprints → Stripe).
 * Nothing in this module moves money on its own — it only hands a configured client to the services
 * that do, and verifies the signature of what Stripe sends back.
 *
 * ## Three rules this module exists to hold
 *
 * 1. **A placeholder is not a key.** `.env.example` ships `XXXX-XXXX` for every secret, and a copied
 *    template must degrade to "payments are not connected here", not to a stream of authentication
 *    failures at Stripe. So a value only counts as configured when it is SHAPED like the key it claims
 *    to be (`sk_`/`rk_`, `pk_`, `whsec_`).
 * 2. **Two switches, both required.** Money moves only when `FINANCE_BACKEND_LIVE` is on (the
 *    per-domain gate every fat service shares) AND a well-formed secret key exists. Either alone is a
 *    half-configured environment, which is exactly the state that fires a half-wired mutation.
 * 3. **The client is built lazily and never at import.** A missing key must not crash app boot — the
 *    same contract `getServiceClient()` keeps.
 */

// #region Configuration
/**
 * The Stripe API version every request is pinned to. Pinned explicitly (not left to the account
 * default) so a Dashboard upgrade can never change a response shape under a running deploy. Matches
 * the version the installed SDK (`stripe@22.6.x`) was generated against.
 */
export const STRIPE_API_VERSION = "2026-08-26.dahlia" as const;

/** Which Stripe environment a key belongs to. Test keys can never move real money. */
export type StripeMode = "test" | "live";

/** The validated Stripe configuration. Read via {@link stripeSettings}. */
export interface StripeSettings {
	/** The secret or restricted key. Never logged, never serialised, never sent to a client. */
	secretKey: string;
	/** `test` or `live`, taken from the key prefix. */
	mode: StripeMode;
	/** True for a restricted key (`rk_…`) — Stripe's recommended least-privilege credential. */
	restricted: boolean;
	/** The webhook signing secret, or `null` when absent or malformed (no event is then processed). */
	webhookSecret: string | null;
	/** The v2 thin-event destination's signing secret, or `null` (the v2 endpoint then answers 503). */
	thinWebhookSecret: string | null;
	/**
	 * The publishable key, or `null` when absent, malformed, or from the OTHER mode than the secret key —
	 * a `pk_live` beside an `sk_test` would confirm a test PaymentIntent against the live account, which
	 * fails at Stripe with an error nobody can act on from the page.
	 */
	publishableKey: string | null;
	/**
	 * A development-only API origin (`STRIPE_API_BASE`, e.g. `stripe-mock`), or `null` for Stripe
	 * itself. Always `null` for a live key and under `DENO_ENV=production`: a live key pointed at a mock
	 * would record charges that never happened.
	 */
	apiBase: { host: string; port: string; protocol: "http" | "https" } | null;
}

const SECRET_KEY_RE = /^(sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/;
const PUBLISHABLE_KEY_RE = /^pk_(test|live)_[A-Za-z0-9]{8,}$/;
const WEBHOOK_SECRET_RE = /^whsec_[A-Za-z0-9+/=]{8,}$/;

/**
 * Validate raw Stripe environment values into {@link StripeSettings}. Pure, so the placeholder and
 * mode-mismatch rules are testable without touching the process environment.
 *
 * `null` when there is no usable secret key: without one there is no Stripe integration at all, and
 * a webhook secret or publishable key on its own configures nothing.
 */
export function parseStripeSettings(raw: {
	secretKey?: string;
	webhookSecret?: string;
	thinWebhookSecret?: string;
	publishableKey?: string;
	apiBase?: string;
	appEnv?: string;
}): StripeSettings | null {
	const secret = raw.secretKey?.trim() ?? "";
	const match = SECRET_KEY_RE.exec(secret);
	if (!match) return null;
	const mode = match[2] as StripeMode;

	const webhook = raw.webhookSecret?.trim() ?? "";
	const publishable = raw.publishableKey?.trim() ?? "";
	const pk = PUBLISHABLE_KEY_RE.exec(publishable);

	return {
		secretKey: secret,
		mode,
		restricted: match[1] === "rk",
		webhookSecret: WEBHOOK_SECRET_RE.test(webhook) ? webhook : null,
		thinWebhookSecret: WEBHOOK_SECRET_RE.test(raw.thinWebhookSecret?.trim() ?? "")
			? raw.thinWebhookSecret!.trim()
			: null,
		publishableKey: pk && pk[1] === mode ? publishable : null,
		apiBase: mode === "test" && raw.appEnv !== "production" ? parseApiBase(raw.apiBase) : null,
	};
}

/** Parse a `STRIPE_API_BASE` origin; anything that is not a plain http(s) origin is ignored. */
function parseApiBase(value: string | undefined): StripeSettings["apiBase"] {
	if (!value?.trim()) return null;
	try {
		const url = new URL(value.trim());
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		const protocol = url.protocol === "http:" ? "http" : "https";
		return { host: url.hostname, port: url.port || (protocol === "http" ? "80" : "443"), protocol };
	} catch {
		return null;
	}
}

/** The validated Stripe configuration of this process, or `null` when Stripe is not configured. */
export function stripeSettings(): StripeSettings | null {
	const env = serverEnv();
	return parseStripeSettings({
		secretKey: env.stripeSecretKey,
		webhookSecret: env.stripeWebhookSecret,
		thinWebhookSecret: env.stripeThinWebhookSecret,
		publishableKey: env.stripePublishableKey,
		apiBase: env.stripeApiBase,
		appEnv: env.appEnv,
	});
}

/** True when a well-formed Stripe secret key is present. Says nothing about the finance gate. */
export function isStripeConfigured(): boolean {
	return stripeSettings() !== null;
}

/**
 * True when card payments, Connect onboarding and Identity sessions may call Stripe: the finance
 * backend is live AND Stripe is configured. The one predicate every Stripe-calling service method
 * checks first.
 */
export function isPaymentsLive(): boolean {
	return isFinanceBackendLive() && isStripeConfigured();
}
// #endregion

// #region Client
/**
 * Build a Stripe client for a key. Exposed (rather than hidden behind {@link getStripe}) so a test or
 * a verification script can point the SAME request builders at `stripe-mock` through `overrides`
 * (`host`/`port`/`protocol`) without widening the environment contract.
 *
 * The fetch-based HTTP client is required under Deno and on Deno Deploy / Edge Functions; the Node
 * `http` client the SDK defaults to is not what this runtime should be exercising.
 */
export function createStripeClient(
	secretKey: string,
	overrides: Partial<Stripe.StripeConfig> = {},
): Stripe {
	return new Stripe(secretKey, {
		apiVersion: STRIPE_API_VERSION,
		httpClient: Stripe.createFetchHttpClient(),
		// Network errors and 409/429/5xx are retried with Stripe's own backoff. Safe for every call this
		// layer makes, because every mutating request carries an `Idempotency-Key`.
		maxNetworkRetries: 2,
		timeout: 20_000,
		appInfo: { name: "Projective" },
		...overrides,
	});
}

let cached: { key: string; client: Stripe } | null = null;

/**
 * The process's Stripe client, built on first use. Throws when Stripe is not configured — callers
 * gate on {@link isPaymentsLive} first, exactly as they gate `getServiceClient()` on the Supabase
 * predicates. A development `apiBase` (see {@link StripeSettings.apiBase}) routes it to a mock.
 */
export function getStripe(): Stripe {
	const settings = stripeSettings();
	if (!settings) {
		throw new Error("Stripe is not configured (STRIPE_SECRET_KEY).");
	}
	const base = settings.apiBase;
	const cacheKey = base
		? `${settings.secretKey}@${base.protocol}://${base.host}:${base.port}`
		: settings.secretKey;
	if (!cached || cached.key !== cacheKey) {
		cached = { key: cacheKey, client: createStripeClient(settings.secretKey, base ?? {}) };
	}
	return cached.client;
}

/**
 * The `Idempotency-Key` Stripe sees for one operation. Namespaced by operation so two different
 * calls made for one Projective attempt (create a PaymentIntent; later, retrieve it) can never
 * collide, and capped at Stripe's 255-character limit.
 */
export function stripeIdempotencyKey(operation: string, key: string): string {
	return `projective:${operation}:${key}`.slice(0, 255);
}
// #endregion

// #region Webhook verification
/**
 * Verify a webhook delivery and parse its event. Throws `Stripe.errors.StripeSignatureVerificationError`
 * when the signature, the timestamp tolerance (300 s — a replayed old delivery is refused) or the
 * payload does not check out.
 *
 * `payload` MUST be the raw request body exactly as received: the HMAC is computed over the bytes, so
 * a body that was parsed and re-serialised verifies as a forgery. Uses the Web Crypto provider, which
 * is what this runtime has; the SDK's default Node provider is not.
 */
export function verifyStripeEvent(
	payload: string,
	signature: string,
	webhookSecret: string,
): Promise<Stripe.Event> {
	return Stripe.webhooks.constructEventAsync(
		payload,
		signature,
		webhookSecret,
		300,
		Stripe.createSubtleCryptoProvider(),
	);
}
// #endregion

export type { Stripe };
