import type { JSX } from "preact";
import "../styles/workspace.css";
import type { WorkspaceKind, WorkspaceStatus } from "@projective/types/workspace";
import type { AssetListPage } from "@projective/types/files";
import FilesHub from "@features/files/islands/FilesHub.island.tsx";
import { QuotaMeter } from "@features/files/components/QuotaMeter.tsx";
import { quota, seeded } from "@features/files/core/files-state.ts";
import { entityDriveView } from "../core/files-module-model.ts";

/**
 * EntityFilesScreen — a team's or business's Files module: the entity's shared drive, browsed with the
 * `/files` hub's own body ({@link FilesHub}) inside the console canvas.
 *
 * The hub's chrome comes with it (Decision #315): the console's header and footer slots mount the
 * hub's header band (search · filter · sort · the trail) and footer rig (density · New folder ·
 * Attach link · Export list · Upload, and the upload queue), so this screen is the body and the
 * entity's storage allowance. The first location is read server-side by the `[module]` handler as the
 * `workspace` scope, whose server confirms the viewer's active seat before it reads a row; the entity
 * id is a request, never an authority. The folder path rides in `?path=`.
 */

// #region Props
/** The drive's first location, as the `[module]` handler read it. */
export interface EntityDriveBoot {
	page: AssetListPage | null;
	error: string | null;
	path: string[];
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
	const allowance = seeded.value ? quota.value : page.quota;

	return (
		<div class="wsp" data-kind={props.kind}>
			<div class="wsp__stack">
				{allowance && (
					<section class="wsp-band wsp-band--head" aria-label={`${props.name}'s storage`}>
						<div class="wsp-band__inner">
							<QuotaMeter quota={allowance} class="wsp-drive__quota" />
						</div>
					</section>
				)}
				<section class="wsp-band wsp-band--plain wsp-band--tail" aria-label={`${props.name}'s drive`}>
					<div class="wsp-band__inner">
						<FilesHub
							initial={page}
							initialError={props.drive.error}
							tree={[]}
							path={props.drive.path}
							base={view.base}
							routing="query"
							emptyNote={view.emptyNote}
							readOnlyNote={view.readOnlyNote}
							canUpload={view.canUpload}
						/>
					</div>
				</section>
			</div>
		</div>
	);
}
