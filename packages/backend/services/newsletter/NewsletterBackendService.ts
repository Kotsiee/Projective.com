import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getServiceClient, isNewsletterBackendLive } from "../../core/supabase.ts";
import { serverEnv } from "../../core/env.ts";
import { type RateLimitRule, SlidingWindowLimiter } from "../../core/rate-limit.ts";
import { isUnstorableInputError } from "../../core/text.ts";
import { resolveTurnstileKeys } from "../../core/turnstile.ts";
import { checkJoinCaptcha } from "../auth/captcha.ts";
import { communityRpc } from "../community/community-source.ts";
import {
	type NewsletterConfirmOutcome,
	NewsletterConfirmRpcResultSchema,
	NewsletterLinkRpcResultSchema,
	type NewsletterLinkView,
	type NewsletterSubscribeResult,
	NewsletterSubscribeRpcResultSchema,
	NewsletterSubscribeSchema,
	NewsletterTokenSchema,
	type NewsletterTopic,
	type NewsletterUnsubscribeOutcome,
	NewsletterUnsubscribeReason,
	NewsletterUnsubscribeRpcResultSchema,
} from "@projective/types/community";
import {
	type NewsletterConfirmationMail,
	sendNewsletterConfirmation,
} from "./newsletter-mailer.ts";

/**
 * NewsletterBackendService — the FAT server-side newsletter service: the public opt-in and its double
 * opt-in (PRD-E11).
 *
 * It owns the business logic: normalising the address, the per-address rate limit, the bot check,
 * and the four doors of `community.newsletter_subscriptions` (Decision #274, 00001320). The thin
 * `/api/newsletter/*` routes and the two `/newsletter` pages do only HTTP parsing, then delegate here
 * and map the returned {@link ServiceResult}. Islands never reach this — the `NewsletterForm` island
 * `fetch`es the route via the thin `NewsletterService`.
 *
 * **Subscribe.** A submission names one topic (`general` by default, `changelog` from the changelog's
 * capture). It passes the per-address limit and a Turnstile check (action `newsletter`), because a
 * confirmation mail follows it, and the public form could otherwise mail any address. The writer
 * records the request (a new address, a new topic, a re-subscribe kept pending behind its opt-out)
 * and says whether a confirmation mail is due. Once its transaction has committed, this service
 * hands that mail to the transport without waiting for it, so the answer's timing says nothing
 * either. Every accepted subscribe answers the same success, whatever the address held and whether
 * a mail went out: the form never learns who is on the list.
 *
 * **The link.** The mail's token is the only credential. Its pages read (`linkView`) and write
 * nothing, because mail scanners open every link (Decisions #445, #478); the person's press of
 * Confirm (`confirm`, throttled per client) or Unsubscribe (`unsubscribe`, also a mail client's
 * RFC 8058 one-click POST) does the one write.
 *
 * **Stub mode (default).** With `NEWSLETTER_BACKEND_LIVE` off (see {@link isNewsletterBackendLive})
 * nothing is stored and nothing is mailed: in development the service validates and answers the
 * same success; in production it answers 503 instead, because telling a visitor "check your inbox"
 * when nothing was stored is a false confirmation (the contact intake's rule, Decision #276). A link
 * has nothing to read in stub mode, so its pages answer 404. Live, every call uses the service role,
 * because no client role holds any privilege on the subscriber list (00002021, 00002510).
 */

// #region Limits
/**
 * At most five subscribes per address in ten minutes, per process. Bounds a script replaying one
 * address (each live call is a locked row write) without ever refusing a person correcting a typo.
 */
export const NEWSLETTER_SUBSCRIBE_RULE: RateLimitRule = { max: 5, windowMs: 10 * 60_000 };

/** At most ten presses of Confirm per client in ten minutes, per process (the #445 pattern). */
export const NEWSLETTER_CONFIRM_RULE: RateLimitRule = { max: 10, windowMs: 10 * 60_000 };

