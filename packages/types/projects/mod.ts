/**
 * `projects` schema shapes — the compact feed projection, feed query/scope state + grouped payload,
 * the six-step Create-Project wizard payload and its tier taxonomy ({@link ./create.ts}), the deep
 * single-engagement reads (detail · board · messages · files · submissions · members), and the two
 * role-split `/projects/[projectId]` projections: the owner's editable configuration + setup ladder
 * ({@link ./setup.ts}) and the freelancer's dashboard ({@link ./overview.ts}).
 *
 * `create.ts` is the domain's LEAF: the engagement-term enums both it and `setup.ts` need are
 * declared there, so the pair stays a one-way edge rather than a cycle between two modules whose
 * corpora build at import time.
 */
export * from "./summary.ts";
export * from "./feed.ts";
export * from "./create.ts";
export * from "./detail.ts";
export * from "./members.ts";
export * from "./messages.ts";
export * from "./files.ts";
export * from "./submissions.ts";
export * from "./board.ts";
export * from "./setup.ts";
export * from "./overview.ts";
