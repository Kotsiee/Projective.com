import { ok, type ServiceResult } from "../ServiceResult.ts";
import { isNewsletterBackendLive } from "../../core/supabase.ts";
import {
	NewsletterSubscribeSchema,
	type NewsletterSubscribeResult,
} from "@projective/types/newsletter";

/**
 * NewsletterBackendService — the FAT server-side newsletter service.
 *
 * It owns the opt-in business logic: normalising the address, de-duplicating against the list, and
 * (once live) persisting to `newsletter.subscriptions` + syncing the email provider. The thin
 * `/api/newsletter/subscribe` route does only HTTP parsing + Zod validation, then delegates here and
 * maps the returned {@link ServiceResult} to a `Response`. Islands never reach this — the footer's
 * `NewsletterForm` island `fetch`es the route via the thin `NewsletterService`.
 *
 * **Stub mode (default).** With `NEWSLETTER_BACKEND_LIVE` off (see {@link isNewsletterBackendLive})
 * the service validates and accepts the address without side effects, so the running app is unchanged
 * and every well-formed submission gets a friendly confirmation. The live path — persist + provider
 * sync — slots in behind the same gate as a fill-in, not a re-architecture (mirrors
 * {@link ExploreBackendService} / {@link AuthBackendService}).
 */
export class NewsletterBackendService {
	/**
	 * Capture a public newsletter opt-in. Re-validates the input against the Zod SSOT (defence in
	 * depth — the route validates too), then accepts it. Anti-enumeration: an already-subscribed
	 * address returns the same success outcome, flagged via `alreadySubscribed`.
	 */
	static subscribe(
		input: unknown,
	): ServiceResult<NewsletterSubscribeResult> {
		const parsed = NewsletterSubscribeSchema.safeParse(input);
		if (!parsed.success) {
			const first = parsed.error.issues[0];
			return {
				ok: false,
				status: 422,
				errors: { [first?.path.join(".") || "email"]: first?.message ?? "Invalid submission." },
			};
		}

		const email = parsed.data.email.toLowerCase();

		if (!isNewsletterBackendLive()) {
			return ok(
				{ email, alreadySubscribed: false },
				{ message: "You're on the list — thanks for subscribing." },
			);
		}

		// LIVE: upsert into `newsletter.subscriptions` (source-attributed) and enqueue the provider
		// sync (not yet implemented) — fall back to the stub acceptance so behaviour is preserved
		// until that path lands.
		return ok(
			{ email, alreadySubscribed: false },
			{ message: "You're on the list — thanks for subscribing." },
		);
	}
}
