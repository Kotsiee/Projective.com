import { z } from "zod";

/**
 * newsletter.subscribe — the Zod SSOT for the public "stay updated" capture.
 *
 * One shape, used in three places so they can never drift: the client `NewsletterService` validates
 * a submission against it before hitting the network, the thin `/api/newsletter/subscribe` route
 * re-validates the body, and the fat `NewsletterBackendService` consumes the parsed result. When the
 * `newsletter.subscriptions` table lands (Phase 2), the same schema validates the DB insert (root
 * CLAUDE.md §1, the Zod SSOT rule). Only regex/max/enum primitives are used so it is stable across
 * Zod majors (matching `explore/items.ts`, `org/organisations.ts`).
 */

// #region Primitives
/** Shared email shape — the same permissive structure check the auth feature uses (`EMAIL_RE`). */
const email = z.string().trim().regex(
	/^[^\s@]+@[^\s@]+\.[^\s@]+$/,
	"Enter a valid email address.",
);

/** Where the capture originated, so the backend can attribute intent (footer, a campaign, …). */
export const NewsletterSource = z.enum(["footer", "landing", "explore"]);
export type NewsletterSource = z.infer<typeof NewsletterSource>;
// #endregion

// #region Request / response contracts
/** A newsletter opt-in submission. `source` defaults to the global footer capture. */
export const NewsletterSubscribeSchema = z.object({
	email,
	source: NewsletterSource.default("footer"),
});
export type NewsletterSubscribe = z.infer<typeof NewsletterSubscribeSchema>;

/** The success payload the `/api/newsletter/subscribe` route returns. */
export interface NewsletterSubscribeResult {
	/** Echoed (normalised) address, so the UI can confirm exactly what was captured. */
	email: string;
	/** True when this address was already on the list — the UI still shows a friendly success. */
	alreadySubscribed: boolean;
}
// #endregion
