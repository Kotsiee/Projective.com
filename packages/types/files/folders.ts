import { z } from "zod";
import { AssetOwnerType, AssetSource, AssetVisibility } from "./assets.ts";

/**
 * files.folders — the Zod SSOT for a folder in the asset hierarchy and for the navigation TREE the
 * `/files` hub renders it through.
 *
 * A folder is the container half of the asset model: {@link AssetItemSchema} describes a thing with
 * bytes (or a link), this describes the place it sits. It carries the same ownership, source and
 * visibility axes as an asset, because every one of those questions has an answer at the folder level
 * too — a folder can be entity-owned, can be mounted from a connector, and can be shared.
 *
 * **Why the tree node mirrors `SubmissionTreeNode`'s field names.** The Submissions explorer already
 * ships a folder card, a tree navigator and a breadcrumb trail that read `kind` / `label` / `sublabel`
 * / `fileCount` / `children` (see `../projects/submissions.ts` and `SubmissionCard.tsx`). The `/files`
 * hub needs exactly those affordances, so rather than fork a second card family it SHAPES a folder
 * into that structure and reuses the components verbatim. {@link AssetTreeNode} is therefore
 * deliberately assignable to `SubmissionTreeNode`: the five fields that node REQUIRES are present with
 * compatible types, and everything the submissions domain treats as optional (`sublabel`, `avatar`,
 * `handle`, `status`) is either mirrored or safely absent. The hub-specific truth a submissions card
 * has no vocabulary for lives on the additional {@link AssetNodeKind} discriminant, which the shared
 * components simply never read.
 *
 * The card-kind and node vocabularies are declared HERE rather than imported from
 * `../projects/submissions.ts` for the same reason `AssetChannelKind` is declared in `./assets.ts`:
 * the projects domain imports the files domain (`projects/files.ts` narrows `AssetItemSchema`), so
 * reaching back up would close an import cycle — and a cycle in a module whose corpus is built at
 * import time is the TDZ crash class recorded in Decision #49, not a style problem.
 *
 * Only enum/array/string/number/boolean primitives (plus a single `z.lazy` self-reference for the
 * recursive tree) are used so the module stays stable across Zod majors.
 */

// #region Vocabulary

/**
 * The CARD treatment a tree node renders with — structurally identical to the submissions domain's
 * `SubmissionNodeKind`, member for member, so a node shaped here drops into the shared
 * `SubmissionCard` / tree components with no adapter.
 *
 * A hub folder shapes to `dir`; a mounted connector root and a project root shape to `stage` (the
 * container treatment); a person-scoped grouping shapes to `submitter` (it carries an avatar).
 * {@link AssetNodeKind} carries what the node ACTUALLY is.
 */
export const AssetCardKind = z.enum(["stage", "submitter", "unit", "dir"]);
export type AssetCardKind = z.infer<typeof AssetCardKind>;

/**
 * What a hub tree node actually represents — the discriminant the `/files` navigator branches on.
 *
 * - `root`    — the library root ("My files", or an entity's vault).
 * - `folder`  — a hub-native folder the owner created.
 * - `channel` — a MOUNTED project channel's attachments, read-only in the hub.
 * - `project` — a mounted project, grouping its channels.
 * - `drive`   — a connected third-party account's root (a Google Drive, a Dropbox, an S3 bucket).
 * - `mount`   — a folder INSIDE a connected drive.
 *
 * The three mounted kinds are read-only by construction: the hub shows them so a person can find and
 * attach what they already have, not so it can become a second write path into someone else's system
 * of record.
 */
export const AssetNodeKind = z.enum([
	"root",
	"folder",
	"channel",
	"project",
	"drive",
	"mount",
]);
export type AssetNodeKind = z.infer<typeof AssetNodeKind>;

// #endregion

// #region Folder row

/**
 * One folder row — the container projection the hub's grid, tree and breadcrumbs render from.
 *
 * `path` is the MATERIALISED ancestor segment chain, root-first, mirroring `files.folders.path`. It is
 * stored rather than walked so a breadcrumb trail, a deep-link URL and a "move into" target can all be
 * resolved without a recursive query per folder.
 */
