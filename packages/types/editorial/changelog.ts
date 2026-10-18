/**
 * editorial.changelog — the Zod SSOT for the changelog's releases (P5, Decision #274). Placeholder
 * until P5 lands the table.
 *
 * What belongs here: the row schema of the release table (`00000024`, region `[changelog]`) — a
 * semver `version` as its key, the release date, title, categories, summary, a `body` of ContentNode
 * JSON (`@projective/types/content`, P0) and its images with dimensions — plus the domain record the
 * content source authors. Releases are reconstructed from real history; none is invented. Import
 * shared primitives from `./common.ts`, and prefix every export `Changelog…` — this module is
 * re-exported by the root barrel, where a bare name can collide.
 */
export {};
