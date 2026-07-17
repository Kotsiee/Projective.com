/**
 * `projects` schema shapes — the compact feed projection, feed query/scope state + grouped payload,
 * and the Create-Project modal payload. The full `projects.projects` / `project_stages` / `tickets`
 * row schemas land alongside their own reads later; these back the `/projects` middle-nav feed today.
 */
export * from "./summary.ts";
export * from "./feed.ts";
export * from "./create.ts";
export * from "./detail.ts";
export * from "./messages.ts";
