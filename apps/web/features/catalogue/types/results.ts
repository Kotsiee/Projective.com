/**
 * CatalogueResult — the client-facing transport envelope for `/api/catalogue/*` responses.
 *
 * Mirrors the projects/messaging features' result shape: a thin `{ ok, data?, message?, errors? }` the
 * dumb {@link CatalogueService} returns to islands. The `data` payloads are the Zod-SSOT shapes from
 * `@projective/types/catalogue`; nothing here couples to the backend.
 */
export interface CatalogueResult<T> {
	/** Whether the request succeeded. */
	ok: boolean;
	/** General (non-field) message — a success note or a soft failure note. */
	message?: string;
	/** Field-keyed validation errors, when the route rejected the payload. */
	errors?: Record<string, string>;
	/** The success payload; present when `ok`. */
	data?: T;
}
