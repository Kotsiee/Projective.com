/**
 * `projects` schema shapes — the compact feed projection, feed query/scope state + grouped payload,
 * the Create-Project modal payload, the deep single-engagement reads (detail · board · messages ·
 * files · submissions · members), and the two role-split `/projects/[projectId]` projections: the
 * owner's editable configuration + setup ladder ({@link ./setup.ts}) and the freelancer's dashboard
 * ({@link ./overview.ts}).
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
