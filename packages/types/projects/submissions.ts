import { z } from "zod";
import { ProjectFormat } from "./summary.ts";
import { MessageSenderSchema } from "./messages.ts";
import { FileItemSchema, FileKind, FileScope, FileSortDir, FileSortKey } from "./files.ts";

/**
 * projects.submissions — the Zod SSOT for the Submissions explorer read (channel scope
 * `/projects/[projectId]/[channelId]/submissions/…` and project scope
 * `/projects/[projectId]/submissions/…`). Where {@link FileListPageSchema} projects a flat channel
 * attachment corpus, this projects the DELIVERABLE hierarchy a client reviews: a navigation TREE
 * (stages → submitters → submission units → directories), the files at the currently-navigated tree
 * node, and — when the node resolves to a submission unit — the review projection the client's review
 * workspace modal renders (stage + ticket details, notes/annotations, guidelines).
 *
 * Like {@link ProjectDetailSchema} / {@link FileListPageSchema} this is a READ projection, not a table
 * row — the fat {@link ProjectBackendService} DERIVES it deterministically from the resolved
 * `ProjectDetail` while `PROJECTS_BACKEND_LIVE` is off (thin-frontend pattern, root CLAUDE.md §10); the
 * live path (RLS-scoped `submissions.*` / `files.*` reads) slots in behind the same gate with no shape
 * churn. Individual file rows reuse the {@link FileItemSchema} shape so the grid/list/preview surfaces
 * are shared verbatim with the File Explorer. Only enum/array/string/number/boolean primitives (plus a
 * single `z.lazy` self-reference for the recursive tree) are used so the schema stays stable across
 * Zod majors (matching the sibling projects schemas).
 */

// #region Enums
/**
 * A submission unit's review lifecycle state — drives the icon-only status glyph on its tree node and
 * the review modal's header. `draft` = not yet sent; `pending_review` = awaiting the client;
 * `revision_requested` = the client returned it for changes; `accepted` = approved (escrow release).
 */
export const SubmissionStatus = z.enum([
	"draft",
	"pending_review",
	"revision_requested",
	"accepted",
]);
export type SubmissionStatus = z.infer<typeof SubmissionStatus>;

/**
 * How a submission unit is named — a freelancer-chosen `custom` label, a `ticket` it fulfils, or a
 * `timestamp` fallback when neither was given (Part 3 tree-hierarchy rule).
 */
export const SubmissionUnitKind = z.enum(["custom", "ticket", "timestamp"]);
export type SubmissionUnitKind = z.infer<typeof SubmissionUnitKind>;

/**
 * Which level of the deliverable hierarchy a tree node represents.
 * - `stage` — a project stage (project-scope root nodes; a clickable Stage system node).
 * - `submitter` — a freelancer who submitted (carries their avatar, Part 3 profile-picture rule).
 * - `unit` — one submission unit (custom name / ticket / timestamp) — the reviewable node.
 * - `dir` — a nested directory path within a submission unit.
 */
export const SubmissionNodeKind = z.enum(["stage", "submitter", "unit", "dir"]);
export type SubmissionNodeKind = z.infer<typeof SubmissionNodeKind>;
// #endregion

// #region Tree node (recursive)
/**
 * One node of the submissions navigation tree. `segment` is the node's URL-safe id, unique among its
 * siblings — a node's full path is the chain of ancestor `segment`s (the catch-all route + breadcrumbs
 * address a node by that path). Container nodes carry `children`; the workspace shows the files under
 * whichever node is selected. Submitters carry `avatar`/`handle`; units carry `status`.
 */
