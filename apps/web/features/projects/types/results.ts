/**
 * ProjectsResult — the client-facing transport envelope for `/api/projects/*` responses.
 *
 * Mirrors the explore feature's `ExploreResult`: a thin `{ ok, data?, message?, errors? }` shape the
 * dumb {@link ProjectSidebarService} returns to islands. The `data` payloads (`ProjectFeedPayload`,
 * …) are the Zod-SSOT shapes from `@projective/types/projects`; nothing here couples to the backend.
 */
export interface ProjectsResult<T> {
	/** Whether the request succeeded. */
	ok: boolean;
	/** General (non-field) message — e.g. a soft failure note. */
	message?: string;
	/** Field-keyed validation errors, when the route rejected the query. */
	errors?: Record<string, string>;
	/** The success payload; present when `ok`. */
	data?: T;
}
