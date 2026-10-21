import type { JSX } from "preact";
import "../styles/workspace.css";
import type { WorkspaceKind, WorkspaceStatus } from "@projective/types/workspace";
import type { AssetListPage, AssetTreeNode } from "@projective/types/files";
import FilesHub from "@features/files/islands/FilesHub.island.tsx";
import { FilesFrame } from "@features/files/components/FilesFrame.tsx";
import { FolderTreePanel } from "@features/files/components/FolderTreePanel.tsx";
import { entityDriveView } from "../core/files-module-model.ts";

/**
 * EntityFilesScreen — a team's or business's Files module: the entity's shared drive, browsed with the
 * `/files` hub's own body ({@link FilesHub}) inside the console canvas.
 *
 * The hub's chrome comes with it (Decision #315): the console's header and footer slots mount the
 * hub's header band (the trail — the folder in view — with search · filter · sort) and footer rig
 * (density · New folder · Attach link · Export list · Upload, the upload queue, and the entity's
 * storage allowance as the ring in its centre). This screen is the body, drawn in the shared
 * {@link FilesFrame}: the drive's folder tree in the panel on the left, the listing beside it
 * (Decision #317). The first location and the tree are read server-side by the `[module]` handler as
 * the `workspace` scope, whose server confirms the viewer's active seat before it reads a row; the
 * entity id is a request, never an authority. The folder path rides in `?path=`.
 */

// #region Props
/** The drive's first location and its folder tree, as the `[module]` handler read them. */
export interface EntityDriveBoot {
	page: AssetListPage | null;
	error: string | null;
	path: string[];
	tree: AssetTreeNode[];
}

export interface EntityFilesScreenProps {
	kind: WorkspaceKind;
	/** The entity's id — the drive's owner, as the console's own detail read resolved it. */
	entityId: string;
	handle: string;
	name: string;
	status: WorkspaceStatus;
	drive: EntityDriveBoot;
}
// #endregion

/** A complete, read-only empty location for a first read that failed, so the hub can offer Retry. */
function failedPage(entityId: string): AssetListPage {
	return {
		scope: "workspace",
		subjectId: entityId,
		folderId: null,
		items: [],
		folders: [],
		crumbs: [],
		hasMore: false,
		nextCursor: null,
		total: 0,
		viewerId: "",
		readOnly: true,
		quota: null,
	};
}

export default function EntityFilesScreen(props: EntityFilesScreenProps): JSX.Element {
	const view = entityDriveView(props);
	const page = props.drive.page ?? failedPage(props.entityId);

	return (
		<div class="wsp" data-kind={props.kind}>
			<div class="wsp__stack">
				<section class="wsp-band wsp-band--plain wsp-band--tail" aria-label={`${props.name}'s drive`}>
					<div class="wsp-band__inner">
						<FilesFrame
							class="wsp-drive"
							asideLabel={`${props.name} folders`}
							aside={
								<FolderTreePanel
									rootLabel={props.name}
									base={view.base}
									routing="query"
									subjectId={props.entityId}
									initialTree={props.drive.tree}
									initialPath={props.drive.path}
									readOnly={!view.canUpload}
								/>
							}
						>
							<FilesHub
								initial={page}
								initialError={props.drive.error}
								tree={props.drive.tree}
								path={props.drive.path}
								base={view.base}
								routing="query"
								emptyNote={view.emptyNote}
								readOnlyNote={view.readOnlyNote}
								canUpload={view.canUpload}
							/>
						</FilesFrame>
					</div>
				</section>
			</div>
		</div>
	);
}
