/**
 * CheckoutResponse — the client-facing transport envelope for the `/api/basket/*`, `/api/checkout/*`
 * and `/api/cards/*` responses.
 *
 * Mirrors the wallet / catalogue / projects result shape: a thin `{ ok, data?, message?, errors? }` a
 * dumb client service hands to islands. The `data` payloads are the Zod-SSOT projections from
 * `@projective/types/finance` (`Basket`, `CheckoutSessionContext`, `SavedCard`, …); nothing here
 * couples to the backend.
 */
export interface CheckoutResponse<T> {
	/** Whether the request succeeded. */
	ok: boolean;
	/** General (non-field) message — a success note, or the reason a purchase was refused. */
	message?: string;
	/** Field-keyed validation errors, when the route rejected the payload. */
	errors?: Record<string, string>;
	/** The success payload; present when `ok`. */
	data?: T;
}
