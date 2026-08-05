/**
 * FilesResult — the client-facing transport envelope for `/api/files/*` responses.
 *
 * Mirrors the catalogue / projects / messaging features' result shape: a thin
 * `{ ok, data?, message?, errors? }` the dumb {@link FilesService} returns to islands. The `data`
 * payloads are the Zod-SSOT shapes from `@projective/types/files`; nothing here couples to the
 * backend, so an island never learns whether it was answered by a fixture or by Postgres.
 */
export interface FilesResult<T> {
	/** Whether the request succeeded. */
	ok: boolean;
	/** General (non-field) message — a success note or a soft failure note. */
	message?: string;
	/** Field-keyed validation errors, when the route (or the client pre-flight) rejected the payload. */
	errors?: Record<string, string>;
	/** The success payload; present when `ok`. */
	data?: T;
}
