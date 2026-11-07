import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/files-chrome.css";
import { ConfirmDialog, Dialog, Tooltip } from "@projective/ui/feedback";
import { Button, InputText } from "@projective/ui/fields";
import { Icon, type IconName } from "@projective/ui/icons";
import { ViewZoomRig } from "@web/features/shell/components/ViewZoomRig.tsx";
import { fileDateLabel } from "@web/features/projects/core/file-model.ts";
import { filesZoom } from "@web/features/projects/core/view-state.ts";
import UploadDrawer from "./UploadDrawer.island.tsx";
import { ConnectDriveDialog } from "../components/ConnectDriveDialog.tsx";
import { FolderColorDialog } from "../components/FolderColorDialog.tsx";
import { QuotaRing } from "../components/QuotaRing.tsx";
import { UploadProgress } from "../components/UploadProgress.tsx";
import { FilesService } from "../core/FilesService.ts";
import {
	askNewFolder,
	attachLinkOpen,
	commitFiles,
	connectDriveOpen,
	disconnectOpen,
	enqueueUploads,
	folderId,
	items,
	newFolderOpen,
	newFolderParent,
	pendingDisconnect,
	pendingRemoval,
	quota,
	readOnly,
	removalOpen,
	seeded,
	treeRevision,
} from "../core/files-state.ts";
import { uploadReport } from "../core/upload-drawer-state.ts";
import { disconnectDrive, removeRows } from "../core/files-actions.ts";
import {
	type AssetOwnerType,
	type FileScope,
	sourceLabel,
	type StorageQuota,
} from "../types/file-types.ts";
import { uploadTasksOf } from "../core/upload-tasks.ts";

/**
 * FilesFooterRig — the sticky action bar, and the only place on `/files` a file enters the library
 * from the chrome (the body's empty state and its drop target are the other two doors).
 *
 * ## Drawn like the catalogue workspace rig (Decision #311)
 *
 * The density control sits at the start; the actions sit at the end: the secondaries — New folder ·
 * Attach link · Connect drive · Export — as neutral outlined circles, each with a portal `Tooltip`
 * and an `aria-label`, then **Upload**, the region's one filled action, last in the inline direction
 * (§B.8.2 / §B.8.6). There is no overflow menu: every action stays on the bar at every width. The
 * narrowest container tier folds Upload's label into its Tooltip and drops the zoom's lenses, which
 * only repeat what its track does, so the track keeps room to drag.
 *
 * The centre is a track of its own between two equal side tracks, so whatever stands in it is truly
 * centred. While a batch uploads it holds {@link UploadProgress}, the report that opens the upload
 * drawer when pressed; otherwise a host that hands the rig an allowance (`quota`) gets the storage
 * {@link QuotaRing} there.
 *
 * `container-type: inline-size` on the root still stops the band bidding for the lane's space (the
 * `/wallet` 739px min-content defect) and makes that tier switch a container query.
 *
 * ## The action layer mounts HERE
 *
 * The trigger owns the layer, so every `/files` route gets the same dialogs. That includes the
 * {@link UploadDrawer}, mounted UNCONDITIONALLY: a conditionally-rendered island is absent from the
 * page's island graph until its condition flips, and that graph is what carries component CSS.
 *
 * ## Two gates, told apart on purpose
 *
 * A **read-only LOCATION** (a mounted channel, a connected drive) withholds Upload, New folder and
 * Attach link by ABSENCE. `Connect drive` survives: it is an account-level action, not a write into the
 * place being viewed. Export and density survive because reading is never gated.
 *
 * Dumb island: everything goes through the thin `FilesService` / `/api/*`; no database, no fixtures.
 */

// #region Props
export interface FilesFooterRigProps {
	/** The route base every deep link in this scope hangs off. */
	base: string;
	scope: FileScope;
	subjectId: string | null;
	/** The folder path within the scope; `[]` is the scope root. */
	segments: string[];
	ownerType: AssetOwnerType;
	ownerId: string;
	/**
	 * Whether Connect drive is offered (default `true`). A connection belongs to the person's acting
	 * context, so a team's or business's drive withholds it.
	 */
	connectDrive?: boolean;
	/**
	 * Why the whole library takes nothing new, when the host knows it does not (an archived entity's
	 * drive). Set, it withholds every write action as a read-only location does and is the rig's note.
	 */
	lockedNote?: string | null;
	/**
	 * The library's allowance as the server read it, when the rig carries it as the {@link QuotaRing}
	 * in its centre (a console drive, whose allowance has no other home). Painted until the body seeds,
	 * then the live `files-state` figure after every re-read. Omitted, the rig has no centre.
	 */
	quota?: StorageQuota | null;
	/** Whose allowance it is — the ring's popover title. */
	quotaOwner?: string;
}

type SecondaryAction = "new_folder" | "attach_link" | "connect_drive" | "export";

interface ActionSpec {
	key: SecondaryAction;
	label: string;
	icon: IconName;
	/** Withheld at a read-only location — see the module note on the two gates. */
	writes: boolean;
}
// #endregion

