/**
 * MessagingResult — the client-facing transport envelope for `/api/messaging/*` responses.
 *
 * Mirrors the projects feature's `ProjectsResult`: a thin `{ ok, data?, message?, errors? }` shape the
 * dumb {@link MessagingService} returns to islands. The `data` payloads are the Zod-SSOT shapes from
 * `@projective/types/messaging` (+ the shared `MessagePage` from `@projective/types/projects`); nothing
 * here couples to the backend.
 */
export interface MessagingResult<T> {
	/** Whether the request succeeded. */
	ok: boolean;
	/** General (non-field) message — e.g. a soft failure note. */
	message?: string;
	/** Field-keyed validation errors, when the route rejected the query. */
	errors?: Record<string, string>;
	/** The success payload; present when `ok`. */
	data?: T;
}
