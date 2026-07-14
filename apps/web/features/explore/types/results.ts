/**
 * ExploreResult — the client-facing transport envelope for `/api/explore/*` responses.
 *
 * Mirrors the auth feature's `AuthResult`: a thin `{ ok, data?, message?, errors? }` shape the dumb
 * client {@link ExploreService} returns to islands. The `data` payloads (`SearchPayload`, `HomeFeed`,
 * …) are the Zod-SSOT shapes from `@projective/types/explore`; nothing here couples to the backend.
 */
export interface ExploreResult<T> {
	/** Whether the request succeeded. */
	ok: boolean;
	/** General (non-field) message — e.g. a soft failure note. */
	message?: string;
	/** Field-keyed validation errors, when the route rejected the query. */
	errors?: Record<string, string>;
	/** The success payload; present when `ok`. */
	data?: T;
}
