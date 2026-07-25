import { z } from "zod";

/**
 * Shared scalars for the `integrations` domain shapes.
 *
 * @module
 */

// #region Scalars
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An opaque UUID id. */
export const uuid = z.string().regex(UUID_RE, "Expected a UUID.");
/** An ISO timestamp string as returned by PostgREST. */
export const timestamp = z.string();
// #endregion
