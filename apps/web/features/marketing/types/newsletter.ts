import type { NewsletterSubscribeResult } from "@projective/types/newsletter";

/**
 * NewsletterResult — the client-facing transport envelope for `/api/newsletter/*` responses.
 *
 * Mirrors the auth feature's `AuthResult` and Explore's `ExploreResult`: a thin
 * `{ ok, data?, message?, errors? }` shape the dumb client {@link NewsletterService} returns to the
 * footer island. The `data` payload is the Zod-SSOT {@link NewsletterSubscribeResult} from
 * `@projective/types/newsletter`; nothing here couples to the backend.
 */
export interface NewsletterResult {
	/** Whether the request succeeded. */
	ok: boolean;
	/** General (non-field) message — a success note or a soft failure. */
	message?: string;
	/** Field-keyed validation errors (e.g. `{ email: "…" }`), when the route rejected the body. */
	errors?: Record<string, string>;
	/** The success payload; present when `ok`. */
	data?: NewsletterSubscribeResult;
}
