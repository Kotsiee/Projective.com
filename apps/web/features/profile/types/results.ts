/**
 * ProfileResult — the client-facing transport envelope for `/api/profile/*` responses.
 *
 * Mirrors `ExploreResult` / `ProjectsResult`: a thin `{ ok, data?, message?, errors? }` shape the dumb
 * client {@link ProfileService} returns to islands. The `data` payloads are the Zod-SSOT shapes from
 * `@projective/types/profile`; nothing here couples to the backend.
 */
export interface ProfileResult<T> {
	/** Whether the request succeeded. */
	ok: boolean;
	/** General (non-field) message — e.g. a soft failure note. */
	message?: string;
	/** Field-keyed validation errors, when the route rejected the query. */
	errors?: Record<string, string>;
	/** The success payload; present when `ok`. */
	data?: T;
}
