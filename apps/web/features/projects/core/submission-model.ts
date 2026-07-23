import type {
	SubmissionNodeKind,
	SubmissionStatus,
	SubmissionTreeNode,
} from "../types/projects-types.ts";

/**
 * submission-model — pure, DOM-free helpers for the Submissions explorer (URL/path building, tree-node
 * vocabulary, review-status labels). No JSX, no signals — safe to import from SSR and islands alike
 * (glyphs live in `components/submission-glyphs.tsx`). The file/sort/filter vocabularies and the
 * message-group resolution the preview modal reuses come from `file-model.ts` unchanged.
 */

// #region Path <-> URL
/**
 * The base submissions route for a scope. Channel scope nests under the channel
 * (`/projects/{id}/{channel}/submissions`); project scope is the master ledger
 * (`/projects/{id}/submissions`).
 */
export function submissionsBase(
	scope: "channel" | "project",
	projectId: string,
	channelId?: string | null,
): string {
	return scope === "channel" && channelId
		? `/projects/${encodeURIComponent(projectId)}/${encodeURIComponent(channelId)}/submissions`
		: `/projects/${encodeURIComponent(projectId)}/submissions`;
}

/** The deep-link href for a tree path under a submissions base (`base/seg/seg/…`). */
export function submissionHref(base: string, path: string[]): string {
	if (path.length === 0) return base;
	return `${base}/${path.map((s) => encodeURIComponent(s)).join("/")}`;
}

/** A stable string key for a path (tree expand-state map keys + active comparison). */
export function pathKey(path: string[]): string {
	return path.join("/");
}

/** Every ancestor path key of `path`, root-first (used to auto-expand the current node's chain). */
export function ancestorKeys(path: string[]): string[] {
	const out: string[] = [];
	for (let i = 1; i <= path.length; i++) out.push(pathKey(path.slice(0, i)));
	return out;
}
// #endregion

// #region Vocabulary
/** Human label for a submission review status (tree glyph tooltip · modal header · a11y). */
export function statusLabel(status: SubmissionStatus): string {
	switch (status) {
		case "pending_review":
			return "Pending review";
		case "revision_requested":
			return "Revision requested";
		case "accepted":
			return "Accepted";
		default:
			return "Draft";
	}
}

/** The status's semantic tone token stem — drives the icon colour (`--warning`/`--danger`/`--success`). */
export function statusTone(status: SubmissionStatus): "warning" | "danger" | "success" | "muted" {
	switch (status) {
		case "pending_review":
			return "warning";
		case "revision_requested":
			return "danger";
		case "accepted":
			return "success";
		default:
			return "muted";
	}
}

/** Human label for a tree-node kind (a11y / tooltips). */
export function nodeKindLabel(kind: SubmissionNodeKind): string {
	switch (kind) {
		case "stage":
			return "Stage";
		case "submitter":
			return "Freelancer";
		case "unit":
			return "Submission";
		default:
			return "Folder";
	}
}
// #endregion

// #region Tree navigation (children-as-cards drill-down, Part 3)
/**
 * Resolve the tree node addressed by `path` (a chain of `segment`s from the scope root). Returns
 * `null` for the scope root (`[]`) and degrades to the deepest matched node if a segment is unknown —
 * mirroring the server's tolerant path resolution.
 */
export function nodeAt(tree: SubmissionTreeNode[], path: string[]): SubmissionTreeNode | null {
	let nodes = tree;
	let found: SubmissionTreeNode | null = null;
	for (const seg of path) {
		const next = nodes.find((n) => n.segment === seg);
		if (!next) return found;
		found = next;
		nodes = next.children;
	}
	return found;
}

/** The direct child nodes of the node at `path` (or the roots at the scope root). */
export function childNodesAt(tree: SubmissionTreeNode[], path: string[]): SubmissionTreeNode[] {
	const node = nodeAt(tree, path);
	return node ? node.children : tree;
}

/**
 * Whether the workspace should render the current node's children as navigable CARDS (Freelancer /
 * Submission cards) rather than the file grid. The scope root and stage/submitter containers drill
 * into child cards; a `unit` or `dir` is a leaf whose deliverable FILES are shown instead.
 */
export function nodeShowsChildCards(node: SubmissionTreeNode | null): boolean {
	if (!node) return true;
	return node.kind !== "unit" && node.kind !== "dir";
}
// #endregion

// #region Create-submission tickets (Create Submission Modal, §4)
/**
 * A ticket the freelancer can fulfil with a new submission — a normal `ticket`, or a `revision` ticket
 * (the client returned an earlier submission for changes). One-off engagements have no tickets.
 */
export interface SubmissionTicketOption {
	id: string;
	title: string;
	kind: "ticket" | "revision";
}

/** A tiny stable hash → non-negative int (no RNG; stable per seed). */
function hashKey(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

const TICKET_TITLES = [
	"Revise the landing hero",
	"Ship the icon set",
	"Polish the checkout flow",
	"Refine the motion pass",
	"Finalise the brand system",
];

/**
 * The freelancer's open tickets in the active stage — the Create Submission modal's ticket dropdown
 * (root task §4). Pipeline/session engagements fulfil tickets (1–3, sometimes a revision ticket among
 * them); a one-off has none (returns `[]`, so the modal shows no dropdown and defaults the name to the
 * stage/project). Derived deterministically from the seed so the list is stable per stage.
 */
export function submissionTickets(
	seedKey: string,
	opts: { hasTickets: boolean },
): SubmissionTicketOption[] {
	if (!opts.hasTickets) return [];
	const seed = hashKey(seedKey);
	const count = 1 + (seed % 3); // 1–3 tickets
	const out: SubmissionTicketOption[] = [];
	for (let i = 0; i < count; i++) {
		const kind: SubmissionTicketOption["kind"] = i === count - 1 && seed % 2 === 0
			? "revision"
			: "ticket";
		const num = 100 + ((seed + i * 37) % 800);
		out.push({
			id: `TCK-${num}`,
			title: `TCK-${num} · ${TICKET_TITLES[(seed + i) % TICKET_TITLES.length]}`,
			kind,
		});
	}
	return out;
}
// #endregion
