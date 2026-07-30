/**
 * WorkspaceResult — the client-facing transport envelope for `/api/workspace/*` (and
 * `/api/context/switch`) responses.
 *
 * Mirrors the catalogue / projects / messaging features' result shape: a thin
 * `{ ok, data?, message?, errors? }` the dumb {@link WorkspaceService} hands back to islands. The
 * `data` payloads are the Zod-SSOT shapes from `@projective/types/workspace`; nothing here couples to
 * the backend, so an island can import this file without dragging a server module into the client
 * bundle.
 *
 * Failures are **soft**: a transport or validation problem resolves to `{ ok: false, message }` rather
 * than throwing, because an island that must render an honest error state cannot also be expected to
 * catch. `errors` carries field-keyed messages so a form can annotate the offending input instead of
 * showing a banner that makes the reader hunt.
 */
export interface WorkspaceResult<T> {
	/** Whether the request succeeded. */
	ok: boolean;
	/** General (non-field) message — a success note, or a soft failure note fit to render verbatim. */
	message?: string;
	/** Field-keyed validation errors, when the route rejected the payload. */
	errors?: Record<string, string>;
	/** The success payload; present when `ok`. */
	data?: T;
}