const subscribeLimiter = new SlidingWindowLimiter(NEWSLETTER_SUBSCRIBE_RULE);
const confirmLimiter = new SlidingWindowLimiter(NEWSLETTER_CONFIRM_RULE);

/** The success line every accepted subscribe answers, whatever it changed or mailed. */
export const NEWSLETTER_SUBSCRIBED_MESSAGE =
	"Thanks! If you're not already subscribed, check your inbox for a link to confirm.";

/** What production answers while the gate is off: nothing would be stored, so nothing is confirmed. */
export const NEWSLETTER_UNAVAILABLE_MESSAGE =
	"Subscriptions can't be saved right now. Please try again later.";

/** What an expired confirmation link answers. */
export const NEWSLETTER_LINK_EXPIRED_MESSAGE = "This link has expired — subscribe again.";

/** What a link no row holds answers. */
export const NEWSLETTER_LINK_UNKNOWN_MESSAGE = "We couldn't find this link.";
// #endregion

// #region Seams
/** A writer call the live path makes; injectable so tests run without a database. */
export type NewsletterRpc<Args> = (
	args: Args,
) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;

/** `community.subscribe_newsletter`'s call. */
export type NewsletterSubscribeRpc = NewsletterRpc<{
	p_email: string;
	p_source: string;
	p_topic: string;
}>;

/**
 * The bot check a subscribe passes before anything else happens. `null` admits it; otherwise the
 * refusal to answer with. The route builds it from the request (its keys, its client address).
 */
export type NewsletterCaptchaGate = (
	token: string | undefined,
) => Promise<ServiceResult<never> | null>;

/** Hands the confirmation mail to the transport. Never throws; its outcome is not awaited. */
export type NewsletterMailer = (mail: NewsletterConfirmationMail) => Promise<unknown>;

/** Overrides for {@link NewsletterBackendService.subscribe} — tests pass them; the route passes `captcha`. */
export interface NewsletterSubscribeDeps {
	/** Force the live or the stub path instead of reading the gate. */
	live?: boolean;
	/** The writer call; defaults to `community.subscribe_newsletter` as the service role. */
	rpc?: NewsletterSubscribeRpc;
	/** The rate limiter; defaults to the process-wide one. */
	limiter?: SlidingWindowLimiter;
	/** Force production behaviour of the stub path instead of reading `DENO_ENV`. */
	production?: boolean;
	/** The bot check; defaults to one built from the environment (fails closed in production). */
	captcha?: NewsletterCaptchaGate;
	/** The confirmation mailer; defaults to {@link sendNewsletterConfirmation} through the transport. */
	mailer?: NewsletterMailer;
	/** The origin the mailed links are built on; defaults to `APP_URL`. */
	appUrl?: string;
}

/** Overrides for the link's three calls. */
export interface NewsletterLinkDeps {
	live?: boolean;
	rpc?: NewsletterRpc<Record<string, unknown>>;
	limiter?: SlidingWindowLimiter;
}

/** Whether this is production — where the stub path refuses rather than confirm a write it skipped. */
function isProduction(deps: NewsletterSubscribeDeps): boolean {
	return deps.production ?? serverEnv().appEnv === "production";
}

/** The default writer: `community.subscribe_newsletter` with the service-role client. */
const serviceRoleRpc: NewsletterSubscribeRpc = (args) =>
	communityRpc(getServiceClient(), "subscribe_newsletter", args);

/** A service-role call to one of the link's doors. */
function linkRpc(fn: string): NewsletterRpc<Record<string, unknown>> {
	return (args) => communityRpc(getServiceClient(), fn, args);
}

/**
 * The bot check with nothing from a request: the environment's keys, the app origin's hostname. A
 * caller that has a request (the route) passes a gate that also honours the development override and
 * sends the client address.
 */
