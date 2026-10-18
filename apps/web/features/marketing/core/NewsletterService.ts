import {
	type NewsletterSource,
	NewsletterSubscribeSchema,
	type NewsletterTopic,
} from "@projective/types/community";
import type { NewsletterResult } from "../types/newsletter.ts";

/**
 * NewsletterService — the THIN client newsletter service.
 *
 * A dumb object of named methods the `NewsletterForm` island calls; each validates against the Zod
 * SSOT ({@link NewsletterSubscribeSchema}) BEFORE the network round-trip, then POSTs JSON to the thin
 * `/api/newsletter/*` route and returns a soft {@link NewsletterResult}. No provider logic, no list
 * writes — the fat {@link NewsletterBackendService} owns all of that (mirrors AuthService /
 * ExploreService). Network / parse failures degrade to a friendly, retryable error, never a throw.
 */
export const NewsletterService = {
	/**
	 * Subscribe an email to one newsletter topic (`general` unless the capture says otherwise, e.g.
	 * `changelog` on the changelog). Client-side Zod validation short-circuits an obviously malformed
	 * address into a field error (no wasted request); a clean submission is forwarded to the route,
	 * which re-validates and delegates to the fat service.
	 */
	async subscribe(
		email: string,
		source: NewsletterSource = "footer",
		topic: NewsletterTopic = "general",
	): Promise<NewsletterResult> {
		const parsed = NewsletterSubscribeSchema.safeParse({ email, source, topic });
		if (!parsed.success) {
			const first = parsed.error.issues[0];
			return {
				ok: false,
				errors: { [first?.path.join(".") || "email"]: first?.message ?? "Enter a valid email." },
			};
		}

		try {
			const res = await fetch("/api/newsletter/subscribe", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(parsed.data),
			});
			const data = await res.json().catch(() => null);
			if (data && typeof data === "object") return data as NewsletterResult;
			return { ok: false, message: "Unexpected response from the server. Please try again." };
		} catch {
			return { ok: false, message: "Network error — check your connection and try again." };
		}
	},
};