// #region Action model
const SECONDARY: readonly ActionSpec[] = [
	{ key: "new_folder", label: "New folder", icon: "folder", writes: true },
	{ key: "attach_link", label: "Attach link", icon: "link", writes: true },
	// `box` is the glyph the tree's `NodeMark` gives a connected drive: the action and its result match.
	{ key: "connect_drive", label: "Connect drive", icon: "box", writes: false },
	{ key: "export", label: "Export list", icon: "download", writes: false },
];

/** Escape one CSV cell — quote it and double any embedded quote, per RFC 4180. */
function csvCell(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}
// #endregion

interface RigIconProps {
	spec: ActionSpec;
	disabled?: boolean;
	onClick: () => void;
}

function RigIcon({ spec, disabled, onClick }: RigIconProps): JSX.Element {
	return (
		<Tooltip content={spec.label} placement="top">
			<Button
				rounded
				iconOnly
				size="sm"
				severity="neutral"
				variant="outlined"
				class="fh-rig__icon ui-hit"
				aria-label={spec.label}
				icon={<Icon name={spec.icon} size="sm" />}
				disabled={disabled}
				onClick={onClick}
			/>
		</Tooltip>
	);
}

export default function FilesFooterRig(props: FilesFooterRigProps): JSX.Element {
	const fileInput = useRef<HTMLInputElement>(null);

	const folderName = useSignal("");
	const linkUrl = useSignal("");
	/** The last write's outcome, shown inside the dialog that produced it. Never swallowed. */
	const notice = useSignal<string | null>(null);
	const busy = useSignal(false);

	useEffect(() => filesZoom.restoreZoom(), []);

	const connectDrive = props.connectDrive ?? true;
	const lockedNote = props.lockedNote ?? null;
	const locked = readOnly.value || lockedNote !== null;
	const hasRing = props.quota !== undefined;
	const allowance = seeded.value ? quota.value : props.quota ?? null;
	const secondaries = SECONDARY.filter((a) =>
		(locked ? !a.writes : true) && (connectDrive || a.key !== "connect_drive")
	);

	// #region Actions
	/**
	 * Enqueue the picked files for the pipeline that owns hashing, dedup and the upload handshake. The
	 * rig stops at the QUEUE (`files-state.uploadQueue`, the shared contract): a second implementation of
	 * the handshake in the action bar is how the two would drift.
	 */
	function onFilesPicked(list: FileList | null): void {
		if (!list || list.length === 0) return;
		enqueueUploads(uploadTasksOf(Array.from(list), folderId.value));
	}

	async function createFolder(): Promise<void> {
		const name = folderName.value.trim();
		if (!name || busy.value) return;
		busy.value = true;
		const res = await FilesService.createFolder({
			name,
			parentId: newFolderParent.value === undefined ? folderId.value : newFolderParent.value,
			ownerType: props.ownerType,
			ownerId: props.ownerId,
		});
		busy.value = false;
		if (res.ok) {
			folderName.value = "";
			newFolderOpen.value = false;
			notice.value = null;
			treeRevision.value += 1;
			commitFiles();
		} else {
			// Closing a dialog on a failure reads as success. It stays open, carrying the reason.
			notice.value = res.message ?? "That folder could not be created.";
		}
	}

	async function attachLink(): Promise<void> {
		const url = linkUrl.value.trim();
		if (!url || busy.value) return;
		busy.value = true;
		const res = await FilesService.attachLink({
			url,
			folderId: folderId.value,
			ownerType: props.ownerType,
			ownerId: props.ownerId,
		});
		busy.value = false;
		if (res.ok) {
			linkUrl.value = "";
			attachLinkOpen.value = false;
			notice.value = null;
			commitFiles();
		} else {
			notice.value = res.message ?? "That link could not be attached.";
		}
	}

	/**
	 * Export what is LOADED, and say so. There is no export endpoint; a client-side CSV of the rows in
	 * view is honest and complete for what it claims, and the label names the scope ("Export list").
	 */
	function exportCsv(): void {
		const rows = items.value;
		if (rows.length === 0) return;
		const header = ["Name", "Kind", "Size", "Added", "Where it lives", "Added by"];
		const body = rows.map((it) =>
			[
				csvCell(it.name),
				csvCell(it.kind),
				csvCell(it.sizeLabel),
				csvCell(fileDateLabel(it)),
				csvCell(sourceLabel(it.source)),
				csvCell(it.sender?.name ?? ""),
			].join(",")
		);
		const csv = [header.map(csvCell).join(","), ...body].join("\r\n");
		const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
		const a = document.createElement("a");
		a.href = url;
		a.download = `files-${props.segments.at(-1) ?? "library"}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function activate(action: SecondaryAction): void {
		notice.value = null;
		switch (action) {
			case "new_folder":
				askNewFolder();
				return;
			case "attach_link":
				attachLinkOpen.value = true;
				return;
			case "connect_drive":
				connectDriveOpen.value = true;
				return;
			case "export":
				exportCsv();
				return;
		}
	}
	// #endregion

	return (
		<div class="fh-rig" data-readonly={locked ? "true" : undefined}>
			<div class="fh-rig__status">
				<ViewZoomRig
					store={filesZoom}
					label="File view zoom"
					class="fh-rig__density"
					listIcon={<Icon name="list" />}
					gridIcon={<Icon name="grid" />}
				/>

				{locked && (
					<span class="fh-rig__note">
						{lockedNote ?? "Read-only here — this location is mounted, not stored in your library."}
					</span>
				)}
			</div>

			{
				/* The centre is a grid cell of its own, present even while it is empty, so the status and the
				   actions never move when a batch starts or the report fades. A batch in flight takes the
				   ring's place: the drawer it opens carries the full allowance meter. */
			}
			<div class="fh-rig__centre">
				<UploadProgress />
				{hasRing && uploadReport.value.tone === "idle" && (
					<QuotaRing quota={allowance} ownerLabel={props.quotaOwner} />
				)}
			</div>

			<div class="fh-rig__actions">
				{secondaries.map((spec) => (
					<RigIcon
						key={spec.key}
						spec={spec}
						disabled={spec.key === "export" && items.value.length === 0}
						onClick={() => activate(spec.key)}
					/>
				))}
				{!locked && (
					<Tooltip content="Upload files" placement="top">
						<Button
							size="sm"
							label="Upload"
							icon={<Icon name="upload" size="sm" />}
							class="fh-rig__upload"
							onClick={() => fileInput.current?.click()}
						/>
					</Tooltip>
				)}
			</div>

			<input
				ref={fileInput}
				class="ui-visually-hidden"
				type="file"
				multiple
				tabIndex={-1}
				aria-hidden="true"
				onChange={(e) => {
					const el = e.currentTarget;
					onFilesPicked(el.files);
					// Reset, or picking the same file twice in a row fires no change event at all.
					el.value = "";
				}}
			/>

			<Dialog
				visible={newFolderOpen}
				header="New folder"
				width="26rem"
				footer={
					<div class="fh-rig__dialogfoot">
						<Button variant="text" label="Cancel" onClick={() => (newFolderOpen.value = false)} />
						<Button
							label="Create folder"
							loading={busy.value}
							disabled={busy.value || folderName.value.trim().length === 0}
							onClick={() => void createFolder()}
						/>
					</div>
				}
			>
				{
					/*
					 * The visible label is ASSOCIATED by id, not replaced by an `aria-label`, so the name a
					 * screen-reader user hears matches the words a speech-control user says (WCAG 2.5.3).
					 */
				}
				<label class="fh-rig__fieldlabel" for="fh-folder-name">Folder name</label>
				<InputText
					id="fh-folder-name"
					value={folderName.value}
					placeholder="Brand assets"
					block
					onValueChange={(v) => (folderName.value = v)}
				/>
				{notice.value && <p class="fh-rig__error" role="status">{notice.value}</p>}
			</Dialog>

			<Dialog
				visible={attachLinkOpen}
				header="Attach a link"
				width="28rem"
				footer={
					<div class="fh-rig__dialogfoot">
						<Button variant="text" label="Cancel" onClick={() => (attachLinkOpen.value = false)} />
						<Button
							label="Attach link"
							loading={busy.value}
							disabled={busy.value || linkUrl.value.trim().length === 0}
							onClick={() => void attachLink()}
						/>
					</div>
				}
			>
				<label class="fh-rig__fieldlabel" for="fh-link-url">Link address</label>
				<InputText
					id="fh-link-url"
					value={linkUrl.value}
					type="url"
					placeholder="https://…"
					block
					onValueChange={(v) => (linkUrl.value = v)}
				/>
				<p class="fh-rig__hint">
					A link is stored as a file in its own right, so you can find it beside everything else.
					Only <code>https://</code> addresses can be attached.
				</p>
				{notice.value && <p class="fh-rig__error" role="status">{notice.value}</p>}
			</Dialog>

			{connectDrive && <ConnectDriveDialog visible={connectDriveOpen} returnTo={props.base} />}

			<FolderColorDialog />

			<ConfirmDialog
				visible={removalOpen}
				header={`Delete ${pendingRemoval.value?.name ?? "this"}?`}
				message={pendingRemoval.value?.folderIds.length
					? "Everything inside goes with it, and anyone holding a share link loses access."
					: "It moves to deleted, and anyone holding a share link loses access."}
				acceptLabel="Delete"
				rejectLabel="Keep"
				acceptSeverity="danger"
				onAccept={() => {
					const rows = pendingRemoval.value;
					if (rows) void removeRows(rows);
				}}
			/>

			{connectDrive && (
				<ConfirmDialog
					visible={disconnectOpen}
					header={`Disconnect ${pendingDisconnect.value?.name ?? "this drive"}?`}
					message="Its files stay where they are, and Projective stops reading them. Connecting it again needs a fresh consent."
					acceptLabel="Disconnect"
					rejectLabel="Keep"
					acceptSeverity="danger"
					onAccept={() => {
						const drive = pendingDisconnect.value;
						if (drive) void disconnectDrive(drive.connectionId);
					}}
				/>
			)}

			<UploadDrawer ownerType={props.ownerType} ownerId={props.ownerId} />
		</div>
	);
}
