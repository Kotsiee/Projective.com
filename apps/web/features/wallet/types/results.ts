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
	/** The success payload; present when `ok`. */
	data?: T;
}
