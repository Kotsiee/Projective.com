import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/workspace.css";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { WorkspaceKind, WorkspaceStatus } from "@projective/types/workspace";
import type { AssetListPage } from "@projective/types/files";
import FilesHub from "@features/files/islands/FilesHub.island.tsx";
import UploadDrawer from "@features/files/islands/UploadDrawer.island.tsx";
import { FilesService } from "@features/files/core/FilesService.ts";
import { folderSegmentsOfQuery } from "@features/files/core/asset-model.ts";
import { uploadTasksOf } from "@features/files/core/upload-tasks.ts";
import { enqueueUploads, folderId } from "@features/files/core/files-state.ts";
import { entityDriveView } from "../core/files-module-model.ts";

/**
 * EntityFilesScreen — a team's or business's Files module: the entity's shared drive, browsed with the
 * `/files` hub's own body ({@link FilesHub}) inside the console canvas.
 *
 * The console's header band and footer rig keep their slots, so this screen carries the one action
 * the drive needs itself — Upload, a tier-4 utility in the module head — and the upload queue
 * ({@link UploadDrawer}) bound to the entity. The drive is read through `/api/files/list` as the
 * `workspace` scope, whose server confirms the viewer's active seat before it reads a row; the
 * entity id sent is a request, never an authority.
 *
 * The first location is read on mount rather than server-rendered: the console's `[module]` route
 * renders every module from one detail read, and the folder path rides in `?path=` for the same
 * reason — that route is one segment deep.
 */

// #region Props
export interface EntityFilesScreenProps {
	kind: WorkspaceKind;
	/** The entity's id — the drive's owner, as the console's own detail read resolved it. */
	entityId: string;
	handle: string;
	name: string;
	status: WorkspaceStatus;
}
// #endregion

/** The first location: the page, or why it could not be read, and the path it was read for. */
interface DriveBoot {
	page: AssetListPage;
	error: string | null;
	path: string[];
}

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
	const boot = useSignal<DriveBoot | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);

	useEffect(() => {
		let cancelled = false;
		const path = folderSegmentsOfQuery(globalThis.location.search);
		void (async () => {
			const res = await FilesService.list({
				scope: "workspace",
				subjectId: props.entityId,
				path: path.length > 0 ? path : undefined,
				sort: "date",
				dir: "desc",
			});
			if (cancelled) return;
			boot.value = res.ok && res.data
				? { page: res.data, error: null, path }
				: {
					page: failedPage(props.entityId),
					error: res.message ?? `${props.name}'s files couldn't be loaded just now.`,
					path,
				};
		})();
		return () => {
			cancelled = true;
		};
	}, [props.entityId]);

	const writable = view.canUpload && boot.value !== null && !boot.value.page.readOnly;

	return (
		<div class="wsp" data-kind={props.kind}>
			<div class="wsp__stack">
				<section class="wsp-band wsp-band--head" aria-labelledby="wsp-files-title">
					<div class="wsp-band__inner">
						<div class="wsp-pagehead">
							<h1 class="wsp-pagehead__title" id="wsp-files-title">Files</h1>
							{writable
								? (
									<Button
										severity="neutral"
										variant="outlined"
										size="sm"
										icon={<Icon name="upload" />}
										label="Upload"
										onClick={() => fileInput.current?.click()}
									/>
								)
								: null}
						</div>
						<p class="wsp-pagehead__note">{view.readOnlyNote ?? view.note}</p>
					</div>
				</section>
				<section class="wsp-band wsp-band--plain wsp-band--tail" aria-label={`${props.name}'s drive`}>
					<div class="wsp-band__inner">
						{boot.value
							? (
								<FilesHub
									initial={boot.value.page}
									initialError={boot.value.error}
									tree={[]}
									path={boot.value.path}
									base={view.base}
									routing="query"
									emptyNote={view.emptyNote}
								/>
							)
							: <p class="wsp-pagehead__note" role="status">Opening the drive…</p>}
					</div>
				</section>
			</div>
			{view.canUpload
				? (
					<>
						<input
							ref={fileInput}
							class="ui-visually-hidden"
							type="file"
							multiple
							tabIndex={-1}
							aria-hidden="true"
							onChange={(e) => {
								const el = e.currentTarget;
								if (el.files && el.files.length > 0) {
									enqueueUploads(uploadTasksOf(Array.from(el.files), folderId.value));
								}
								el.value = "";
							}}
						/>
						<UploadDrawer ownerType={props.kind} ownerId={props.entityId} />
					</>
				)
				: null}
		</div>
	);
}
