/**
 * `@projective/types/files` — the asset domain barrel.
 *
 * Two layers, deliberately separated:
 *
 *   * **Storage plumbing** — the bucket registry, access tiers, size/MIME limits and the path builders
 *     that emit the RLS anchor the storage policies key on ({@link ./storage.ts}). Kept in lockstep
 *     with `00005040_seed_storage_buckets.sql`, `00002017_policies_storage.sql` and
 *     `documentation/database/files/Storage.md`.
 *   * **The asset model** — what a thing IS ({@link ./kinds.ts}, {@link ./categories.ts}), the
 *     universal row every card, table, preview and picker renders ({@link ./assets.ts}), the folders
 *     and navigation tree it sits in ({@link ./folders.ts}), and the four concerns that surround it:
 *     the allowance it consumes ({@link ./quota.ts}), the read-only capability URLs it can be shared
 *     through ({@link ./sharing.ts}), the content-addressed duplicate check that precedes an upload
 *     ({@link ./dedup.ts}), the ledger of who took a copy ({@link ./downloads.ts}), and the
 *     init/ticket/complete handshake plus every mutation that writes it ({@link ./upload.ts}).
 *
 * {@link ./sim.ts} carries the Dev Context Switcher overlay these reads are simulated with — a
 * developer-only query-param seam that grants no access.
 *
 * The projects domain NARROWS this model rather than forking it (`projects/files.ts` re-expresses
 * `FileItemSchema` as `AssetItemSchema` with message provenance re-mandated), so the dependency edge
 * runs projects → files and never back.
 *
 * @module
 */
export * from "./kinds.ts";
export * from "./storage.ts";
export * from "./categories.ts";
export * from "./assets.ts";
export * from "./folders.ts";
export * from "./listing.ts";
export * from "./quota.ts";
export * from "./sharing.ts";
export * from "./dedup.ts";
export * from "./downloads.ts";
export * from "./upload.ts";
export * from "./sim.ts";
