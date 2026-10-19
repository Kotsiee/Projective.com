/**
 * WalletResult — the client-facing transport envelope for `/api/wallet/*` responses.
 *
 * Mirrors the catalogue/projects/messaging result shape: a thin `{ ok, data?, message?, errors? }` the
 * dumb {@link WalletService} returns to islands. The `data` payloads are the Zod-SSOT projections from
 * `@projective/types/finance`; nothing here couples to the backend.
 */
export interface WalletResult<T> {
	/** Whether the request succeeded. */
	ok: boolean;
	/** General (non-field) message — a success note or a soft failure note. */
	message?: string;
	/** Field-keyed validation errors, when the route rejected the payload. */
	errors?: Record<string, string>;
	/**
	 * Machine-readable facts about a refusal — a typed refusal's code in `reason` (e.g.
	 * `business_not_active`, which the dialogs word from the business refusal map).
	 */
	details?: Record<string, string | number | boolean | null>;
	/** The success payload; present when `ok`. */
	data?: T;
}
