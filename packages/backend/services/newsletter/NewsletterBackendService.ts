import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getServiceClient, isNewsletterBackendLive } from "../../core/supabase.ts";
import { serverEnv } from "../../core/env.ts";
import { type RateLimitRule, SlidingWindowLimiter } from "../../core/rate-limit.ts";
import { isUnstorableInputError } from "../../core/text.ts";
import { communityRpc } from "../community/community-source.ts";
import {
	type NewsletterSubscribeResult,
	NewsletterSubscribeRpcResultSchema,
	NewsletterSubscribeSchema,
} from "@projective/types/community";
import { planNewsletterSubscription } from "./subscription-plan.ts";

/**
 * NewsletterBackendService — the FAT server-side newsletter service.
 *
 * It owns the opt-in business logic: normalising the address, the per-address rate limit, and
 * persisting the subscription and its topic to `community.newsletter_subscriptions` through
 * `community.subscribe_newsletter` (Decision #274) — the one writer, which locks the row, adds the
 * topic idempotently and reports what it did. The thin `/api/newsletter/subscribe` route does only
 * HTTP parsing + Zod validation, then delegates here and maps the returned {@link ServiceResult} to a
 * `Response`. Islands never reach this — the `NewsletterForm` island `fetch`es the route via the thin
 * `NewsletterService`.
 *
 * **Topics.** A submission names one topic (`general` by default, `changelog` from the changelog's
 * capture). Re-subscribing with a topic the address already holds changes nothing and answers the
 * same success; a new topic joins the set; an address that had unsubscribed STAYS unsubscribed — the
 * request is recorded as pending (`resubscribe_topics`) with the opt-out kept on record, and only the
 * confirm link (not built yet) applies it, because a public form proves no one owns the address. The
 * rule is stated once, in SQL, with a tested TypeScript twin (`subscription-plan.ts`).
 *
 * **Stub mode (default).** With `NEWSLETTER_BACKEND_LIVE` off (see {@link isNewsletterBackendLive})
 * nothing is stored: in development the service validates and answers what the live writer answers
 * for a new address; in production it answers 503 instead, because telling a visitor "you're on the
 * list" when nothing was stored is a false confirmation (the contact intake's rule, Decision #276).
 * Live, the write uses the service role, because no client role holds any privilege on the
 * subscriber list (00002021). No email-provider sync or confirmation mail exists yet, so a stored
 * subscription is not sent anything until one lands.
 */

// #region Limits
/**
 * At most five subscribes per address in ten minutes, per process. Bounds a script replaying one
 * address (each live call is a locked row write) without ever refusing a person correcting a typo.
 */
export const NEWSLETTER_SUBSCRIBE_RULE: RateLimitRule = { max: 5, windowMs: 10 * 60_000 };

const subscribeLimiter = new SlidingWindowLimiter(NEWSLETTER_SUBSCRIBE_RULE);

/** The success line every accepted subscribe answers, whatever it changed. */
const SUBSCRIBED_MESSAGE = "You're on the list — thanks for subscribing.";

/** What production answers while the gate is off: nothing would be stored, so nothing is confirmed. */
export const NEWSLETTER_UNAVAILABLE_MESSAGE =
	"Subscriptions can't be saved right now. Please try again later.";
// #endregion

// #region Seams
/** The writer call the live path makes; injectable so tests run without a database. */
export type NewsletterSubscribeRpc = (args: {
	p_email: string;
	p_source: string;
	p_topic: string;
}) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;

/** Overrides for {@link NewsletterBackendService.subscribe} — tests pass them; the route passes none. */
export interface NewsletterSubscribeDeps {
	/** Force the live or the stub path instead of reading the gate. */
	live?: boolean;
	/** The writer call; defaults to `community.subscribe_newsletter` as the service role. */
	rpc?: NewsletterSubscribeRpc;
	/** The rate limiter; defaults to the process-wide one. */
	limiter?: SlidingWindowLimiter;
	/** Force production behaviour of the stub path instead of reading `DENO_ENV`. */
	production?: boolean;
}

/** Whether this is production — where the stub path refuses rather than confirm a write it skipped. */
function isProduction(deps: NewsletterSubscribeDeps): boolean {
	return deps.production ?? serverEnv().appEnv === "production";
}

/** The default writer: `community.subscribe_newsletter` with the service-role client. */
const serviceRoleRpc: NewsletterSubscribeRpc = (args) =>
	communityRpc(getServiceClient(), "subscribe_newsletter", args);
// #endregion

export class NewsletterBackendService {
	/**
	 * Capture a public newsletter opt-in for one topic. Re-validates the input against the Zod SSOT
	 * (defence in depth — the route validates too), rate-limits the address, then writes (live) or
	 * plans (stub). An already-subscribed address returns the same success, flagged via
	 * `alreadySubscribed`; the answer never reveals which other topics an address holds.
	 */
	static async subscribe(
		input: unknown,
		deps: NewsletterSubscribeDeps = {},
	): Promise<ServiceResult<NewsletterSubscribeResult>> {
		const parsed = NewsletterSubscribeSchema.safeParse(input);
		if (!parsed.success) {
			const first = parsed.error.issues[0];
			return fail(422, {
				errors: { [first?.path.join(".") || "email"]: first?.message ?? "Invalid submission." },
			});
		}

		const email = parsed.data.email.toLowerCase();
		const { source, topic } = parsed.data;

		const decision = (deps.limiter ?? subscribeLimiter).take(email);
		if (!decision.allowed) {
			return fail(429, {
				message: "Too many attempts for this address. Please try again in a few minutes.",
				details: { retryAt: new Date(Date.now() + decision.retryAfterMs).toISOString() },
			});
		}

		if (!(deps.live ?? isNewsletterBackendLive())) {
			if (isProduction(deps)) return fail(503, { message: NEWSLETTER_UNAVAILABLE_MESSAGE });
			const plan = planNewsletterSubscription(null, topic);
			return ok(
				{ email, topic, alreadySubscribed: plan.alreadySubscribed },
				{ message: SUBSCRIBED_MESSAGE },
			);
		}

		const { data, error } = await (deps.rpc ?? serviceRoleRpc)({
			p_email: email,
			p_source: source,
			p_topic: topic,
		});
		if (error) {
			// 22023 is the writer's own address guard (malformed, or over NEWSLETTER_EMAIL_MAX); 22P05
			// (a NUL Postgres cannot store) and PGRST102 (a body PostgREST cannot read, e.g. a lone
			// surrogate) are malformed input too. The schema above should make all three unreachable.
			if (error.code === "22023" || isUnstorableInputError(error.code)) {
				return fail(422, { errors: { email: "Enter a valid email address." } });
			}
			return fail(503, {
				message: "We couldn't save your subscription just now. Please try again shortly.",
				details: { code: error.code ?? null },
			});
		}

		const result = NewsletterSubscribeRpcResultSchema.safeParse(data);
		if (!result.success) {
			return fail(502, {
				message: "We couldn't confirm your subscription. Please try again shortly.",
			});
		}
		return ok(
			{
				email: result.data.email,
				topic: result.data.topic,
				alreadySubscribed: result.data.already_subscribed,
			},
			{ message: SUBSCRIBED_MESSAGE },
		);
	}
}