const environmentCaptcha: NewsletterCaptchaGate = (token) => {
	const env = serverEnv();
	const development = env.appEnv === "development";
	let hostnames: string[] = [];
	try {
		hostnames = [new URL(env.appUrl).hostname];
	} catch {
		hostnames = [];
	}
	return checkJoinCaptcha({
		token,
		keys: resolveTurnstileKeys({
			siteKey: env.turnstileSiteKey,
			secretKey: env.turnstileSecretKey,
			development,
			override: null,
		}),
		action: "newsletter",
		remoteIp: null,
		allowedHostnames: hostnames,
		development,
	});
};
// #endregion

// #region Results
/** What a press of Confirm came to, for the route. */
export interface NewsletterConfirmResult {
	outcome: NewsletterConfirmOutcome;
	/** The topics the address holds now. */
	topics: NewsletterTopic[];
}

/** What an unsubscribe came to, for the route. */
export interface NewsletterUnsubscribeResult {
	outcome: NewsletterUnsubscribeOutcome;
}

/** The token as the doors take it, or null when it cannot be one (a 404 with no database call). */
function parseToken(token: unknown): string | null {
	const parsed = NewsletterTokenSchema.safeParse(typeof token === "string" ? token.trim() : token);
	return parsed.success ? parsed.data.toLowerCase() : null;
}

/** The 503 a database error answers on the link's doors. */
function linkUnavailable<T>(code: string | undefined): ServiceResult<T> {
	return fail(503, {
		message: "We couldn't reach the subscription list just now. Please try again shortly.",
		details: { code: code ?? null },
	});
}
// #endregion

export class NewsletterBackendService {
	/**
	 * Capture a public newsletter opt-in for one topic. Re-validates the input against the Zod SSOT
	 * (defence in depth — the route validates too), rate-limits the address, runs the bot check, then
	 * writes (live) or plans (stub). When the writer says a confirmation mail is due, the mail is handed
	 * to the transport after the write has committed. Every accepted subscribe answers the same
	 * success.
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
		const { source, topic, captchaToken } = parsed.data;

		const decision = (deps.limiter ?? subscribeLimiter).take(email);
		if (!decision.allowed) {
			return fail(429, {
				message: "Too many attempts for this address. Please try again in a few minutes.",
				details: { retryAt: new Date(Date.now() + decision.retryAfterMs).toISOString() },
			});
		}

		const refused = await (deps.captcha ?? environmentCaptcha)(captchaToken);
		if (refused) return refused;

		if (!(deps.live ?? isNewsletterBackendLive())) {
			if (isProduction(deps)) return fail(503, { message: NEWSLETTER_UNAVAILABLE_MESSAGE });
			return ok({ email, topic }, { message: NEWSLETTER_SUBSCRIBED_MESSAGE });
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

		const { confirmation_due: due, token, confirm_topics: topics } = result.data;
		if (due && token && topics) {
			const mailer = deps.mailer ?? ((mail) => sendNewsletterConfirmation(mail));
			void mailer({
				to: result.data.email,
				token,
				topics,
				appUrl: deps.appUrl ?? serverEnv().appUrl,
			}).catch(() => {});
		}

		return ok(
			{ email: result.data.email, topic: result.data.topic },
			{ message: NEWSLETTER_SUBSCRIBED_MESSAGE },
		);
	}

	/**
	 * What the mailed link's pages show for `token`. Reads only: a mail scanner's GET must leave the
	 * link as it found it. 404 for a malformed or unknown token (and in stub mode, where nothing was
	 * stored), 503 when the list cannot be reached, 502 when the read drifted.
	 */
	static async linkView(
		token: unknown,
		deps: NewsletterLinkDeps = {},
	): Promise<ServiceResult<NewsletterLinkView>> {
		const parsed = parseToken(token);
		if (!parsed || !(deps.live ?? isNewsletterBackendLive())) {
			return fail(404, { message: NEWSLETTER_LINK_UNKNOWN_MESSAGE });
		}
		const { data, error } = await (deps.rpc ?? linkRpc("read_newsletter_link"))({
			p_token: parsed,
		});
		if (error) return linkUnavailable(error.code);
		const read = NewsletterLinkRpcResultSchema.safeParse(data);
		if (!read.success) return fail(502, { message: NEWSLETTER_LINK_UNKNOWN_MESSAGE });
		if (!read.data) return fail(404, { message: NEWSLETTER_LINK_UNKNOWN_MESSAGE });
		return ok({
			subscribed: read.data.subscribed,
			unsubscribed: read.data.unsubscribed,
			topics: read.data.topics,
			pendingTopics: read.data.pending_topics,
			expired: read.data.expired,
		});
	}

