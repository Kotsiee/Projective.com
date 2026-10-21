import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import {
	ancestorKeys,
	type FolderRouting,
	locationHref,
	rootChildren,
	rootFileCount,
} from "../core/asset-model.ts";
import { resolveTreePath, treeIsStale } from "../core/folder-tree.ts";
import { FilesService } from "../core/FilesService.ts";
import {
	clearSelection,
	commitFiles,
	currentPath,
	folders,
	inspectId,
	loading,
	narrowed,
	seeded,
	tree,
} from "../core/files-state.ts";
import type { AssetTreeNode } from "../types/file-types.ts";
import { AssetTree, ROOT_KEY } from "./AssetTree.tsx";

/**
 * FolderTreePanel — a drive's folder tree for the left panel of {@link FilesFrame}: the drive's root
 * and every folder beneath it, the folder in view selected and its ancestors open.
 *
 * It sits beside a listing it does not own, so it follows the `files-state` contract like the header
 * band: a selection writes the location (the address bar through `pushState`, then `currentPath`)
 * and asks the BODY to re-read through `commitFiles` — one fetch path, and Back / Forward handled by
 * the body's own `popstate`. Until the body has seeded, it paints the server's tree and path from its
 * props, because `files-state` is never written on the server.
 *
 * A location's address may spell a folder by id or by name; {@link resolveTreePath} matches either.
 * When an unnarrowed listing shows child folders the tree does not have (a folder created, renamed,
 * moved or deleted through the listing or the footer rig), the panel re-reads its tree once for that
 * listing — {@link treeIsStale} decides, so it never polls.
 *
 * Dumb: its only read is the thin `FilesService.tree`, through `/api/files/tree`.
 */
export interface FolderTreePanelProps {
	/** The drive's name — the root row ("Atelier Nova"). */
	rootLabel: string;
	/** The route the drive's folder addresses hang off. */
	base: string;
	routing: FolderRouting;
	/** The entity whose drive this is; a stale tree is re-read for it. */
	subjectId: string;
	/** The server-read tree and path, painted until the body seeds. */
	initialTree: AssetTreeNode[];
	initialPath: string[];
	/** The drive takes nothing new — the empty note does not offer New folder. */
	readOnly?: boolean;
}

export function FolderTreePanel(props: FolderTreePanelProps): JSX.Element {
	const expanded = useSignal<Set<string>>(new Set([ROOT_KEY]));
	const treeError = useSignal<string | null>(null);
	/** The listing a re-read was last asked for, so one stale listing costs at most one read. */
	const reread = useRef<string | null>(null);

	const nodes = seeded.value ? tree.value : props.initialTree;
	const path = seeded.value ? currentPath.value : props.initialPath;
	const roots = rootChildren(nodes);
	const match = resolveTreePath(roots, path);

	// #region Expansion
	// The folder in view is always reachable: its ancestors open whenever the location changes. Only
	// ever a widening, so a person's own collapse of an unrelated branch survives.
	useSignalEffect(() => {
		const live = seeded.value ? tree.value : props.initialTree;
		const at = resolveTreePath(
			rootChildren(live),
			seeded.value ? currentPath.value : props.initialPath,
		);
		const open = new Set(expanded.peek());
		open.add(ROOT_KEY);
		for (const key of ancestorKeys(at.path)) open.add(key || ROOT_KEY);
		if (open.size !== expanded.peek().size) expanded.value = open;
	});
	// #endregion

	// #region Staleness
	useSignalEffect(() => {
		if (!seeded.value || loading.value || narrowed.value) return;
		const signature = `${currentPath.value.join("/")}|${
			folders.value.map((f) => `${f.id}:${f.name}`).join(",")
		}`;
		if (!treeIsStale(rootChildren(tree.value), currentPath.value, folders.value)) return;
		if (reread.current === signature) return;
		reread.current = signature;
		void FilesService.tree({ subjectId: props.subjectId }).then((res) => {
			if (res.ok && res.data) {
				tree.value = res.data;
				treeError.value = null;
			} else {
				treeError.value = res.message ?? "The folder list could not be refreshed.";
			}
		});
	});
	// #endregion

	function go(next: string[]): void {
		const search = globalThis.location?.search ?? "";
		const href = locationHref(props.base, next, props.routing, search);
		const here = (globalThis.location?.pathname ?? "") + search;
		if (typeof history !== "undefined" && here !== href) {
			history.pushState({ filesPath: next }, "", href);
		}
		currentPath.value = next;
		clearSelection();
		inspectId.value = null;
		commitFiles();
	}

	return (
		<>
			<AssetTree
				tree={nodes}
				rootLabel={props.rootLabel}
				rootCount={rootFileCount(nodes) ?? 0}
				currentPath={match.path}
				expanded={expanded}
				onNavigate={go}
				aria-label={`${props.rootLabel} folders`}
			/>
			{treeError.value
				? <p class="ffr__note" role="status">{treeError.value}</p>
				: roots.length === 0 && (
					<p class="ffr__note">
						{props.readOnly
							? "No folders here."
							: "No folders yet. New folder in the action bar adds one."}
					</p>
				)}
		</>
	);
}
