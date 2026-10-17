import { z } from "zod";

/**
 * community — shared primitives for the `community` schema Zod SSOT (Decision #274).
 *
 * Internal to this folder: the surface modules (`newsletter.ts`, `help-feedback.ts`, `feedback.ts`)
 * import these, and `mod.ts` deliberately does not re-export them — the root barrel already carries
 * other domains' `uuid` / `timestamp`, and a second export of either name would be ambiguous there.
 * Only regex/enum primitives are used, matching `packages/types/comms/common.ts`.
 */

// #region Scalar primitives
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An opaque UUID id. */
export const uuid = z.string().regex(UUID_RE, "Expected a UUID.");
/** An ISO timestamp string as returned by PostgREST. */
export const timestamp = z.string();
// #endregion