export interface SubmissionTreeNode {
	segment: string;
	kind: SubmissionNodeKind;
	label: string;
	/** A muted secondary line (e.g. a unit's stage, a submitter's role). */
	sublabel?: string | null;
	/** Submitter avatar (Unsplash face crop, §C.4) — rendered on `submitter` nodes; null → initials. */
	avatar?: string | null;
	/** Submitter `@handle` → the canonical `/@handle` profile link; null → no link. */
	handle?: string | null;
	/** A submission unit's review status (icon-only glyph on the node); null on containers. */
	status?: SubmissionStatus | null;
	/** Total files under this node (a muted count, not an in-row status). */
	fileCount: number;
	children: SubmissionTreeNode[];
}

/** Recursive Zod schema for {@link SubmissionTreeNode} (single `z.lazy` self-reference). */
export const SubmissionTreeNodeSchema: z.ZodType<SubmissionTreeNode> = z.lazy(() =>
	z.object({
		segment: z.string().min(1).max(120),
		kind: SubmissionNodeKind,
		label: z.string().min(1).max(200),
		sublabel: z.string().max(200).nullable().optional(),
		avatar: z.string().max(600).nullable().optional(),
		handle: z.string().max(40).nullable().optional(),
		status: SubmissionStatus.nullable().optional(),
		fileCount: z.number().int().min(0),
		children: z.array(SubmissionTreeNodeSchema),
	})
);
// #endregion

// #region Breadcrumb crumb
/** One breadcrumb in the trail to the current tree node — its label + the full path that selects it. */
export const SubmissionCrumbSchema = z.object({
	label: z.string().min(1).max(200),
	kind: SubmissionNodeKind,
	/** The path (segment chain) this crumb navigates to; `[]` is the scope root ("All submissions"). */
	path: z.array(z.string().max(120)),
});
export type SubmissionCrumb = z.infer<typeof SubmissionCrumbSchema>;
// #endregion

// #region Submission unit + review
/** The submission unit resolved from the current path — enables the client's Review Submission flow. */
export const SubmissionUnitSchema = z.object({
	/** The unit node's path (segment chain from the scope root). */
	path: z.array(z.string().max(120)),
	name: z.string().min(1).max(200),
	kind: SubmissionUnitKind,
	status: SubmissionStatus,
	submitter: MessageSenderSchema,
	stageId: z.string().max(80).nullable(),
	stageName: z.string().max(120).nullable(),
	/** The ticket this unit fulfils (when `kind === "ticket"`); null otherwise. */
	ticketId: z.string().max(80).nullable(),
	ticketTitle: z.string().max(200).nullable(),
	/** Pre-formatted submitted-at labels (SSR == client, no locale drift). */
	createdAt: z.string(),
	dateLabel: z.string().max(28),
	fileCount: z.number().int().min(0),
	noteCount: z.number().int().min(0),
});
export type SubmissionUnit = z.infer<typeof SubmissionUnitSchema>;

/** One review note / annotation on a submission (the modal's Notes tab + per-file annotations). */
export const SubmissionNoteSchema = z.object({
	id: z.string().min(1).max(80),
	author: MessageSenderSchema,
	text: z.string().max(4000),
	/** The file this note annotates, or null for a unit-level note. */
	fileId: z.string().max(120).nullable(),
	createdAt: z.string(),
	dateLabel: z.string().max(28),
});
export type SubmissionNote = z.infer<typeof SubmissionNoteSchema>;

/**
 * The deep review projection for the active submission unit — the content the review workspace modal's
 * left context sidebar renders (stage details, ticket details, existing notes). Present only when the
 * current path resolves to a submission unit; null otherwise.
 */
export const SubmissionReviewSchema = z.object({
	unit: SubmissionUnitSchema,
	/** The stage this submission belongs to (Stage Details tab). */
	stageName: z.string().max(120).nullable(),
	stageStatus: z.string().max(40).nullable(),
	stageSummary: z.string().max(1200),
	/** The ticket this submission fulfils (Ticket Details tab), when applicable. */
	ticketTitle: z.string().max(200).nullable(),
	ticketSummary: z.string().max(1200).nullable(),
	/** Existing review notes (Notes tab + the badge counter). */
	notes: z.array(SubmissionNoteSchema),
});
export type SubmissionReview = z.infer<typeof SubmissionReviewSchema>;
// #endregion

