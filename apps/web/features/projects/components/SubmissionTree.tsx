import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { TreeNav, type TreeNavNode } from "@projective/ui/navigation";
import type { SubmissionTreeNode } from "../types/projects-types.ts";
import { pathKey, statusTone } from "../core/submission-model.ts";
import { FolderGlyph, StageGlyph, SubmissionStatusIcon, UnitGlyph } from "./submission-glyphs.tsx";

/**
 * SubmissionTree — the deliverable navigation tree (Part 3). It maps the wire {@link SubmissionTreeNode}
 * hierarchy onto the reusable {@link TreeNav} primitive: stage/unit/folder nodes carry an icon, submitter
 * nodes carry their profile-picture avatar, submission-unit nodes carry an icon-only review-status mark,
 * and every node a muted file count. Selecting a node navigates the workspace to that subtree
 * ({@link onNavigate}); a single synthetic root ("All stages" / "Submissions") returns to the scope root.
 *
 * Rendered inside the SubmissionExplorer island (no data access of its own). The `expanded` set is owned
 * by the island so a breadcrumb jump can auto-expand the target's ancestor chain.
 */
export interface SubmissionTreeProps {
	tree: SubmissionTreeNode[];
	/** The scope-root synthetic node's label ("All stages" for project scope, "Submissions" channel). */
	rootLabel: string;
	/** Total files across the whole tree — the root node's count. */
	rootCount: number;
	/** The currently-selected path (segment chain); `[]` = the scope root. */
	currentPath: string[];
	/** Controlled expanded-key set (keys are `pathKey`s, plus the synthetic `ROOT_KEY`). */
	expanded: Signal<Set<string>>;
	onNavigate: (path: string[]) => void;
}

/** The synthetic root node's key (path `[]`). */
export const ROOT_KEY = "__root__";

/** Wrap a status glyph in a tone-coloured span for the tree's trailing status slot. */
function statusMark(node: SubmissionTreeNode): JSX.Element | null {
	if (!node.status) return null;
	return (
		<span class="subm-status" data-tone={statusTone(node.status)}>
			<SubmissionStatusIcon status={node.status} size={15} />
		</span>
	);
}

/** The leading icon for a container node kind (submitters use their avatar instead). */
function iconFor(kind: SubmissionTreeNode["kind"]): JSX.Element | undefined {
	switch (kind) {
		case "stage":
			return <StageGlyph size={17} />;
		case "unit":
			return <UnitGlyph size={17} />;
		case "dir":
			return <FolderGlyph size={17} />;
		default:
			return undefined;
	}
}

/** Map one wire node (and its subtree) to a TreeNav node, threading the accumulated path into the key. */
function toNavNode(node: SubmissionTreeNode, parentPath: string[]): TreeNavNode {
	const path = [...parentPath, node.segment];
	return {
		key: pathKey(path),
		label: node.label,
		sublabel: node.sublabel ?? undefined,
		icon: iconFor(node.kind),
		avatar: node.kind === "submitter"
			? { image: node.avatar ?? undefined, label: node.label }
			: null,
		status: statusMark(node),
		count: node.fileCount,
		children: node.children.map((c) => toNavNode(c, path)),
	};
}

export function SubmissionTree(props: SubmissionTreeProps): JSX.Element {
	const { tree, rootLabel, rootCount, currentPath, expanded, onNavigate } = props;

	const rootNode: TreeNavNode = {
		key: ROOT_KEY,
		label: rootLabel,
		icon: <UnitGlyph size={17} />,
		count: rootCount,
		children: tree.map((t) => toNavNode(t, [])),
	};

	const selectedKey = currentPath.length === 0 ? ROOT_KEY : pathKey(currentPath);

	const handleSelect = (node: TreeNavNode) => {
		if (node.key === ROOT_KEY) onNavigate([]);
		else onNavigate(node.key.split("/"));
	};

	return (
		<TreeNav
			nodes={[rootNode]}
			selectedKey={selectedKey}
			expanded={expanded}
			onSelect={handleSelect}
			aria-label="Submissions"
		/>
	);
}
