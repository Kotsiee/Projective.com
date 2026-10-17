import type { NewsletterSubscribeResult } from "@projective/types/community";

/**
 * NewsletterResult — the client-facing transport envelope for `/api/newsletter/*` responses.
 *
 * Mirrors the auth feature's `AuthResult` and Explore's `ExploreResult`: a thin
 * `{ ok, data?, message?, errors?, details? }` shape the dumb client {@link NewsletterService}
 * returns to the footer island. The `data` payload is the Zod-SSOT
 * {@link NewsletterSubscribeResult} from `@projective/types/community`; nothing here couples to the
 * backend.
 */
export interface NewsletterResult {
	/** Whether the request succeeded. */
	ok: boolean;
	/** General (non-field) message — a success note or a soft failure. */
	message?: string;
	/** Field-keyed validation errors (e.g. `{ email: "…" }`), when the route rejected the body. */
	errors?: Record<string, string>;
	/**
	 * Machine-readable facts about a refusal: `retryAt` (ISO instant) on a 429 rate limit, `code` on a
	 * 503. The 429 also carries a `Retry-After` header.
	 */
	details?: Record<string, string | number | boolean | null>;
	/** The success payload; present when `ok`. */
	data?: NewsletterSubscribeResult;
}