// #region Request params
/** The submissions query. `path` selects a tree node (segment chain); `[]`/absent = the scope root. */
export const SubmissionListParamsSchema = z.object({
	projectId: z.string().min(1).max(120),
	/** Channel scope narrows to one channel; unset/null = project scope (Stages as tree roots). */
	channelId: z.string().min(1).max(120).nullable().optional(),
	/** The current tree node path (segment chain). */
	path: z.array(z.string().max(120)).max(12).optional(),
	sort: FileSortKey.optional(),
	dir: FileSortDir.optional(),
	/** Restrict to these attachment kinds (the Attachment-Types filter); empty/absent = all. */
	kinds: z.array(FileKind).max(8).optional(),
	/** Free-text filename match. */
	query: z.string().max(120).optional(),
	/**
	 * Viewer perspective override for the deliverable isolation rule (Freelancer View & Submission
	 * Isolation). A freelancer must ONLY ever see their own submissions — never another submitter's — so
	 * when this is `true` the tree + files are pruned to the acting freelancer's own subtree and
	 * `viewerIsClient` is forced off. `false` forces the full client/reviewer view (all submitters).
	 * When absent the backend derives it from the resolved viewer role (a freelancer auto-isolates). It
	 * is re-derived server-side and never grants access — RLS remains the real gate (root CLAUDE.md §6).
	 */
	asFreelancer: z.boolean().optional(),
	/** Opaque paging cursor (the id of the last item of the previous page). */
	cursor: z.string().max(120).nullable().optional(),
	limit: z.number().int().min(1).max(200).optional(),
});
export type SubmissionListParams = z.infer<typeof SubmissionListParamsSchema>;
// #endregion

// #region Page envelope
/** A page of the submissions explorer: the nav tree, the current path's files + trail, and review data. */
export const SubmissionListPageSchema = z.object({
	scope: FileScope,
	projectId: z.string().min(1).max(120),
	/** The engagement's title — the Create/Pre-submit submission modals surface it. */
	projectTitle: z.string().min(1).max(160),
	/**
	 * The engagement's delivery format — drives the Create Submission modal's ticket handling: a
	 * pipeline/session engagement fulfils tickets (a ticket dropdown), a one-off has no tickets.
	 */
	format: ProjectFormat,
	channelId: z.string().max(120).nullable(),
	/** The full navigation tree for the scope (root nodes; the client navigates it in-memory). */
	tree: z.array(SubmissionTreeNodeSchema),
	/** The resolved current path (may be `[]` for the scope root). */
	path: z.array(z.string().max(120)),
	/** The breadcrumb trail to the current path (root-to-leaf; the root crumb has `path: []`). */
	breadcrumbs: z.array(SubmissionCrumbSchema),
	/** The files under the current path (subtree), already sorted + filtered + cursor-paged. */
	items: z.array(FileItemSchema),
	/** The submission unit the current path resolves to (enables the Review flow); null otherwise. */
	activeUnit: SubmissionUnitSchema.nullable(),
	/** The active unit's review projection (the modal's context sidebar); null when no active unit. */
	review: SubmissionReviewSchema.nullable(),
	hasMore: z.boolean(),
	nextCursor: z.string().max(120).nullable(),
	/** Total files matched under the current path across all pages (drives the "N files" caption). */
	total: z.number().int().min(0),
	/** The acting viewer's sender id — gates the modal's inline rename (own files only). */
	viewerId: z.string().max(80),
	/** Whether the acting viewer is the client/reviewer — gates the Review Submission action. */
	viewerIsClient: z.boolean(),
	/** Whether the single-freelancer override collapsed the submitter level (Part 3). */
	singleFreelancer: z.boolean(),
});
export type SubmissionListPage = z.infer<typeof SubmissionListPageSchema>;
// #endregion
