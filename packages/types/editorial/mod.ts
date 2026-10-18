/**
 * `editorial` schema shapes (Decision #274) — the content the platform authors and publishes: the
 * help centre, the changelog and Projective's own articles. One module per surface; the shared
 * primitives in `./common.ts` stay internal to the folder.
 */
export * from "./help-categories.ts";
export * from "./help.ts";
export * from "./changelog.ts";
export * from "./articles.ts";
