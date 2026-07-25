/**
 * `files` schema shapes — the Supabase Storage SSOT: the bucket registry (ids, access tiers, size /
 * MIME limits) and the path builders that emit the RLS anchor the storage policies key on. Kept in
 * lockstep with `00005040_seed_storage_buckets.sql`, `00002017_policies_storage.sql`, and
 * `documentation/database/files/Storage.md`.
 */
export * from "./storage.ts";
export * from "./categories.ts";