	/**
	 * The press of Confirm: apply what awaits confirmation on `token`'s row. Throttled per client
	 * (`client` is the route's `clientKey`). `confirmed` and `already_confirmed` are the same 200
	 * success; `expired` is a 410 and writes nothing; `unsubscribed` (nothing awaits on an address that
	 * left) is a 409; an unknown token is a 404.
	 */
	static async confirm(
		token: unknown,
		client: string,
		deps: NewsletterLinkDeps = {},
	): Promise<ServiceResult<NewsletterConfirmResult>> {
		const decision = (deps.limiter ?? confirmLimiter).take(client);
		if (!decision.allowed) {
			return fail(429, {
				message: "Too many attempts just now. Wait a few minutes, then press Confirm again.",
				details: { retryAt: new Date(Date.now() + decision.retryAfterMs).toISOString() },
			});
		}
		const parsed = parseToken(token);
		if (!parsed || !(deps.live ?? isNewsletterBackendLive())) {
			return fail(404, { message: NEWSLETTER_LINK_UNKNOWN_MESSAGE });
		}
		const { data, error } = await (deps.rpc ?? linkRpc("confirm_newsletter"))({ p_token: parsed });
		if (error) return linkUnavailable(error.code);
		const result = NewsletterConfirmRpcResultSchema.safeParse(data);
		if (!result.success) return fail(502, { message: "We couldn't confirm just now." });

		const { outcome, topics } = result.data;
		switch (outcome) {
			case "confirmed":
			case "already_confirmed":
				return ok({ outcome, topics }, { message: "You're subscribed." });
			case "expired":
				return fail(410, { message: NEWSLETTER_LINK_EXPIRED_MESSAGE, details: { outcome } });
			case "unsubscribed":
				return fail(409, {
					message: "This address has unsubscribed. Subscribe again to rejoin.",
					details: { outcome },
				});
			case "not_found":
				return fail(404, { message: NEWSLETTER_LINK_UNKNOWN_MESSAGE });
		}
	}

	/**
	 * Take `token`'s address off the list (`reason` is the door's: `link` for the page's button,
	 * `one_click` for an RFC 8058 POST). Idempotent; nothing is deleted. Not throttled: the token is a
	 * random UUID, and a mail provider's one-click POSTs for many recipients come from a few
	 * addresses. 404 for an unknown token.
	 */
	static async unsubscribe(
		token: unknown,
		reason: unknown,
		deps: NewsletterLinkDeps = {},
	): Promise<ServiceResult<NewsletterUnsubscribeResult>> {
		const parsedReason = NewsletterUnsubscribeReason.safeParse(reason);
		const parsed = parseToken(token);
		if (!parsedReason.success || !parsed || !(deps.live ?? isNewsletterBackendLive())) {
			return fail(404, { message: NEWSLETTER_LINK_UNKNOWN_MESSAGE });
		}
		const { data, error } = await (deps.rpc ?? linkRpc("unsubscribe_newsletter"))({
			p_token: parsed,
			p_reason: parsedReason.data,
		});
		if (error) return linkUnavailable(error.code);
		const result = NewsletterUnsubscribeRpcResultSchema.safeParse(data);
		if (!result.success) return fail(502, { message: "We couldn't unsubscribe you just now." });
		if (result.data.outcome === "not_found") {
			return fail(404, { message: NEWSLETTER_LINK_UNKNOWN_MESSAGE });
		}
		return ok({ outcome: result.data.outcome }, { message: "You're unsubscribed." });
	}
}