export const AssetFolderSchema = z.object({
	/** Stable folder id (the tree key and the `folderId` every asset query filters on). */
	id: z.string().min(1).max(120),
	name: z.string().min(1).max(200),
	/** The containing folder; `null` at the library root. */
	parentId: z.string().max(120).nullable(),
	/** Materialised ancestor segments, root-first — the breadcrumb trail with no second round trip. */
	path: z.array(z.string().max(120)).max(24),
	ownerType: AssetOwnerType,
	/** The owning principal's id — a user id, or a team/business/organisation id. */
	ownerId: z.string().min(1).max(80),
	source: AssetSource,
	/** The connector's own folder id when `source !== "supabase"`; `null` for a hub-native folder. */
	externalFolderId: z.string().max(200).nullable(),
	visibility: AssetVisibility,
	/** Assets directly inside this folder (not the whole subtree) — the muted card count. */
	itemCount: z.number().int().min(0),
	/** Total bytes of the whole subtree — the sortable "size" key. Always 0 for a mounted folder. */
	sizeBytes: z.number().int().min(0),
	/** Pre-formatted human size ("2.4 MB") so SSR and the client refetch render identically. */
	sizeLabel: z.string().max(16),
	/** The opaque share token when `visibility !== "private"`; `null` otherwise. */
	shareSlug: z.string().max(64).nullable(),
	/** Whether the viewer may rename/move/delete/reshare it. Server-derived; never inferred client-side. */
	canManage: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type AssetFolder = z.infer<typeof AssetFolderSchema>;

// #endregion

// #region Tree node (recursive)

/**
 * One node of the `/files` navigation tree.
 *
 * `segment` is the node's URL-safe id, unique among its siblings — a node's full path is the chain of
 * ancestor `segment`s, which is what {@link folderHref} deep-links and what {@link pathKey} keys
 * expansion state on.
 *
 * The shape is deliberately assignable to the submissions domain's `SubmissionTreeNode` (see the
 * module note): `segment`, `kind`, `label`, `fileCount` and `children` are the fields that node
 * requires, and `sublabel` / `avatar` / `handle` mirror its optional ones so the shared card and tree
 * components read the same properties on both.
 */
export interface AssetTreeNode {
	segment: string;
	/** The card treatment — see {@link AssetCardKind}. */
	kind: AssetCardKind;
	/** What the node actually is; the shared submissions components never read this. */
	nodeKind: AssetNodeKind;
	label: string;
	/** A muted secondary line (a source name, an owner, a channel's project). */
	sublabel?: string | null;
	/** An avatar for a person- or entity-scoped node (§C.4); null → the initials fallback. */
	avatar?: string | null;
	/** An `@handle` → the canonical `/@handle` profile link; null → no link. */
	handle?: string | null;
	/** The folder this node resolves to, or `null` for a synthetic grouping node. */
	folderId?: string | null;
	/** Whether this node is a read-only mount (a channel, a project, a connected drive). */
	readOnly?: boolean;
	/** Total assets under this node (a muted count, not an in-row status — §B.6). */
	fileCount: number;
	children: AssetTreeNode[];
}

/** Recursive Zod schema for {@link AssetTreeNode} (single `z.lazy` self-reference). */
export const AssetTreeNodeSchema: z.ZodType<AssetTreeNode> = z.lazy(() =>
	z.object({
		segment: z.string().min(1).max(120),
		kind: AssetCardKind,
		nodeKind: AssetNodeKind,
		label: z.string().min(1).max(200),
		sublabel: z.string().max(200).nullable().optional(),
		avatar: z.string().max(600).nullable().optional(),
		handle: z.string().max(40).nullable().optional(),
		folderId: z.string().max(120).nullable().optional(),
		readOnly: z.boolean().optional(),
		fileCount: z.number().int().min(0),
		children: z.array(AssetTreeNodeSchema),
	})
);

// #endregion

// #region Pure path helpers

/**
 * A stable, collision-free key for a tree path — what expansion state, selection state and a
 * "scroll this node into view" lookup are all keyed on.
 *
 * Each segment is percent-encoded BEFORE joining, so a folder literally named `a/b` cannot produce the
 * same key as the nested pair `["a", "b"]`. Joining raw segments would make those two indistinguishable
 * and silently expand the wrong branch.
 *
 * The root path (`[]`) keys as the empty string, so the root is addressable like any other node.
 */
export function pathKey(segments: readonly string[]): string {
	return segments.map((s) => encodeURIComponent(s)).join("/");
}

/**
 * Every PROPER ancestor key of a path, root-first — what a deep link force-opens on arrival so the
 * navigated node is visible without the viewer expanding six levels by hand.
 *
 * The root key (`""`) leads the list whenever the path is non-empty; the path's own key is excluded
 * (a node does not need to be open to be selected). An empty path has no ancestors.
 */
export function ancestorKeys(segments: readonly string[]): string[] {
	if (segments.length === 0) return [];
	const keys: string[] = [""];
	for (let i = 1; i < segments.length; i++) {
		keys.push(pathKey(segments.slice(0, i)));
	}
	return keys;
}

/**
 * The deep-link URL for a tree path under a scope base (`/files`, `/teams/{id}/files`).
 *
 * Segments are percent-encoded for the same reason {@link pathKey} encodes them, and the base is
 * returned untouched for the root path so the hub root never renders a trailing slash.
 */
export function folderHref(base: string, segments: readonly string[]): string {
	const trimmed = base.replace(/\/+$/, "");
	if (segments.length === 0) return trimmed;
	return `${trimmed}/${segments.map((s) => encodeURIComponent(s)).join("/")}`;
}

// #endregion
