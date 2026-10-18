import { z } from "zod";

/**
 * editorial — shared primitives for the `editorial` schema Zod SSOT (Decision #274).
 *
 * Internal to this folder: the surface modules (`help.ts`, `changelog.ts`, `articles.ts`) import
 * these, and `mod.ts` deliberately does not re-export them — the root barrel already carries other
 * domains' `uuid` / `timestamp`, and a second export of either name would be ambiguous there.
 *
 * Row schemas describe the JSON PostgREST returns AND the record a content source authors, because
 * the fixture path pushes authored records through the same parse (`@server/services/editorial/
 * editorial-source.ts`). So a timestamp is a string (`2026-10-17` authored, `2026-10-17T00:00:00+00:00`
 * read back), never `z.date()`; normalise in the row mapper, not in the schema.
 */

// #region Scalar primitives
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An opaque UUID id. */
export const uuid = z.string().regex(UUID_RE, "Expected a UUID.");
/** An ISO date or timestamp string, as authored or as returned by PostgREST. */
export const timestamp = z.string();
/** A URL-safe slug: lowercase words joined by single hyphens. Every editorial row is keyed by one. */
export const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Expected a lowercase slug.");
// #endregion
